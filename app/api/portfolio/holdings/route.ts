import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// POST — manually add or update a single holding
export async function POST(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const { stock_id, quantity, avg_price, broker } = body
  if (!stock_id || !quantity || !avg_price) {
    return NextResponse.json({ error: 'stock_id, quantity and avg_price are required' }, { status: 400 })
  }
  if (quantity <= 0 || avg_price <= 0) {
    return NextResponse.json({ error: 'quantity and avg_price must be positive' }, { status: 400 })
  }

  const { error } = await supabase
    .from('portfolio_holdings')
    .upsert({
      user_id:       user.id,
      stock_id,
      quantity,
      avg_price,
      broker:        broker ?? 'Manual',
      import_source: 'manual',
      updated_at:    new Date().toISOString(),
    }, { onConflict: 'user_id,stock_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

// DELETE — remove a single holding
export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { stock_id } = await request.json().catch(() => ({}))
  if (!stock_id) return NextResponse.json({ error: 'stock_id required' }, { status: 400 })

  const { error } = await supabase
    .from('portfolio_holdings')
    .delete()
    .eq('user_id', user.id)
    .eq('stock_id', stock_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
