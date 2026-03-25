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
  group:      string
}

export type Breadth    = { advances: number; declines: number; unchanged: number; total: number }
export type StockTile  = { sym: string; changePct: number }

// Nifty 50 constituents — changes ~twice/year at index rebalance
const NIFTY50_SYMBOLS = [
  'NSE:ADANIENT',  'NSE:ADANIPORTS', 'NSE:APOLLOHOSP', 'NSE:ASIANPAINT', 'NSE:AXISBANK',
  'NSE:BAJAJ-AUTO','NSE:BAJAJFINSV', 'NSE:BAJFINANCE',  'NSE:BEL',        'NSE:BHARTIARTL',
  'NSE:BPCL',      'NSE:BRITANNIA',  'NSE:CIPLA',       'NSE:COALINDIA',  'NSE:DRREDDY',
  'NSE:EICHERMOT', 'NSE:ETERNAL',    'NSE:GRASIM',      'NSE:HCLTECH',    'NSE:HDFCBANK',
  'NSE:HDFCLIFE',  'NSE:HEROMOTOCO', 'NSE:HINDALCO',    'NSE:HINDUNILVR', 'NSE:ICICIBANK',
  'NSE:INDUSINDBK','NSE:INFY',       'NSE:ITC',         'NSE:JIOFIN',     'NSE:JSWSTEEL',
  'NSE:KOTAKBANK', 'NSE:LT',         'NSE:M&M',         'NSE:MARUTI',     'NSE:NESTLEIND',
  'NSE:NTPC',      'NSE:ONGC',       'NSE:POWERGRID',   'NSE:RELIANCE',   'NSE:SBILIFE',
  'NSE:SBIN',      'NSE:SHRIRAMFIN', 'NSE:SUNPHARMA',   'NSE:TATACONSUM', 'NSE:TATAMOTORS',
  'NSE:TATASTEEL', 'NSE:TCS',        'NSE:TECHM',        'NSE:TITAN',      'NSE:ULTRACEMCO',
]

// Bank Nifty constituents (12 stocks)
const BANKNIFTY_SYMBOLS = [
  'NSE:HDFCBANK',   'NSE:ICICIBANK',  'NSE:KOTAKBANK',  'NSE:AXISBANK',
  'NSE:SBIN',       'NSE:INDUSINDBK', 'NSE:BANDHANBNK', 'NSE:FEDERALBNK',
  'NSE:IDFCFIRSTB', 'NSE:AUBANK',     'NSE:PNB',        'NSE:CANARABNK',
]

const INDICES = [
  { key: 'NSEIX:GIFT NIFTY',      label: 'GIFT NIFTY',   group: 'gift'   },
  { key: 'NSE:NIFTY 50',          label: 'NIFTY 50',     group: 'broad'  },
  { key: 'BSE:SENSEX',            label: 'SENSEX',        group: 'broad'  },
  { key: 'NSE:NIFTY BANK',        label: 'BANK NIFTY',   group: 'broad'  },
  { key: 'NSE:NIFTY 500',         label: 'NIFTY 500',    group: 'broad'  },
  { key: 'NSE:NIFTY MIDCAP 100',  label: 'MIDCAP 100',   group: 'broad'  },
  { key: 'NSE:NIFTY SMLCAP 100',  label: 'SMALLCAP 100', group: 'broad'  },
  { key: 'NSE:INDIA VIX',         label: 'VIX',          group: 'vix'    },
  { key: 'NSE:NIFTY IT',          label: 'IT',           group: 'sector' },
  { key: 'NSE:NIFTY PHARMA',      label: 'PHARMA',       group: 'sector' },
  { key: 'NSE:NIFTY AUTO',        label: 'AUTO',         group: 'sector' },
  { key: 'NSE:NIFTY FMCG',        label: 'FMCG',         group: 'sector' },
  { key: 'NSE:NIFTY METAL',       label: 'METAL',        group: 'sector' },
]

function computeBreadthAndTiles(symbols: string[], kiteMap: Record<string, any>) {
  let advances = 0, declines = 0, unchanged = 0
  const tiles: StockTile[] = []
  for (const sym of symbols) {
    const d = kiteMap[sym]
    if (!d?.last_price || !d?.ohlc?.close) continue
    const diff    = d.last_price - d.ohlc.close
    const pct     = parseFloat(((diff / d.ohlc.close) * 100).toFixed(2))
    if (diff > 0.01)       advances++
    else if (diff < -0.01) declines++
    else                   unchanged++
    tiles.push({ sym: sym.replace('NSE:', ''), changePct: pct })
  }
  tiles.sort((a, b) => b.changePct - a.changePct)
  const total: Breadth = { advances, declines, unchanged, total: advances + declines + unchanged }
  return { breadth: total, tiles }
}

let cache: {
  data:        IndexQuote[]
  breadth:     Breadth | null
  tiles:       StockTile[]
  bankBreadth: Breadth | null
  bankTiles:   StockTile[]
  ts:          number
} | null = null

const CACHE_TTL_MS       = 15000
const CACHE_STALE_TTL_MS = 24 * 60 * 60 * 1000

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return NextResponse.json({ indices: cache.data, breadth: cache.breadth, tiles: cache.tiles, bankBreadth: cache.bankBreadth, bankTiles: cache.bankTiles, cached: true })
  }

  const kite = await getKiteToken()
  if (!kite) {
    if (cache && Date.now() - cache.ts < CACHE_STALE_TTL_MS) {
      return NextResponse.json({ indices: cache.data, breadth: cache.breadth, tiles: cache.tiles, bankBreadth: cache.bankBreadth, bankTiles: cache.bankTiles, stale: true })
    }
    return NextResponse.json({ error: 'Kite credentials not configured' }, { status: 500 })
  }
  const { apiKey, accessToken } = kite

  const allSymbols = [...INDICES.map(i => i.key), ...NIFTY50_SYMBOLS, ...BANKNIFTY_SYMBOLS]
  // Deduplicate (AXISBANK, HDFCBANK etc appear in both lists)
  const uniqueSymbols = [...new Set(allSymbols)]
  const query = uniqueSymbols.map(s => `i=${encodeURIComponent(s)}`).join('&')

  try {
    const res = await fetch(`https://api.kite.trade/quote?${query}`, {
      headers: { 'X-Kite-Version': '3', 'Authorization': `token ${apiKey}:${accessToken}` },
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) {
      if (cache && Date.now() - cache.ts < CACHE_STALE_TTL_MS) {
        return NextResponse.json({ indices: cache.data, breadth: cache.breadth, tiles: cache.tiles, bankBreadth: cache.bankBreadth, bankTiles: cache.bankTiles, stale: true })
      }
      return NextResponse.json({ error: `Kite error: ${res.status}` }, { status: 502 })
    }

    const json    = await res.json()
    const kiteMap = json.data ?? {}

    const indices: IndexQuote[] = INDICES.map(idx => {
      const d         = kiteMap[idx.key]
      const last      = d?.last_price  ?? 0
      const prevClose = d?.ohlc?.close ?? 0
      const change    = (d?.net_change && d.net_change !== 0) ? d.net_change : (prevClose > 0 ? last - prevClose : 0)
      const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0
      return { name: idx.label, last, prevClose, change, changePct, group: idx.group }
    })

    const { breadth, tiles }                   = computeBreadthAndTiles(NIFTY50_SYMBOLS, kiteMap)
    const { breadth: bankBreadth, tiles: bankTiles } = computeBreadthAndTiles(BANKNIFTY_SYMBOLS, kiteMap)

    cache = { data: indices, breadth, tiles, bankBreadth, bankTiles, ts: Date.now() }
    return NextResponse.json({ indices, breadth, tiles, bankBreadth, bankTiles })

  } catch (err: any) {
    if (cache && Date.now() - cache.ts < CACHE_STALE_TTL_MS) {
      return NextResponse.json({ indices: cache.data, breadth: cache.breadth, tiles: cache.tiles, bankBreadth: cache.bankBreadth, bankTiles: cache.bankTiles, stale: true })
    }
    return NextResponse.json({ error: err.message }, { status: 502 })
  }
}
