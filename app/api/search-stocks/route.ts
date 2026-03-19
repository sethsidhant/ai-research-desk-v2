import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const q = new URL(request.url).searchParams.get('q')?.trim() ?? ''
  if (q.length < 1) return NextResponse.json([])

  // Search by ticker (exact prefix first) or stock_name (contains)
  const { data } = await supabase
    .from('stocks')
    .select('id, ticker, stock_name, industry')
    .or(`ticker.ilike.${q}%,stock_name.ilike.%${q}%`)
    .order('ticker')
    .limit(20)

  return NextResponse.json(data ?? [])
}
