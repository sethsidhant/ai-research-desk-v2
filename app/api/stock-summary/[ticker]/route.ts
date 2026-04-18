import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { ticker } = await params

  const { data: stock } = await supabase
    .from('stocks')
    .select('id, stock_name, ticker, industry, current_price, stock_pe, ai_summary, summary_date, latest_headlines')
    .eq('ticker', ticker)
    .single()

  if (!stock) return NextResponse.json({ error: 'Stock not found' }, { status: 404 })

  const { data: scores } = await supabase
    .from('daily_scores')
    .select('pe_deviation, rsi, rsi_signal, classification, suggested_action, composite_score, date')
    .eq('stock_id', stock.id)
    .order('date', { ascending: false })
    .limit(1)

  return NextResponse.json({ stock, score: scores?.[0] ?? null })
}

