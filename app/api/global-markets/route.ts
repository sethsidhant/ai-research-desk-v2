import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export type GlobalQuote = {
  symbol:     string
  name:       string
  price:      number
  prevClose:  number
  change:     number
  changePct:  number
  currency:   string
  group:      'indices' | 'currency' | 'commodities'
  flag?:      string   // emoji flag for region
}

const SYMBOLS: { symbol: string; name: string; group: GlobalQuote['group']; flag?: string }[] = [
  // Currency & FX
  { symbol: 'USDINR=X',   name: 'USD / INR',          group: 'currency',    flag: '🇮🇳' },
  { symbol: 'DX-Y.NYB',   name: 'US Dollar Index',    group: 'currency',    flag: '🇺🇸' },
  // Global Indices
  { symbol: '^GSPC',      name: 'S&P 500',             group: 'indices',     flag: '🇺🇸' },
  { symbol: '^IXIC',      name: 'NASDAQ',              group: 'indices',     flag: '🇺🇸' },
  { symbol: '^DJI',       name: 'Dow Jones',           group: 'indices',     flag: '🇺🇸' },
  { symbol: '^FTSE',      name: 'FTSE 100',            group: 'indices',     flag: '🇬🇧' },
  { symbol: '^GDAXI',     name: 'DAX',                 group: 'indices',     flag: '🇩🇪' },
  { symbol: '^N225',      name: 'Nikkei 225',          group: 'indices',     flag: '🇯🇵' },
  { symbol: '^HSI',       name: 'Hang Seng',           group: 'indices',     flag: '🇭🇰' },
  { symbol: '^STI',       name: 'SGX Straits Times',   group: 'indices',     flag: '🇸🇬' },
  { symbol: '^KS11',      name: 'KOSPI',               group: 'indices',     flag: '🇰🇷' },
  // Commodities
  { symbol: 'BZ=F',       name: 'Brent Crude',        group: 'commodities', flag: '🛢️' },
  { symbol: 'CL=F',       name: 'WTI Crude',          group: 'commodities', flag: '🛢️' },
  { symbol: 'GC=F',       name: 'Gold',               group: 'commodities', flag: '🥇' },
  { symbol: 'SI=F',       name: 'Silver',             group: 'commodities', flag: '🪙' },
]

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
}

let cache: { data: GlobalQuote[]; ts: number } | null = null
const CACHE_TTL = 60 * 1000 // 60s — global markets don't need sub-minute refresh

async function fetchQuote(symbol: string): Promise<{ price: number; prevClose: number; currency: string } | null> {
  try {
    const res = await fetch(
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
      { headers: HEADERS, signal: AbortSignal.timeout(6000) }
    )
    if (!res.ok) return null
    const json = await res.json()
    const meta = json?.chart?.result?.[0]?.meta
    if (!meta?.regularMarketPrice) return null
    return {
      price:     meta.regularMarketPrice,
      prevClose: meta.chartPreviousClose ?? meta.previousClose ?? 0,
      currency:  meta.currency ?? 'USD',
    }
  } catch {
    return null
  }
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json({ quotes: cache.data, cached: true, ts: cache.ts })
  }

  // Fetch all in parallel — Yahoo Finance handles concurrent requests fine
  const results = await Promise.all(
    SYMBOLS.map(async s => {
      const q = await fetchQuote(s.symbol)
      if (!q) return null
      const change    = q.prevClose > 0 ? q.price - q.prevClose : 0
      const changePct = q.prevClose > 0 ? (change / q.prevClose) * 100 : 0
      return {
        symbol:    s.symbol,
        name:      s.name,
        price:     q.price,
        prevClose: q.prevClose,
        change:    parseFloat(change.toFixed(4)),
        changePct: parseFloat(changePct.toFixed(2)),
        currency:  q.currency,
        group:     s.group,
        flag:      s.flag,
      } as GlobalQuote
    })
  )

  const quotes = results.filter(Boolean) as GlobalQuote[]
  cache = { data: quotes, ts: Date.now() }

  return NextResponse.json({ quotes, ts: cache.ts })
}
