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

  const token         = process.env.RAILWAY_API_TOKEN
  const serviceId     = '0776fe66-63d4-4126-80a2-c9f39bde9862'
  const environmentId = 'f8c5fa5e-4db3-4629-a4c8-309461056a8d'

  if (!token) {
    return NextResponse.json({ error: 'RAILWAY_API_TOKEN not set in env' }, { status: 500 })
  }

  const res = await fetch('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `mutation { serviceInstanceRedeploy(serviceId: "${serviceId}", environmentId: "${environmentId}") }`,
    }),
  })

  const json = await res.json()
  if (json.errors?.length) {
    return NextResponse.json({ error: json.errors[0].message }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}
