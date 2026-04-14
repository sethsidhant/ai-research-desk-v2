import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
}

// 5-min in-process cache keyed by symbol
const CACHE = new Map<string, { closes: { date: string; close: number }[]; ts: number }>()
const TTL = 5 * 60 * 1000

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const symbol = new URL(req.url).searchParams.get('symbol')
  if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 })

  const cached = CACHE.get(symbol)
  if (cached && Date.now() - cached.ts < TTL) {
    return NextResponse.json({ closes: cached.closes, symbol, cached: true })
  }

  try {
    const res = await fetch(
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=3mo`,
      { headers: HEADERS, signal: AbortSignal.timeout(8000) }
    )
    if (!res.ok) return NextResponse.json({ closes: [], symbol, error: `Yahoo ${res.status}` })

    const json   = await res.json()
    const result = json?.chart?.result?.[0]
    if (!result) return NextResponse.json({ closes: [], symbol })

    const timestamps: number[]        = result.timestamp ?? []
    const rawCloses: (number | null)[] = result.indicators?.quote?.[0]?.close ?? []

    const closes = timestamps
      .map((ts, i) => ({ date: new Date(ts * 1000).toISOString().slice(0, 10), close: rawCloses[i] }))
      .filter((c): c is { date: string; close: number } => c.close != null && c.close > 0)

    CACHE.set(symbol, { closes, ts: Date.now() })
    return NextResponse.json({ closes, symbol })
  } catch (e: any) {
    return NextResponse.json({ closes: [], symbol, error: e.message })
  }
}
