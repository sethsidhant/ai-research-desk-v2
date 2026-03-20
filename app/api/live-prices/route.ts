import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

async function getKiteToken(): Promise<{ apiKey: string; accessToken: string } | null> {
  const apiKey = process.env.KITE_API_KEY
  if (!apiKey) return null

  // 1. Local: .kite_token file (no restart needed)
  try {
    const accessToken = fs.readFileSync(path.join(process.cwd(), '.kite_token'), 'utf8').trim()
    if (accessToken) return { apiKey, accessToken }
  } catch {}

  // 2. Vercel: read from Supabase app_settings via service role (bypasses RLS)
  try {
    const admin = createAdminClient()
    const { data } = await admin.from('app_settings').select('value').eq('key', 'kite_access_token').single()
    if (data?.value) return { apiKey, accessToken: data.value }
  } catch {}

  // 3. Fall back to env var
  const accessToken = process.env.KITE_ACCESS_TOKEN
  return accessToken ? { apiKey, accessToken } : null
}

function isMarketOpen(): boolean {
  const now = new Date()
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000))
  const day = ist.getUTCDay()
  if (day === 0 || day === 6) return false
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes()
  return mins >= 555 && mins <= 930
}

export type LivePriceData = {
  last:       number
  change:     number   // absolute change from prev close
  changePct:  number   // % change from prev close
}

const userCaches = new Map<string, { data: Record<string, LivePriceData>; ts: number }>()
const CACHE_TTL_MS = 15000

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!isMarketOpen()) return NextResponse.json({ marketOpen: false, prices: {} })

  const cache = userCaches.get(user.id)
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return NextResponse.json({ marketOpen: true, prices: cache.data, cached: true })
  }

  const kite = await getKiteToken()
  if (!kite) return NextResponse.json({ error: 'Kite credentials not configured' }, { status: 500 })
  const { apiKey, accessToken } = kite

  // Only fetch watchlisted stocks for this user — avoids sending 7814 tokens to Kite
  const { data: watchlist } = await supabase
    .from('user_stocks')
    .select('stock_id')
    .eq('user_id', user.id)

  const stockIds = (watchlist ?? []).map(w => w.stock_id)
  if (!stockIds.length) return NextResponse.json({ marketOpen: true, prices: {} })

  const { data: stocks } = await supabase
    .from('stocks')
    .select('ticker, instrument_token')
    .in('id', stockIds)
    .not('instrument_token', 'is', null)

  if (!stocks?.length) return NextResponse.json({ marketOpen: true, prices: {} })

  const tokens = stocks.map(s => s.instrument_token).join('&i=')

  try {
    const res = await fetch(`https://api.kite.trade/quote?i=${tokens}`, {
      headers: { 'X-Kite-Version': '3', 'Authorization': `token ${apiKey}:${accessToken}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return NextResponse.json({ error: `Kite API error: ${res.status}` }, { status: 502 })

    const json     = await res.json()
    const kiteData = json.data ?? {}

    const tokenToTicker: Record<string, string> = {}
    for (const s of stocks) tokenToTicker[s.instrument_token] = s.ticker

    const prices: Record<string, LivePriceData> = {}
    for (const [, val] of Object.entries(kiteData)) {
      const v         = val as any
      const ticker    = tokenToTicker[v.instrument_token]
      if (!ticker || !v.last_price) continue
      const prevClose = v.ohlc?.close ?? v.last_price
      const change    = parseFloat((v.last_price - prevClose).toFixed(2))
      const changePct = prevClose > 0 ? parseFloat(((change / prevClose) * 100).toFixed(2)) : 0
      prices[ticker]  = { last: v.last_price, change, changePct }
    }

    userCaches.set(user.id, { data: prices, ts: Date.now() })
    return NextResponse.json({ marketOpen: true, prices })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 })
  }
}
