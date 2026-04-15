import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

// All Indian indices are stored in index_history — always served from Supabase (reliable from Vercel).
// Kite historical API is used only as a fallback for any token not in this map.
const SUPABASE_COL: Record<string, string> = {
  '256265': 'nifty50_close',
  '268041': 'nifty500_close',
  '260105': 'banknifty_close',
  '265':    'sensex_close',
  '256777': 'midcap100_close',
  '267017': 'smallcap100_close',
  '259849': 'nifty_it_close',
  '262409': 'nifty_pharma_close',
  '263433': 'nifty_auto_close',
  '261897': 'nifty_fmcg_close',
  '263689': 'nifty_metal_close',
}

async function getKiteToken() {
  const apiKey = process.env.KITE_API_KEY
  if (!apiKey) return null
  try {
    const t = fs.readFileSync(path.join(process.cwd(), '.kite_token'), 'utf8').trim()
    if (t) return { apiKey, accessToken: t }
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
  if (!user) return NextResponse.json({ closes: [] }, { status: 401 })

  const token = new URL(req.url).searchParams.get('token')
  if (!token) return NextResponse.json({ closes: [] }, { status: 400 })

  const since = new Date(Date.now() - 95 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  // Nifty50 + Nifty500: serve from index_history in Supabase
  const col = SUPABASE_COL[token]
  if (col) {
    const { data } = await supabase
      .from('index_history')
      .select(`date, ${col}`)
      .gte('date', since)
      .order('date', { ascending: true })

    const closes = (data ?? [])
      .filter((r: any) => r[col] != null && r[col] > 0)
      .map((r: any) => ({ date: r.date, close: r[col] }))

    return NextResponse.json({ closes })
  }

  // All other indices: Kite historical API (same pattern as /api/stock-chart)
  const kite = await getKiteToken()
  if (!kite) return NextResponse.json({ closes: [], error: 'kite_not_configured' })

  const to  = new Date().toISOString().slice(0, 10)

  try {
    const res = await fetch(
      `https://api.kite.trade/instruments/historical/${token}/day?from=${since}&to=${to}`,
      {
        headers: { 'X-Kite-Version': '3', 'Authorization': `token ${kite.apiKey}:${kite.accessToken}` },
        signal: AbortSignal.timeout(10000),
      }
    )
    if (!res.ok) return NextResponse.json({ closes: [], error: `kite_${res.status}` })
    const json = await res.json()
    if (json.error_type) return NextResponse.json({ closes: [], error: json.message })

    const closes = (json.data?.candles ?? [])
      .map((c: any[]) => ({ date: c[0].slice(0, 10), close: c[4] }))
      .filter((c: any) => c.close > 0)

    return NextResponse.json({ closes })
  } catch (e: any) {
    return NextResponse.json({ closes: [], error: e.message })
  }
}
