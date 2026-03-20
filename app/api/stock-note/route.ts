import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { stock_id, notes } = await request.json()
  if (!stock_id) return NextResponse.json({ error: 'stock_id required' }, { status: 400 })

  const { error } = await supabase
    .from('user_stocks')
    .update({ notes: notes ?? null })
    .eq('user_id', user.id)
    .eq('stock_id', stock_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
