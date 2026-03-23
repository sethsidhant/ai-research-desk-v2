'use client'

import { useEffect, useRef, useState } from 'react'
import { type WatchlistRow } from './WatchlistTable'
import WatchlistTable from './WatchlistTable'
import PortfolioChart, { type ChartPoint } from './PortfolioChart'

const POLL_INTERVAL = 15000

type PriceFlash    = 'up' | 'down' | null
type PriceChange   = { change: number; changePct: number }

type FilterKey = 'all' | 'cheap' | 'discount' | 'fair' | 'premium' | 'expensive' | 'oversold' | 'overbought'

function applyFilter(rows: WatchlistRow[], filter: FilterKey): WatchlistRow[] {
  switch (filter) {
    case 'cheap':     return rows.filter(r => r.pe_deviation != null && r.pe_deviation < -30)
    case 'discount':  return rows.filter(r => r.pe_deviation != null && r.pe_deviation >= -30 && r.pe_deviation < -10)
    case 'fair':      return rows.filter(r => r.pe_deviation != null && r.pe_deviation >= -10 && r.pe_deviation <= 10)
    case 'premium':   return rows.filter(r => r.pe_deviation != null && r.pe_deviation > 10 && r.pe_deviation <= 30)
    case 'expensive': return rows.filter(r => r.pe_deviation != null && r.pe_deviation > 30)
    case 'oversold':  return rows.filter(r => r.rsi != null && r.rsi < 30)
    case 'overbought':return rows.filter(r => r.rsi != null && r.rsi > 70)
    default:          return rows
  }
}

export default function LivePriceTable({ initialRows, chartData }: { initialRows: WatchlistRow[]; chartData: ChartPoint[] }) {
  const [rows, setRows]             = useState<WatchlistRow[]>(initialRows)
  const [marketOpen, setMarketOpen] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [flashes, setFlashes]       = useState<Record<string, PriceFlash>>({})
  const [changes, setChanges]       = useState<Record<string, PriceChange>>({})
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all')
  const prevPrices                  = useRef<Record<string, number>>({})

  // Live portfolio P&L — recomputes whenever rows update with new prices
  const portfolioRows = rows.filter(r => r.invested_amount && r.entry_price && r.current_price)
  const totalInvested = portfolioRows.reduce((s, r) => s + r.invested_amount!, 0)
  const totalCurrent  = portfolioRows.reduce((s, r) => s + (r.current_price! / r.entry_price!) * r.invested_amount!, 0)
  const totalPnl      = totalCurrent - totalInvested
  const totalPnlPct   = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0

  // Append live "today" point to historical chart data
  const liveChartData: ChartPoint[] = (() => {
    if (totalInvested === 0 || chartData.length === 0) return chartData
    const todayLabel = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    const todayPct   = parseFloat(((totalCurrent - totalInvested) / totalInvested * 100).toFixed(2))
    const last = chartData[chartData.length - 1]
    // Carry benchmark from last point that has it (index_history only has closes, not intraday)
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

  async function fetchPrices() {
    try {
      const res  = await fetch('/api/live-prices')
      const json = await res.json()

      setMarketOpen(json.marketOpen ?? false)
      if (!json.marketOpen || !json.prices) return

      const prices: Record<string, { last: number; change: number; changePct: number }> = json.prices

      // Compute flashes + changes from prices directly (not inside setRows updater)
      const newFlashes: Record<string, PriceFlash> = {}
      const newChanges: Record<string, PriceChange> = {}
      for (const [ticker, live] of Object.entries(prices)) {
        const prev_ = prevPrices.current[ticker]
        if (prev_ != null && live.last !== prev_) {
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
    } catch { /* silent fail */ }
  }

  useEffect(() => {
    fetchPrices()
    const id = setInterval(fetchPrices, POLL_INTERVAL)
    return () => clearInterval(id)
  }, [])

  return (
    <div>
      {liveChartData.length >= 2 && (
        <div className="bg-white border border-gray-200 rounded-xl px-4 sm:px-6 py-4 shadow-sm mb-8">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Interested Portfolio Return</div>
          <PortfolioChart data={liveChartData} />
        </div>
      )}

      {totalInvested > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <PLCard label="Interested"   value={`₹${totalInvested.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} />
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
      )}

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-900">
          Watchlist
          <span className="ml-2 text-sm font-normal text-gray-400">{rows.length} stocks</span>
        </h2>
        <div className="flex items-center gap-3">
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
              {lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {([
          { key: 'all',       label: 'All',        count: rows.length,                                   color: 'gray' },
          { key: 'cheap',     label: 'Cheap',      count: applyFilter(rows,'cheap').length,      color: 'green' },
          { key: 'discount',  label: 'Discount',   count: applyFilter(rows,'discount').length,   color: 'green' },
          { key: 'fair',      label: 'Fair',        count: applyFilter(rows,'fair').length,       color: 'gray' },
          { key: 'premium',   label: 'Premium',     count: applyFilter(rows,'premium').length,    color: 'amber' },
          { key: 'expensive', label: 'Expensive',   count: applyFilter(rows,'expensive').length,  color: 'red' },
          { key: 'oversold',  label: 'Oversold',    count: applyFilter(rows,'oversold').length,   color: 'blue' },
          { key: 'overbought',label: 'Overbought',  count: applyFilter(rows,'overbought').length, color: 'orange' },
        ] as const).filter(f => f.key === 'all' || f.count > 0).map(({ key, label, count, color }) => {
          const active = activeFilter === key
          const base = 'px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors cursor-pointer'
          const styles: Record<string, string> = {
            gray:   active ? 'bg-gray-800 text-white border-gray-800'       : 'bg-gray-50 text-gray-500 border-gray-200 hover:border-gray-400',
            green:  active ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:border-emerald-400',
            amber:  active ? 'bg-amber-500 text-white border-amber-500'     : 'bg-amber-50 text-amber-700 border-amber-200 hover:border-amber-400',
            red:    active ? 'bg-red-600 text-white border-red-600'         : 'bg-red-50 text-red-600 border-red-200 hover:border-red-400',
            blue:   active ? 'bg-blue-600 text-white border-blue-600'       : 'bg-blue-50 text-blue-600 border-blue-200 hover:border-blue-400',
            orange: active ? 'bg-orange-500 text-white border-orange-500'   : 'bg-orange-50 text-orange-600 border-orange-200 hover:border-orange-400',
          }
          return (
            <button key={key} onClick={() => setActiveFilter(key)} className={`${base} ${styles[color]}`}>
              {label} <span className="opacity-70 ml-0.5">{count}</span>
            </button>
          )
        })}
      </div>

      <WatchlistTable rows={applyFilter(rows, activeFilter)} priceFlashes={flashes} priceChanges={changes} />
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
