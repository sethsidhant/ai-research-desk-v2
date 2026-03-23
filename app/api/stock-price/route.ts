import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const stockId = searchParams.get('stockId')
  if (!stockId) return NextResponse.json({ error: 'Missing stockId' }, { status: 400 })

  const { data: stock } = await supabase
    .from('stocks')
    .select('current_price, instrument_token, ticker')
    .eq('id', stockId)
    .single()

  if (!stock) return NextResponse.json({ error: 'Stock not found' }, { status: 404 })

  // Try Kite for live price
  try {
    const apiKey = process.env.KITE_API_KEY
    let accessToken: string | undefined

    try {
      accessToken = fs.readFileSync(path.join(process.cwd(), '.kite_token'), 'utf8').trim()
    } catch { /* not available on Vercel */ }

    if (!accessToken) {
      const admin = createAdminClient()
      const { data } = await admin.from('app_settings').select('value').eq('key', 'kite_access_token').single()
      accessToken = data?.value ?? process.env.KITE_ACCESS_TOKEN
    }

    if (apiKey && accessToken && stock.instrument_token) {
      const res = await fetch(`https://api.kite.trade/quote?i=${stock.instrument_token}`, {
        headers: { 'X-Kite-Version': '3', 'Authorization': `token ${apiKey}:${accessToken}` },
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) {
        const json = await res.json()
        const key  = Object.keys(json.data ?? {})[0]
        const price = json.data?.[key]?.last_price
        if (price) return NextResponse.json({ price, source: 'live' })
      }
    }
  } catch { /* fall through to DB */ }

  // Fall back to DB current_price
  if (stock.current_price) {
    return NextResponse.json({ price: stock.current_price, source: 'db' })
  }

  return NextResponse.json({ error: 'Price unavailable' }, { status: 404 })
}
