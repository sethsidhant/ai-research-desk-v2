import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const HEADERS_YAHOO = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
}

// 5-min in-process cache keyed by "token:NNN" or "symbol:XXX"
const CACHE = new Map<string, { closes: { date: string; close: number }[]; ts: number }>()
const TTL = 5 * 60 * 1000

async function getKiteToken(): Promise<{ apiKey: string; accessToken: string } | null> {
  const apiKey = process.env.KITE_API_KEY
  if (!apiKey) return null
  try {
    const accessToken = fs.readFileSync(path.join(process.cwd(), '.kite_token'), 'utf8').trim()
    if (accessToken) return { apiKey, accessToken }
  } catch {}
  try {
    const admin = createAdminClient()
    const { data } = await admin.from('app_settings').select('value').eq('key', 'kite_access_token').single()
    if (data?.value) return { apiKey, accessToken: data.value }
  } catch {}
  const accessToken = process.env.KITE_ACCESS_TOKEN
  return accessToken ? { apiKey, accessToken } : null
}

async function fetchKiteCandles(token: number): Promise<{ date: string; close: number }[]> {
  const kite = await getKiteToken()
  if (!kite) return []
  const to   = new Date().toISOString().slice(0, 10)
  const from = new Date(Date.now() - 95 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  try {
    const res = await fetch(
      `https://api.kite.trade/instruments/historical/${token}/day?from=${from}&to=${to}&oi=0`,
      {
        headers: { 'X-Kite-Version': '3', 'Authorization': `token ${kite.apiKey}:${kite.accessToken}` },
        signal: AbortSignal.timeout(8000),
      }
    )
    if (!res.ok) return []
    const json = await res.json()
    const candles: [string, number, number, number, number, number][] = json.data?.candles ?? []
    // candles: [datetime, open, high, low, close, volume]
    return candles
      .filter(c => c[4] > 0)
      .map(c => ({ date: c[0].slice(0, 10), close: c[4] }))
  } catch {
    return []
  }
}

async function fetchYahooCandles(symbol: string): Promise<{ date: string; close: number }[]> {
  try {
    const res = await fetch(
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=3mo`,
      { headers: HEADERS_YAHOO, signal: AbortSignal.timeout(8000) }
    )
    if (!res.ok) return []
    const json   = await res.json()
    const result = json?.chart?.result?.[0]
    if (!result) return []
    const timestamps: number[]         = result.timestamp ?? []
    const rawCloses: (number | null)[] = result.indicators?.quote?.[0]?.close ?? []
    return timestamps
      .map((ts, i) => ({ date: new Date(ts * 1000).toISOString().slice(0, 10), close: rawCloses[i] }))
      .filter((c): c is { date: string; close: number } => c.close != null && c.close > 0)
  } catch {
    return []
  }
}

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url    = new URL(req.url)
  const token  = url.searchParams.get('token')   // Kite instrument token (Indian indices)
  const symbol = url.searchParams.get('symbol')  // Yahoo Finance symbol (global indices)

  if (!token && !symbol) return NextResponse.json({ error: 'token or symbol required' }, { status: 400 })

  const cacheKey = token ? `token:${token}` : `symbol:${symbol}`
  const cached   = CACHE.get(cacheKey)
  if (cached && Date.now() - cached.ts < TTL) {
    return NextResponse.json({ closes: cached.closes, cached: true })
  }

  const closes = token
    ? await fetchKiteCandles(parseInt(token, 10))
    : await fetchYahooCandles(symbol!)

  if (closes.length) CACHE.set(cacheKey, { closes, ts: Date.now() })
  return NextResponse.json({ closes })
}
