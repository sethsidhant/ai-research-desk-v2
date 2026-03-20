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
  const accessToken = process.env.KITE_ACCESS_TOKEN
  return accessToken ? { apiKey, accessToken } : null
}

export type IndexQuote = {
  name:       string
  last:       number
  prevClose:  number
  change:     number
  changePct:  number
}

const INDICES = [
  { key: 'NSE:NIFTY 50',   label: 'NIFTY 50'   },
  { key: 'BSE:SENSEX',     label: 'SENSEX'      },
  { key: 'NSE:NIFTY BANK', label: 'BANK NIFTY'  },
]

let cache: { data: IndexQuote[]; ts: number } | null = null
const CACHE_TTL_MS = 15000

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return NextResponse.json({ indices: cache.data, cached: true })
  }

  const kite = await getKiteToken()
  if (!kite) {
    return NextResponse.json({ error: 'Kite credentials not configured' }, { status: 500 })
  }
  const { apiKey, accessToken } = kite

  const query = INDICES.map(i => `i=${encodeURIComponent(i.key)}`).join('&')

  try {
    const res = await fetch(`https://api.kite.trade/quote?${query}`, {
      headers: {
        'X-Kite-Version': '3',
        'Authorization': `token ${apiKey}:${accessToken}`,
      },
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) return NextResponse.json({ error: `Kite error: ${res.status}` }, { status: 502 })

    const json    = await res.json()
    const kiteMap = json.data ?? {}

    const indices: IndexQuote[] = INDICES.map(idx => {
      const d         = kiteMap[idx.key]
      const last      = d?.last_price   ?? 0
      const prevClose = d?.ohlc?.close  ?? 0
      const change    = d?.net_change   ?? 0
      const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0
      return { name: idx.label, last, prevClose, change, changePct }
    })

    cache = { data: indices, ts: Date.now() }
    return NextResponse.json({ indices })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 })
  }
}
