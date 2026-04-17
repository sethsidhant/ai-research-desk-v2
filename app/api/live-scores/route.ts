import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export type LiveScoreData = {
  rsi:             number | null
  rsi_signal:      string | null
  dma_50:          number | null
  dma_200:         number | null
  above_50_dma:    boolean | null
  above_200_dma:   boolean | null
  composite_score: number | null
  classification:  string | null
  suggested_action:string | null
  score_date:      string | null
}

// 5-min server-side cache per user (scores change at most every 5 min via stockWatcher flush)
const scoreCache = new Map<string, { data: Record<string, LiveScoreData>; ts: number }>()
const CACHE_TTL_MS = 5 * 60 * 1000

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const cached = scoreCache.get(user.id)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return NextResponse.json({ scores: cached.data, cached: true })
  }

  const [{ data: watchlist }, { data: holdings }] = await Promise.all([
    supabase.from('user_stocks').select('stock_id'),
    supabase.from('portfolio_holdings').select('stock_id'),
  ])

  const stockIds = [...new Set([
    ...(watchlist ?? []).map(w => w.stock_id),
    ...(holdings ?? []).map(h => h.stock_id),
  ])]

  if (!stockIds.length) return NextResponse.json({ scores: {} })

  // Get ticker map
  const { data: stocks } = await supabase
    .from('stocks')
    .select('id, ticker')
    .in('id', stockIds)

  const idToTicker: Record<string, string> = {}
  for (const s of (stocks ?? [])) idToTicker[s.id] = s.ticker

  // Latest score per stock (order by date desc, take first per stock_id)
  const { data: scoreRows } = await supabase
    .from('daily_scores')
    .select('stock_id, date, rsi, rsi_signal, dma_50, dma_200, above_50_dma, above_200_dma, composite_score, classification, suggested_action')
    .in('stock_id', stockIds)
    .order('date', { ascending: false })
    .limit(stockIds.length * 5)

  const latestByStock: Record<string, typeof scoreRows extends (infer T)[] | null ? T : never> = {}
  for (const row of (scoreRows ?? [])) {
    if (!latestByStock[row.stock_id]) latestByStock[row.stock_id] = row
  }

  const scores: Record<string, LiveScoreData> = {}
  for (const [stockId, row] of Object.entries(latestByStock)) {
    const ticker = idToTicker[stockId]
    if (!ticker) continue
    scores[ticker] = {
      rsi:              row.rsi,
      rsi_signal:       row.rsi_signal,
      dma_50:           row.dma_50,
      dma_200:          row.dma_200,
      above_50_dma:     row.above_50_dma,
      above_200_dma:    row.above_200_dma,
      composite_score:  row.composite_score,
      classification:   row.classification,
      suggested_action: row.suggested_action,
      score_date:       row.date,
    }
  }

  scoreCache.set(user.id, { data: scores, ts: Date.now() })
  return NextResponse.json({ scores })
}
