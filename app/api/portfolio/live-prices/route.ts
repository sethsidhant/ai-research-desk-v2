import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'

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

function isMarketOpen(): boolean {
  const now = new Date()
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000))
  const day = ist.getUTCDay()
  if (day === 0 || day === 6) return false
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes()
  return mins >= 555 && mins <= 930
}

const userCaches = new Map<string, { data: Record<string, { last: number; change: number; changePct: number }>; ts: number }>()
const CACHE_TTL_MS = 15000

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const marketOpen = isMarketOpen()

  const cache = userCaches.get(`portfolio:${user.id}`)
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return NextResponse.json({ marketOpen, prices: cache.data, cached: true })
  }

  const kite = await getKiteToken()
  if (!kite) return NextResponse.json({ error: 'Kite credentials not configured' }, { status: 500 })

  const admin = createAdminClient()

  const { data: holdings } = await admin
    .from('portfolio_holdings')
    .select('stock_id')
    .eq('user_id', user.id)

  const stockIds = (holdings ?? []).map(h => h.stock_id)
  if (!stockIds.length) return NextResponse.json({ marketOpen, prices: {} })

  const { data: stocks } = await admin
    .from('stocks')
    .select('ticker, instrument_token')
    .in('id', stockIds)
    .not('instrument_token', 'is', null)

  if (!stocks?.length) return NextResponse.json({ marketOpen, prices: {} })

  const tokens = stocks.map(s => s.instrument_token).join('&i=')

  try {
    const res = await fetch(`https://api.kite.trade/quote?i=${tokens}`, {
      headers: { 'X-Kite-Version': '3', 'Authorization': `token ${kite.apiKey}:${kite.accessToken}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return NextResponse.json({ error: `Kite error: ${res.status}` }, { status: 502 })

    const json     = await res.json()
    const kiteData = json.data ?? {}

    const tokenToTicker: Record<string, string> = {}
    for (const s of stocks) tokenToTicker[s.instrument_token] = s.ticker

    const prices: Record<string, { last: number; change: number; changePct: number }> = {}
    for (const [, val] of Object.entries(kiteData)) {
      const v         = val as any
      const ticker    = tokenToTicker[v.instrument_token]
      if (!ticker || !v.last_price) continue
      const prevClose = v.ohlc?.close ?? v.last_price
      const change    = parseFloat((v.last_price - prevClose).toFixed(2))
      const changePct = prevClose > 0 ? parseFloat(((change / prevClose) * 100).toFixed(2)) : 0
      prices[ticker]  = { last: v.last_price, change, changePct }
    }

    userCaches.set(`portfolio:${user.id}`, { data: prices, ts: Date.now() })
    return NextResponse.json({ marketOpen, prices })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 })
  }
}
