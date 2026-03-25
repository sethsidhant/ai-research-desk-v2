import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminEmail = process.env.ADMIN_EMAIL
  if (adminEmail && user.email !== adminEmail) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const hookUrl = process.env.RAILWAY_DEPLOY_HOOK
  if (!hookUrl) {
    return NextResponse.json({ error: 'RAILWAY_DEPLOY_HOOK not set in env' }, { status: 500 })
  }

  const res = await fetch(hookUrl, { method: 'POST' })
  if (!res.ok) {
    return NextResponse.json({ error: `Railway hook ${res.status}` }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}
