import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const tickers = searchParams.get('tickers')?.split(',').filter(Boolean) ?? []
  if (!tickers.length) return NextResponse.json({ ready: true })

  // Look up stock IDs for the tickers
  const { data: stocks } = await supabase
    .from('stocks')
    .select('id, ticker')
    .in('ticker', tickers)

  if (!stocks?.length) return NextResponse.json({ ready: false })

  const stockIds = stocks.map(s => s.id)
  const today    = new Date().toISOString().slice(0, 10)

  // Check if all pending stocks have a daily_score for today
  const { data: scores } = await supabase
    .from('daily_scores')
    .select('stock_id, composite_score')
    .in('stock_id', stockIds)
    .eq('date', today)

  const scoredIds = new Set((scores ?? []).filter(s => s.composite_score != null).map(s => s.stock_id))
  const ready     = stockIds.every(id => scoredIds.has(id))

  return NextResponse.json({ ready })
}
