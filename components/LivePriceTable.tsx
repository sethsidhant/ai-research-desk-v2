'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { type WatchlistRow } from './WatchlistTable'
import WatchlistTable from './WatchlistTable'
import PortfolioChart, { type ChartPoint } from './PortfolioChart'

const POLL_INTERVAL        = 15000
const ONBOARD_POLL_INTERVAL = 8000

type PriceFlash  = 'up' | 'down' | null
type PriceChange = { change: number; changePct: number }
type FilterKey   = 'all' | 'cheap' | 'discount' | 'fair' | 'premium' | 'expensive' | 'oversold' | 'overbought'

function applyFilter(rows: WatchlistRow[], filter: FilterKey): WatchlistRow[] {
  switch (filter) {
    case 'cheap':      return rows.filter(r => r.pe_deviation != null && r.pe_deviation < -30)
    case 'discount':   return rows.filter(r => r.pe_deviation != null && r.pe_deviation >= -30 && r.pe_deviation < -10)
    case 'fair':       return rows.filter(r => r.pe_deviation != null && r.pe_deviation >= -10 && r.pe_deviation <= 10)
    case 'premium':    return rows.filter(r => r.pe_deviation != null && r.pe_deviation > 10 && r.pe_deviation <= 30)
    case 'expensive':  return rows.filter(r => r.pe_deviation != null && r.pe_deviation > 30)
    case 'oversold':   return rows.filter(r => r.rsi != null && r.rsi < 30)
    case 'overbought': return rows.filter(r => r.rsi != null && r.rsi > 70)
    default:           return rows
  }
}

const SHORT_SECTOR: Record<string, string> = {
  'Financial Services':               'Financials',
  'Information Technology':           'IT',
  'Oil, Gas & Consumable Fuels':      'Oil & Gas',
  'Automobile and Auto Components':   'Auto',
  'Fast Moving Consumer Goods':       'FMCG',
  'Capital Goods':                    'Cap Goods',
  'Consumer Services':                'Consumer Svcs',
  'Metals & Mining':                  'Metals',
  'Telecommunication':                'Telecom',
  'Realty':                           'Realty',
  'Power':                            'Power',
  'Construction':                     'Construction',
  'Chemicals':                        'Chemicals',
  'Healthcare':                       'Healthcare',
  'Media Entertainment & Publication':'Media',
}

function decodeSector(s: string) { return s.replace(/&amp;/g, '&') }

function fmtCr(n: number) {
  const abs = Math.abs(n)
  if (abs >= 100000) return `₹${(n / 100000).toFixed(1)}L Cr`
  if (abs >= 1000)   return `₹${(n / 1000).toFixed(1)}k Cr`
  return `₹${n.toLocaleString('en-IN')} Cr`
}

type FiiDiiRow = { date: string; fii_net: number; dii_net: number }

function FIIOverviewCard({
  sectors, fiiDii,
}: {
  sectors: { sector: string; fortnight_flow: number | null }[]
  fiiDii:  FiiDiiRow | null
}) {
  const valid = sectors
    .map(s => ({ name: decodeSector(s.sector), flow: s.fortnight_flow ?? 0 }))
    .filter(s => s.flow !== 0)
    .sort((a, b) => b.flow - a.flow)

  const top2 = valid.slice(0, 2)
  const bot2 = valid.slice(-2).reverse()

  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm">

      {/* FII / DII daily row */}
      {fiiDii && (
        <>
          <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2">
            FII / DII · {new Date(fiiDii.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </div>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className={`rounded-lg px-3 py-2 ${fiiDii.fii_net >= 0 ? 'bg-emerald-50 border border-emerald-100' : 'bg-red-50 border border-red-100'}`}>
              <div className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 mb-0.5">FII Net</div>
              <div className={`text-sm font-bold font-mono ${fiiDii.fii_net >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {fiiDii.fii_net >= 0 ? '▲' : '▼'} {fmtCr(Math.abs(fiiDii.fii_net))}
              </div>
            </div>
            <div className={`rounded-lg px-3 py-2 ${fiiDii.dii_net >= 0 ? 'bg-emerald-50 border border-emerald-100' : 'bg-red-50 border border-red-100'}`}>
              <div className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 mb-0.5">DII Net</div>
              <div className={`text-sm font-bold font-mono ${fiiDii.dii_net >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {fiiDii.dii_net >= 0 ? '▲' : '▼'} {fmtCr(Math.abs(fiiDii.dii_net))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Sector flow */}
      {valid.length > 0 && (
        <>
          <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Sector Flow · Fortnight</div>
          <div className="space-y-1.5">
            {top2.map(s => (
              <div key={s.name} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                  <span className="text-[11px] text-gray-700 truncate">{SHORT_SECTOR[s.name] ?? s.name}</span>
                </div>
                <span className="text-[11px] font-mono font-semibold text-emerald-600 shrink-0">{fmtCr(s.flow)}</span>
              </div>
            ))}
            <div className="border-t border-gray-100 my-1" />
            {bot2.map(s => (
              <div key={s.name} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                  <span className="text-[11px] text-gray-700 truncate">{SHORT_SECTOR[s.name] ?? s.name}</span>
                </div>
                <span className="text-[11px] font-mono font-semibold text-red-500 shrink-0">{fmtCr(s.flow)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function MoversStrip({
  rows, changes,
}: {
  rows:    WatchlistRow[]
  changes: Record<string, PriceChange>
}) {
  const withChange = rows
    .filter(r => changes[r.ticker] != null)
    .map(r => ({ ticker: r.ticker, name: r.stock_name, pct: changes[r.ticker].changePct }))
    .sort((a, b) => b.pct - a.pct)

  if (withChange.length < 2) return null

  const gainers = withChange.slice(0, 3)
  const losers  = withChange.slice(-3).reverse()

  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm">
      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2.5">Watchlist Movers · Today</div>
      <div className="space-y-1">
        {gainers.map(s => (
          <div key={s.ticker} className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
              <span className="text-[11px] font-mono font-semibold text-gray-800">{s.ticker}</span>
            </div>
            <span className="text-[11px] font-mono font-semibold text-emerald-600">+{s.pct.toFixed(2)}%</span>
          </div>
        ))}
        <div className="border-t border-gray-100 my-1" />
        {losers.map(s => (
          <div key={s.ticker} className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
              <span className="text-[11px] font-mono font-semibold text-gray-800">{s.ticker}</span>
            </div>
            <span className="text-[11px] font-mono font-semibold text-red-500">{s.pct.toFixed(2)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function LivePriceTable({
  initialRows, chartData, fiiSectors = [], fiiDii = null,
}: {
  initialRows: WatchlistRow[]
  chartData:   ChartPoint[]
  fiiSectors?: { sector: string; fortnight_flow: number | null }[]
  fiiDii?:     FiiDiiRow | null
}) {
  const router                          = useRouter()
  const searchParams                    = useSearchParams()
  const [rows, setRows]                 = useState<WatchlistRow[]>(initialRows)
  const [marketOpen, setMarketOpen]     = useState(false)
  const [lastUpdated, setLastUpdated]   = useState<Date | null>(null)
  const [secondsSince, setSecondsSince] = useState(0)
  const [flashes, setFlashes]           = useState<Record<string, PriceFlash>>({})
  const [changes, setChanges]           = useState<Record<string, PriceChange>>({})
  const [activeFilter, setActiveFilter] = useState<FilterKey>(
    (searchParams.get('filter') as FilterKey) ?? 'all'
  )
  const prevPrices                      = useRef<Record<string, number>>({})

  const portfolioRows = rows.filter(r => r.invested_amount && r.entry_price && r.current_price)
  const totalInvested = portfolioRows.reduce((s, r) => s + r.invested_amount!, 0)
  const totalCurrent  = portfolioRows.reduce((s, r) => s + (r.current_price! / r.entry_price!) * r.invested_amount!, 0)
  const totalPnl      = totalCurrent - totalInvested
  const totalPnlPct   = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0

  const liveChartData: ChartPoint[] = (() => {
    if (totalInvested === 0 || chartData.length === 0) return chartData
    const todayLabel = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    const todayPct   = parseFloat(((totalCurrent - totalInvested) / totalInvested * 100).toFixed(2))
    const last = chartData[chartData.length - 1]
    const lastWithBenchmark = [...chartData].reverse().find(d => d.nifty50Pct != null)
    const todayPoint: ChartPoint = {
      date:        todayLabel,
      returnPct:   todayPct,
      nifty50Pct:  lastWithBenchmark?.nifty50Pct,
      nifty500Pct: lastWithBenchmark?.nifty500Pct,
    }
    if (last.date === todayLabel) return [...chartData.slice(0, -1), todayPoint]
    return [...chartData, todayPoint]
  })()

  useEffect(() => {
    let id: ReturnType<typeof setInterval>
    async function poll() {
      const res  = await fetch('/api/live-prices').catch(() => null)
      if (!res) return
      const json = await res.json().catch(() => null)
      if (!json) return
      const isOpen = json.marketOpen ?? false
      setMarketOpen(isOpen)
      if (!json.prices) return
      const prices: Record<string, { last: number; change: number; changePct: number }> = json.prices
      const newFlashes: Record<string, PriceFlash>  = {}
      const newChanges: Record<string, PriceChange> = {}
      for (const [ticker, live] of Object.entries(prices)) {
        const prev_ = prevPrices.current[ticker]
        if (isOpen && prev_ != null && live.last !== prev_) {
          newFlashes[ticker] = live.last > prev_ ? 'up' : 'down'
        }
        prevPrices.current[ticker] = live.last
        newChanges[ticker] = { change: live.change, changePct: live.changePct }
      }
      setRows(prev => prev.map(row => {
        const live = prices[row.ticker]
        return live ? { ...row, current_price: live.last } : row
      }))
      setChanges(newChanges)
      if (Object.keys(newFlashes).length > 0) {
        setFlashes(newFlashes)
        setTimeout(() => setFlashes({}), 1500)
      }
      setLastUpdated(new Date())
      if (!isOpen) clearInterval(id)
    }
    poll()
    id = setInterval(poll, POLL_INTERVAL)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const pending = initialRows.filter(r => r.composite_score == null).map(r => r.ticker)
    if (!pending.length) return
    const id = setInterval(async () => {
      try {
        const res  = await fetch('/api/onboard-status?tickers=' + pending.join(','))
        const json = await res.json()
        if (json.ready) { clearInterval(id); router.refresh() }
      } catch { /* silent */ }
    }, ONBOARD_POLL_INTERVAL)
    return () => clearInterval(id)
  }, [initialRows])

  useEffect(() => {
    if (!lastUpdated) return
    setSecondsSince(0)
    const id = setInterval(() => {
      setSecondsSince(Math.floor((Date.now() - lastUpdated.getTime()) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [lastUpdated])

  function handleFilterChange(key: FilterKey) {
    setActiveFilter(key)
    const params = new URLSearchParams(searchParams.toString())
    if (key === 'all') params.delete('filter')
    else params.set('filter', key)
    router.replace(`/watchlist?${params.toString()}`, { scroll: false })
  }

  const showMovers = marketOpen && Object.keys(changes).length > 0

  return (
    <div>
      {liveChartData.length >= 2 && (
        <div className="bg-white border border-gray-200 rounded-xl px-4 sm:px-6 py-4 shadow-sm mb-6">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Portfolio Return</div>
          <PortfolioChart data={liveChartData} />
        </div>
      )}

      {totalInvested > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Virtual P&L Simulation</span>
            <span className="text-[9px] bg-amber-50 text-amber-600 border border-amber-200 px-1.5 py-0.5 rounded-full font-semibold">Based on interested entry price</span>
          </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <PLCard label="Interested Entry"     value={`₹${totalInvested.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} />
          <PLCard label="Current Value" value={`₹${totalCurrent.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} />
          <PLCard
            label="Total P&L"
            value={`${totalPnl >= 0 ? '+' : ''}₹${Math.abs(totalPnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`}
            highlight={totalPnl >= 0 ? 'green' : 'red'}
          />
          <PLCard
            label="Return"
            value={`${totalPnlPct >= 0 ? '+' : ''}${totalPnlPct.toFixed(1)}%`}
            highlight={totalPnlPct >= 0 ? 'green' : 'red'}
          />
        </div>
        </div>
      )}

      {/* FII Overview + Movers — side by side */}
      {(fiiSectors.length > 0 || fiiDii || showMovers) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          {(fiiSectors.length > 0 || fiiDii) && <FIIOverviewCard sectors={fiiSectors} fiiDii={fiiDii} />}
          {showMovers && <MoversStrip rows={rows} changes={changes} />}
        </div>
      )}

      <div className="flex items-center justify-end mb-3 gap-3">
        {marketOpen ? (
          <span className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            LIVE · 15s
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-xs text-gray-400 bg-gray-100 border border-gray-200 px-2.5 py-1 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
            MARKET CLOSED
          </span>
        )}
        {lastUpdated && (
          <span className="text-xs text-gray-400">
            {secondsSince < 5 ? 'Updated just now' : `Updated ${secondsSince}s ago`}
          </span>
        )}
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {([
          { key: 'all',        label: 'All',       count: rows.length,                          color: 'gray'   },
          { key: 'cheap',      label: 'Cheap',     count: applyFilter(rows,'cheap').length,     color: 'green'  },
          { key: 'discount',   label: 'Discount',  count: applyFilter(rows,'discount').length,  color: 'green'  },
          { key: 'fair',       label: 'Fair',       count: applyFilter(rows,'fair').length,      color: 'gray'   },
          { key: 'premium',    label: 'Premium',    count: applyFilter(rows,'premium').length,   color: 'amber'  },
          { key: 'expensive',  label: 'Expensive',  count: applyFilter(rows,'expensive').length, color: 'red'    },
          { key: 'oversold',   label: 'Oversold',   count: applyFilter(rows,'oversold').length,  color: 'blue'   },
          { key: 'overbought', label: 'Overbought', count: applyFilter(rows,'overbought').length,color: 'orange' },
        ] as const).filter(f => f.key === 'all' || f.count > 0).map(({ key, label, count, color }) => {
          const active = activeFilter === key
          const base   = 'px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors cursor-pointer'
          const styles: Record<string, string> = {
            gray:   active ? 'bg-gray-800 text-white border-gray-800'       : 'bg-gray-50 text-gray-500 border-gray-200 hover:border-gray-400',
            green:  active ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:border-emerald-400',
            amber:  active ? 'bg-amber-500 text-white border-amber-500'     : 'bg-amber-50 text-amber-700 border-amber-200 hover:border-amber-400',
            red:    active ? 'bg-red-600 text-white border-red-600'         : 'bg-red-50 text-red-600 border-red-200 hover:border-red-400',
            blue:   active ? 'bg-blue-600 text-white border-blue-600'       : 'bg-blue-50 text-blue-600 border-blue-200 hover:border-blue-400',
            orange: active ? 'bg-orange-500 text-white border-orange-500'   : 'bg-orange-50 text-orange-600 border-orange-200 hover:border-orange-400',
          }
          return (
            <button key={key} onClick={() => handleFilterChange(key)} className={`${base} ${styles[color]}`}>
              {label} <span className="opacity-70 ml-0.5">{count}</span>
            </button>
          )
        })}
      </div>

      <WatchlistTable rows={applyFilter(rows, activeFilter)} priceFlashes={flashes} priceChanges={changes} fiiSectors={fiiSectors} />
    </div>
  )
}

function PLCard({ label, value, highlight }: { label: string; value: string; highlight?: 'green' | 'red' }) {
  const valueColor = highlight === 'green' ? 'text-emerald-600' : highlight === 'red' ? 'text-red-600' : 'text-gray-900'
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-4 shadow-sm">
      <div className={`text-2xl font-bold ${valueColor}`}>{value}</div>
      <div className="text-xs text-gray-400 mt-1">{label}</div>
    </div>
  )
}
