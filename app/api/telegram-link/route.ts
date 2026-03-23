import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

function randomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const code    = randomCode()
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString()

  const admin = createAdminClient()
  await admin.from('app_settings').upsert(
    { key: `telegram_link_${code}`, value: JSON.stringify({ user_id: user.id, expires }) },
    { onConflict: 'key' }
  )

  return NextResponse.json({
    code,
    botUsername: process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? '',
    expiresAt: expires,
  })
}
