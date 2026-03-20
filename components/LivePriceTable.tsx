'use client'

import { useEffect, useRef, useState } from 'react'
import { type WatchlistRow } from './WatchlistTable'
import WatchlistTable from './WatchlistTable'
import PortfolioChart, { type ChartPoint } from './PortfolioChart'

const POLL_INTERVAL = 15000

type PriceFlash    = 'up' | 'down' | null
type PriceChange   = { change: number; changePct: number }

export default function LivePriceTable({ initialRows, chartData }: { initialRows: WatchlistRow[]; chartData: ChartPoint[] }) {
  const [rows, setRows]             = useState<WatchlistRow[]>(initialRows)
  const [marketOpen, setMarketOpen] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [flashes, setFlashes]       = useState<Record<string, PriceFlash>>({})
  const [changes, setChanges]       = useState<Record<string, PriceChange>>({})
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
    // Carry benchmark forward from last known historical point (index_history updates after market close)
    const todayPoint: ChartPoint = {
      date:        todayLabel,
      returnPct:   todayPct,
      nifty50Pct:  last.nifty50Pct,
      nifty500Pct: last.nifty500Pct,
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

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Watchlist</h2>
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
              Updated {lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
        </div>
      </div>
      <WatchlistTable rows={rows} priceFlashes={flashes} priceChanges={changes} />
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
