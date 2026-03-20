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

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const ticker  = searchParams.get('ticker')
  const period  = searchParams.get('period') ?? '3m'
  if (!ticker) return NextResponse.json({ error: 'ticker required' }, { status: 400 })

  // Get instrument_token for the ticker
  const { data: stock } = await supabase
    .from('stocks')
    .select('instrument_token, stock_name')
    .eq('ticker', ticker)
    .single()

  if (!stock?.instrument_token) {
    return NextResponse.json({ error: 'Stock not found or no instrument token' }, { status: 404 })
  }

  const kite = await getKiteToken()
  if (!kite) return NextResponse.json({ error: 'Kite not configured' }, { status: 500 })

  // Calculate date range
  const to      = new Date()
  const from    = new Date()
  if (period === '1m')       from.setMonth(from.getMonth() - 1)
  else if (period === '3m')  from.setMonth(from.getMonth() - 3)
  else if (period === '6m')  from.setMonth(from.getMonth() - 6)
  else                       from.setFullYear(from.getFullYear() - 1)

  const fmt         = (d: Date) => d.toISOString().slice(0, 10)
  const displayFrom = fmt(from)

  // Fetch extra 280 calendar days of lookback so 200 DMA is available for any period
  const lookback = new Date(from)
  lookback.setDate(lookback.getDate() - 280)

  try {
    const res = await fetch(
      `https://api.kite.trade/instruments/historical/${stock.instrument_token}/day?from=${fmt(lookback)}&to=${fmt(to)}`,
      {
        headers: { 'X-Kite-Version': '3', 'Authorization': `token ${kite.apiKey}:${kite.accessToken}` },
        signal: AbortSignal.timeout(10000),
      }
    )
    if (!res.ok) return NextResponse.json({ error: `Kite error: ${res.status}` }, { status: 502 })

    const json   = await res.json()
    const candles = (json.data?.candles ?? []).map((c: any[]) => ({
      date:   c[0].slice(0, 10),
      open:   c[1],
      high:   c[2],
      low:    c[3],
      close:  c[4],
      volume: c[5],
    }))

    return NextResponse.json({ ticker, candles, displayFrom })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 })
  }
}
