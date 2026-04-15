import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

async function getKiteToken(): Promise<{ apiKey: string; accessToken: string } | null> {
  const apiKey = process.env.KITE_API_KEY
  if (!apiKey) return null
  try {
    const accessToken = fs.readFileSync(path.join(process.cwd(), '.kite_token'), 'utf8').trim()
    if (accessToken) return { apiKey, accessToken }
  } catch {}
  try {
    const admin = createAdminClient()
    const { data } = await admin.from('app_settings').select('value').eq('key', 'kite_access_token').single()
    if (data?.value) return { apiKey, accessToken: data.value }
  } catch {}
  return process.env.KITE_ACCESS_TOKEN ? { apiKey, accessToken: process.env.KITE_ACCESS_TOKEN } : null
}

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const token = new URL(req.url).searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 })

  const kite = await getKiteToken()
  if (!kite) return NextResponse.json({ error: 'Kite not configured' }, { status: 500 })

  const to   = new Date()
  const from = new Date(Date.now() - 95 * 24 * 60 * 60 * 1000)
  const fmt  = (d: Date) => d.toISOString().slice(0, 10)

  try {
    const res = await fetch(
      `https://api.kite.trade/instruments/historical/${token}/day?from=${fmt(from)}&to=${fmt(to)}`,
      {
        headers: { 'X-Kite-Version': '3', 'Authorization': `token ${kite.apiKey}:${kite.accessToken}` },
        signal: AbortSignal.timeout(10000),
      }
    )
    if (!res.ok) return NextResponse.json({ error: `Kite error ${res.status}`, closes: [] })

    const json   = await res.json()
    if (json.error_type) return NextResponse.json({ error: json.message, closes: [] })

    const closes = (json.data?.candles ?? []).map((c: any[]) => ({
      date:  c[0].slice(0, 10),
      close: c[4],
    })).filter((c: any) => c.close > 0)

    return NextResponse.json({ closes })
  } catch (err: any) {
    return NextResponse.json({ error: err.message, closes: [] }, { status: 502 })
  }
}
