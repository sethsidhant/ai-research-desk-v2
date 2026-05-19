import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

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

// Module-level caches
let kiteTokenCache: { apiKey: string; accessToken: string } | null = null
let kiteTokenTs = 0
const KITE_TOKEN_TTL = 55 * 60 * 1000

type EtfRow = {
  ticker: string
  name: string
  fund_house: string
  category: string
  underlying_index: string | null
  expense_ratio: number | null
  aum_cr: number | null
  instrument_token: number
  inav_ticker: string | null
  inav_token: number | null
}

let etfListCache: EtfRow[] | null = null
let etfListTs = 0
const ETF_LIST_TTL = 10 * 60 * 1000

const priceCache = new Map<string, { data: Record<string, EtfQuote>; ts: number }>()
const PRICE_TTL = 15000

export type EtfQuote = {
  price:          number
  change:         number
  changePct:      number
  nav:            number | null
  premiumPct:     number | null
  high52w:        number | null
  low52w:         number | null
  volume:         number
  dayHigh:        number
  dayLow:         number
}

const CACHE_KEY = 'etf_prices'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const cached = priceCache.get(CACHE_KEY)
  if (cached && Date.now() - cached.ts < PRICE_TTL) {
    return NextResponse.json({ prices: cached.data, cached: true })
  }

  if (!kiteTokenCache || Date.now() - kiteTokenTs > KITE_TOKEN_TTL) {
    kiteTokenCache = await getKiteToken()
    kiteTokenTs = Date.now()
  }
  const kite = kiteTokenCache
  if (!kite) return NextResponse.json({ error: 'Kite credentials not configured' }, { status: 500 })

  if (!etfListCache || Date.now() - etfListTs > ETF_LIST_TTL) {
    const admin = createAdminClient()
    const { data } = await admin.from('etfs').select('*').order('aum_cr', { ascending: false })
    etfListCache = (data ?? []) as EtfRow[]
    etfListTs = Date.now()
  }
  const etfs = etfListCache
  if (!etfs.length) return NextResponse.json({ prices: {} })

  // Build token list: ETF tokens + INAV tokens
  const allTokens: string[] = []
  for (const e of etfs) {
    allTokens.push(`NSE:${e.ticker}`)
    if (e.inav_ticker) allTokens.push(`NSE:${e.inav_ticker}`)
  }

  const tokenStr = allTokens.join('&i=')

  try {
    const res = await fetch(`https://api.kite.trade/quote?i=${tokenStr}`, {
      headers: { 'X-Kite-Version': '3', 'Authorization': `token ${kite.apiKey}:${kite.accessToken}` },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return NextResponse.json({ error: `Kite error: ${res.status}` }, { status: 502 })

    const json = await res.json()
    const raw  = json.data ?? {}

    const prices: Record<string, EtfQuote> = {}

    for (const e of etfs) {
      const etfKey  = `NSE:${e.ticker}`
      const inavKey = e.inav_ticker ? `NSE:${e.inav_ticker}` : null

      const etfData  = raw[etfKey]  as any
      const inavData = inavKey ? raw[inavKey] as any : null

      if (!etfData?.last_price) continue

      const prevClose  = etfData.ohlc?.close ?? etfData.last_price
      const change     = parseFloat((etfData.last_price - prevClose).toFixed(2))
      const changePct  = prevClose > 0 ? parseFloat(((change / prevClose) * 100).toFixed(2)) : 0
      const nav        = inavData?.last_price ?? null
      const premiumPct = nav && nav > 0
        ? parseFloat(((etfData.last_price - nav) / nav * 100).toFixed(3))
        : null

      prices[e.ticker] = {
        price:      etfData.last_price,
        change,
        changePct,
        nav,
        premiumPct,
        high52w:    etfData['52week_high'] ?? null,
        low52w:     etfData['52week_low']  ?? null,
        volume:     etfData.volume ?? 0,
        dayHigh:    etfData.ohlc?.high ?? etfData.last_price,
        dayLow:     etfData.ohlc?.low  ?? etfData.last_price,
      }
    }

    priceCache.set(CACHE_KEY, { data: prices, ts: Date.now() })
    return NextResponse.json({ prices })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 })
  }
}
