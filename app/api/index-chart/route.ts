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

// Supabase index_history column map for the two indices we store
const SUPABASE_INDEX: Record<number, 'nifty50_close' | 'nifty500_close'> = {
  256265: 'nifty50_close',
  268041: 'nifty500_close',
}

async function getKiteToken(): Promise<{ apiKey: string; accessToken: string; source: string } | null> {
  const apiKey = process.env.KITE_API_KEY
  if (!apiKey) return null
  try {
    const accessToken = fs.readFileSync(path.join(process.cwd(), '.kite_token'), 'utf8').trim()
    if (accessToken) return { apiKey, accessToken, source: 'file' }
  } catch {}
  try {
    const admin = createAdminClient()
    const { data } = await admin.from('app_settings').select('value').eq('key', 'kite_access_token').single()
    if (data?.value) return { apiKey, accessToken: data.value, source: 'supabase' }
  } catch {}
  const accessToken = process.env.KITE_ACCESS_TOKEN
  return accessToken ? { apiKey, accessToken, source: 'env' } : null
}

async function fetchFromSupabase(
  supabase: Awaited<ReturnType<typeof createClient>>,
  column: 'nifty50_close' | 'nifty500_close',
): Promise<{ date: string; close: number }[]> {
  const since = new Date(Date.now() - 95 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const { data } = await supabase
    .from('index_history')
    .select(`date, ${column}`)
    .gte('date', since)
    .order('date', { ascending: true })
  if (!data?.length) return []
  return data
    .filter((r: any) => r[column] != null)
    .map((r: any) => ({ date: r.date as string, close: r[column] as number }))
}

async function fetchKiteCandles(token: number): Promise<{ closes: { date: string; close: number }[]; debug: string }> {
  const kite = await getKiteToken()
  if (!kite) return { closes: [], debug: 'no_kite_token' }
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
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      return { closes: [], debug: `kite_http_${res.status}: ${txt.slice(0, 100)}` }
    }
    const json = await res.json()
    if (json.error_type) return { closes: [], debug: `kite_error: ${json.message}` }
    const candles: [string, number, number, number, number, number][] = json.data?.candles ?? []
    const closes = candles
      .filter(c => c[4] > 0)
      .map(c => ({ date: c[0].slice(0, 10), close: c[4] }))
    return { closes, debug: `kite_ok:${kite.source}:${closes.length}candles` }
  } catch (e: any) {
    return { closes: [], debug: `kite_exception: ${e.message}` }
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
  if (!user) return NextResponse.json({ closes: [], debug: 'unauthorized' }, { status: 401 })

  const url    = new URL(req.url)
  const token  = url.searchParams.get('token')
  const symbol = url.searchParams.get('symbol')

  if (!token && !symbol) return NextResponse.json({ closes: [], debug: 'missing_params' }, { status: 400 })

  const cacheKey = token ? `token:${token}` : `symbol:${symbol}`
  const cached   = CACHE.get(cacheKey)
  if (cached && Date.now() - cached.ts < TTL) {
    return NextResponse.json({ closes: cached.closes, debug: 'cached' })
  }

  // For symbol-based (global indices) — Yahoo Finance
  if (symbol) {
    const closes = await fetchYahooCandles(symbol)
    if (closes.length) CACHE.set(cacheKey, { closes, ts: Date.now() })
    return NextResponse.json({ closes, debug: closes.length ? `yahoo_ok:${closes.length}` : 'yahoo_empty' })
  }

  // Token-based (Indian indices)
  const tokenNum = parseInt(token!, 10)

  // Nifty50 + Nifty500: primary source is Supabase index_history (always reliable)
  const supabaseCol = SUPABASE_INDEX[tokenNum]
  if (supabaseCol) {
    const closes = await fetchFromSupabase(supabase, supabaseCol)
    if (closes.length) {
      CACHE.set(cacheKey, { closes, ts: Date.now() })
      return NextResponse.json({ closes, debug: `supabase_ok:${closes.length}` })
    }
    // fallthrough to Kite if Supabase has no data
  }

  // All other Indian indices: Kite historical API
  const { closes, debug } = await fetchKiteCandles(tokenNum)
  if (closes.length) CACHE.set(cacheKey, { closes, ts: Date.now() })
  return NextResponse.json({ closes, debug })
}
