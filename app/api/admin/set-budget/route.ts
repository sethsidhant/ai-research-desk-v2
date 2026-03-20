import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.email !== process.env.ADMIN_EMAIL) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { budget } = await request.json()
  const value = parseFloat(budget)
  if (isNaN(value) || value < 0) return NextResponse.json({ error: 'Invalid budget' }, { status: 400 })

  const admin = createAdminClient()
  await admin.from('app_settings').upsert({ key: 'anthropic_credit_budget', value: value.toString() }, { onConflict: 'key' })

  return NextResponse.json({ ok: true })
}
