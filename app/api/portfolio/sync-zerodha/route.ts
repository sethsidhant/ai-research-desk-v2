import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { execFile } from 'child_process'
import path from 'path'
import fs from 'fs'

async function getKiteToken(): Promise<{ apiKey: string; accessToken: string } | null> {
  const apiKey = process.env.KITE_API_KEY
  if (!apiKey) return null
  try {
    const t = fs.readFileSync(path.join(process.cwd(), '.kite_token'), 'utf8').trim()
    if (t) return { apiKey, accessToken: t }
  } catch {}
  try {
    const admin = createAdminClient()
    const { data } = await admin.from('app_settings').select('value').eq('key', 'kite_access_token').single()
    if (data?.value) return { apiKey, accessToken: data.value }
  } catch {}
  const t = process.env.KITE_ACCESS_TOKEN
  return t ? { apiKey, accessToken: t } : null
}

function triggerOnboarding(ticker: string) {
  const safeTicker = ticker.replace(/[^A-Z0-9&\-\.]/gi, '')
  const agentsDir  = path.join(process.cwd(), 'agents')
  execFile('node', ['onboardStock.js', safeTicker], { cwd: agentsDir, timeout: 180000 }, (err) => {
    if (err) console.error(`[portfolio-onboard] ${safeTicker} failed:`, err.message)
    else     console.log(`[portfolio-onboard] ${safeTicker} done`)
  })
}

export async function POST() {
  const supabase = await createClient()
  const admin    = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const kite = await getKiteToken()
  if (!kite) return NextResponse.json({ error: 'Kite credentials not configured' }, { status: 400 })

  // Fetch holdings from Kite
  let kiteHoldings: any[]
  try {
    const res = await fetch('https://api.kite.trade/portfolio/holdings', {
      headers: {
        'X-Kite-Version': '3',
        'Authorization': `token ${kite.apiKey}:${kite.accessToken}`,
      },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return NextResponse.json({ error: `Kite error: ${res.status}` }, { status: 502 })
    const json = await res.json()
    kiteHoldings = json.data ?? []
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 })
  }

  if (!kiteHoldings.length) {
    return NextResponse.json({ synced: 0, onboarding: [], message: 'No holdings in Kite account' })
  }

  // Only NSE holdings with positive quantity
  const nseHoldings = kiteHoldings.filter((h: any) => h.exchange === 'NSE' && h.quantity > 0)
  const tickers     = nseHoldings.map((h: any) => h.tradingsymbol as string)

  // Look up existing stocks
  const { data: existing } = await admin
    .from('stocks')
    .select('id, ticker')
    .in('ticker', tickers)

  const tickerToId: Record<string, string> = {}
  for (const s of existing ?? []) tickerToId[s.ticker] = s.id

  // Stub-insert unknown stocks so we have a stock_id to reference
  const unknown = tickers.filter(t => !tickerToId[t])
  if (unknown.length > 0) {
    const stubs = unknown.map(ticker => {
      const h = nseHoldings.find((h: any) => h.tradingsymbol === ticker)
      return { ticker, stock_name: h?.tradingsymbol ?? ticker, instrument_token: h?.instrument_token ?? null }
    })
    const { data: inserted } = await admin
      .from('stocks')
      .upsert(stubs, { onConflict: 'ticker', ignoreDuplicates: false })
      .select('id, ticker')
    for (const s of inserted ?? []) tickerToId[s.ticker] = s.id
    for (const t of unknown) triggerOnboarding(t)
  }

  // Upsert portfolio_holdings — one row per stock, aggregate if needed
  const upsertRows = nseHoldings
    .filter((h: any) => tickerToId[h.tradingsymbol])
    .map((h: any) => ({
      user_id:       user.id,
      stock_id:      tickerToId[h.tradingsymbol],
      quantity:      h.quantity,
      avg_price:     h.average_price,
      broker:        'Zerodha',
      import_source: 'kite',
      updated_at:    new Date().toISOString(),
    }))

  const { error } = await supabase
    .from('portfolio_holdings')
    .upsert(upsertRows, { onConflict: 'user_id,stock_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    synced:     upsertRows.length,
    onboarding: unknown,
    message:    `Synced ${upsertRows.length} holdings from Zerodha${unknown.length ? `, onboarding ${unknown.length} new stocks` : ''}`,
  })
}
