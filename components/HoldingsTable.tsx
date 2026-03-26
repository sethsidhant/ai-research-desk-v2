'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { type WatchlistRow } from './WatchlistTable'
import FundamentalsDrawer from './FundamentalsDrawer'
import StockChartPanel from './StockChartPanel'
import { getValuationBand, peDeviationColor } from './ClassificationBadge'
import { INDUSTRY_TO_FII_SECTOR } from '@/lib/fiiSectorMap'

export type HoldingRow = {
  stock_id:         string
  ticker:           string
  stock_name:       string
  industry:         string | null
  current_price:    number | null
  avg_price:        number
  quantity:         number
  broker:           string | null
  investment_date:  string | null
  // from stocks table
  stock_pe:         number | null
  industry_pe:      number | null
  high_52w:         number | null
  low_52w:          number | null
  // volume (vs 20-day avg)
  vol_yesterday:    number | null
  vol_avg_20d:      number | null
  vol_ratio:        number | null
  // from daily_scores
  pe_deviation:     number | null
  rsi:              number | null
  rsi_signal:       string | null
  composite_score:  number | null
  classification:   string | null
  suggested_action: string | null
  above_200_dma:    boolean | null
  above_50_dma:     boolean | null
  dma_50:           number | null
  dma_200:          number | null
}

type SortKey = 'allocation' | 'returnPct' | 'pnl' | 'ticker'
type SortDir = 'asc' | 'desc'

function fmt(n: number, decimals = 0) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtCurrency(n: number) {
  const abs = Math.abs(n)
  if (abs >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`
  if (abs >= 100000)   return `₹${(n / 100000).toFixed(2)}L`
  if (abs >= 1000)     return `₹${(n / 1000).toFixed(1)}k`
  return `₹${fmt(n)}`
}

function TaxBadge({ date }: { date: string | null }) {
  if (!date) return null
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86400000)
  if (days < 0) return null
  const ltcg = days >= 365
  return (
    <span
      className={`text-[9px] font-bold px-1 py-0.5 rounded ${ltcg ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}
      title={`${days}d held · ${ltcg ? 'LTCG (12.5%)' : 'STCG (20%)'}`}
    >
      {ltcg ? 'LTCG' : 'STCG'} {days >= 365 ? `${Math.floor(days / 365)}y` : `${days}d`}
    </span>
  )
}

function DMADot({ above }: { above: boolean | null }) {
  if (above == null) return <span className="text-gray-300 text-[10px]">—</span>
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${above ? 'bg-emerald-500' : 'bg-red-400'}`} title={above ? 'Above DMA' : 'Below DMA'} />
  )
}

export default function HoldingsTable({
  initialRows,
  totalInvested,
  detailMap,
  fiiFlows,
}: {
  initialRows:   HoldingRow[]
  totalInvested: number
  detailMap?:    Record<string, WatchlistRow>
  fiiFlows?:     Record<string, number>
}) {
  const router                          = useRouter()
  const [rows, setRows]                 = useState<HoldingRow[]>(initialRows)
  const [marketOpen, setMarketOpen]     = useState(false)
  const [lastUpdated, setLastUpdated]   = useState<Date | null>(null)
  const [secondsSince, setSecondsSince] = useState(0)
  const [flashes, setFlashes]           = useState<Record<string, 'up' | 'down' | null>>({})
  const [sortKey, setSortKey]           = useState<SortKey>('allocation')
  const [sortDir, setSortDir]           = useState<SortDir>('desc')
  const [deleting, setDeleting]         = useState<string | null>(null)
  const prevPrices                      = useRef<Record<string, number>>({})

  // Expand/details state
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Per-row AI brief state
  const [briefs, setBriefs]           = useState<Record<string, string>>({})
  const [briefLoading, setBriefLoading] = useState<Record<string, boolean>>({})
  const [briefError, setBriefError]   = useState<Record<string, string>>({})

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm]   = useState<{ quantity: string; avg_price: string; broker: string; investment_date: string } | null>(null)
  const [saving, setSaving]       = useState(false)

  // Panel state (news + fundamentals + chart — open as drawers)
  const [newsDrawer, setNewsDrawer]             = useState<string | null>(null)      // ticker
  const [fundamentalsRow, setFundamentalsRow]   = useState<WatchlistRow | null>(null)
  const [chartRow, setChartRow]                 = useState<WatchlistRow | null>(null)

  // Live price polling
  useEffect(() => {
    let id: ReturnType<typeof setInterval>
    async function poll() {
      const res  = await fetch('/api/portfolio/live-prices').catch(() => null)
      if (!res) return
      const json = await res.json().catch(() => null)
      if (!json?.prices) return

      setMarketOpen(json.marketOpen ?? false)

      const newFlashes: Record<string, 'up' | 'down' | null> = {}
      for (const [ticker, live] of Object.entries(json.prices as Record<string, { last: number }>)) {
        const prev = prevPrices.current[ticker]
        if (json.marketOpen && prev != null && live.last !== prev) {
          newFlashes[ticker] = live.last > prev ? 'up' : 'down'
        }
        prevPrices.current[ticker] = live.last
      }

      setRows(prev => prev.map(row => {
        const live = (json.prices as any)[row.ticker]
        return live ? { ...row, current_price: live.last } : row
      }))

      if (Object.keys(newFlashes).length > 0) {
        setFlashes(newFlashes)
        setTimeout(() => setFlashes({}), 1500)
      }
      setLastUpdated(new Date())
      if (!json.marketOpen) clearInterval(id)
    }
    poll()
    id = setInterval(poll, 15000)
    return () => clearInterval(id)
  }, [])

  // Seconds-since counter
  useEffect(() => {
    if (!lastUpdated) return
    setSecondsSince(0)
    const id = setInterval(() => {
      setSecondsSince(Math.floor((Date.now() - lastUpdated.getTime()) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [lastUpdated])

  async function handleDelete(stockId: string) {
    if (!confirm('Remove this holding?')) return
    setDeleting(stockId)
    try {
      await fetch('/api/portfolio/holdings', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stock_id: stockId }),
      })
      router.refresh()
    } finally {
      setDeleting(null)
    }
  }

  async function requestBrief(ticker: string) {
    setBriefLoading(p => ({ ...p, [ticker]: true }))
    setBriefError(p => ({ ...p, [ticker]: '' }))
    try {
      const res  = await fetch('/api/stock-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker }),
      })
      const json = await res.json()
      if (json.error) { setBriefError(p => ({ ...p, [ticker]: json.error })); return }
      setBriefs(p => ({ ...p, [ticker]: json.brief }))
    } catch (e: any) {
      setBriefError(p => ({ ...p, [ticker]: 'Failed to load brief' }))
    } finally {
      setBriefLoading(p => ({ ...p, [ticker]: false }))
    }
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const computedRows = rows.map(row => {
    const invested     = row.quantity * row.avg_price
    const currentPrice = row.current_price ?? row.avg_price
    const currentValue = row.quantity * currentPrice
    const pnl          = currentValue - invested
    const returnPct    = invested > 0 ? (pnl / invested) * 100 : 0
    const allocation   = totalInvested > 0 ? (invested / totalInvested) * 100 : 0
    return { ...row, invested, currentValue, pnl, returnPct, allocation }
  })

  const sorted = [...computedRows].sort((a, b) => {
    const mul = sortDir === 'desc' ? -1 : 1
    switch (sortKey) {
      case 'allocation': return mul * (a.allocation - b.allocation)
      case 'returnPct':  return mul * (a.returnPct - b.returnPct)
      case 'pnl':        return mul * (a.pnl - b.pnl)
      case 'ticker':     return mul * a.ticker.localeCompare(b.ticker)
      default:           return 0
    }
  })

  function startEdit(row: typeof computedRows[0]) {
    setEditingId(row.stock_id)
    setExpandedId(null)
    setEditForm({
      quantity:        String(row.quantity),
      avg_price:       String(row.avg_price),
      broker:          row.broker ?? '',
      investment_date: row.investment_date ?? '',
    })
  }

  async function saveEdit(stockId: string) {
    if (!editForm) return
    const qty   = parseFloat(editForm.quantity)
    const price = parseFloat(editForm.avg_price)
    if (isNaN(qty) || qty <= 0 || isNaN(price) || price <= 0) return
    setSaving(true)
    await fetch('/api/portfolio/holdings', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        stock_id:        stockId,
        quantity:        qty,
        avg_price:       price,
        broker:          editForm.broker || 'Manual',
        investment_date: editForm.investment_date || null,
      }),
    })
    setSaving(false)
    setEditingId(null)
    setEditForm(null)
    router.refresh()
  }

  function SortHeader({ label, field }: { label: string; field: SortKey }) {
    const active = sortKey === field
    return (
      <button
        onClick={() => toggleSort(field)}
        className={`flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${active ? 'text-gray-700' : 'text-gray-400 hover:text-gray-600'}`}
      >
        {label}
        {active && <span className="text-[8px]">{sortDir === 'desc' ? '▼' : '▲'}</span>}
      </button>
    )
  }

  // News drawer (uses StockSummaryPanel logic inline via fetch)
  const [newsData, setNewsData]         = useState<{ headlines: string | null; loading: boolean; ticker: string | null }>({ headlines: null, loading: false, ticker: null })

  async function openNews(ticker: string) {
    setNewsData({ headlines: null, loading: true, ticker })
    const res  = await fetch(`/api/stock-summary/${encodeURIComponent(ticker)}`).catch(() => null)
    const json = res ? await res.json().catch(() => null) : null
    setNewsData({ headlines: json?.stock?.latest_headlines ?? null, loading: false, ticker })
  }

  if (!sorted.length) {
    return (
      <div className="text-center py-16 text-sm text-gray-400">
        No holdings yet — sync from Zerodha, upload a CSV, or add manually above.
      </div>
    )
  }

  return (
    <div>
      {/* Fundamentals drawer */}
      <FundamentalsDrawer row={fundamentalsRow} onClose={() => setFundamentalsRow(null)} />

      {/* Chart drawer */}
      <StockChartPanel ticker={chartRow?.ticker ?? null} stockName={chartRow?.stock_name} onClose={() => setChartRow(null)} />

      {/* News drawer */}
      {newsData.ticker && (
        <>
          <div className="fixed inset-0 bg-black/20 z-40" onClick={() => setNewsData({ headlines: null, loading: false, ticker: null })} />
          <div className="fixed right-0 top-0 h-full w-full sm:w-[480px] bg-white shadow-2xl z-50 flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <div className="font-bold text-gray-900">{newsData.ticker} · Recent Filings & News</div>
              <button onClick={() => setNewsData({ headlines: null, loading: false, ticker: null })} className="text-gray-400 hover:text-gray-700 text-xl">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {newsData.loading && <div className="text-sm text-gray-400">Loading…</div>}
              {!newsData.loading && !newsData.headlines && <div className="text-sm text-gray-400">No news available.</div>}
              {!newsData.loading && newsData.headlines && <NewsText text={newsData.headlines} />}
            </div>
          </div>
        </>
      )}

      {/* Status bar */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-gray-400">{sorted.length} holdings</div>
        <div className="flex items-center gap-3">
          {marketOpen ? (
            <span className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />LIVE · 15s
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-gray-400 bg-gray-100 border border-gray-200 px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />MARKET CLOSED
            </span>
          )}
          {lastUpdated && (
            <span className="text-xs text-gray-400">
              {secondsSince < 5 ? 'Updated just now' : `${secondsSince}s ago`}
            </span>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-2.5 min-w-[180px]">
                <SortHeader label="Stock" field="ticker" />
              </th>
              <th className="text-right px-3 py-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider whitespace-nowrap">Qty · Avg ₹</th>
              <th className="text-right px-3 py-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Now ₹</th>
              <th className="text-right px-3 py-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Invested</th>
              <th className="text-right px-3 py-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Value</th>
              <th className="text-right px-3 py-2.5">
                <SortHeader label="P&L" field="pnl" />
              </th>
              <th className="text-right px-3 py-2.5">
                <SortHeader label="Return" field="returnPct" />
              </th>
              <th className="text-right px-3 py-2.5">
                <SortHeader label="Alloc" field="allocation" />
              </th>
              <th className="px-3 py-2.5 text-right text-[10px] font-bold text-gray-400 uppercase tracking-wider whitespace-nowrap">Stock PE</th>
              <th className="px-3 py-2.5 text-right text-[10px] font-bold text-gray-400 uppercase tracking-wider whitespace-nowrap">RSI · Signal</th>
              <th className="px-4 py-2.5 text-right" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.map(row => {
              const flash      = flashes[row.ticker]
              const band       = getValuationBand(row.pe_deviation)
              const nameColor  = peDeviationColor(row.pe_deviation)
              const isExpanded = expandedId === row.stock_id
              const isEditing  = editingId === row.stock_id

              // Row bg: flash takes priority, then PE band tint
              const rowBg = flash === 'up'
                ? 'bg-emerald-50'
                : flash === 'down'
                  ? 'bg-red-50'
                  : row.pe_deviation != null && row.pe_deviation <= -15
                    ? 'bg-green-50/40'
                    : row.pe_deviation != null && row.pe_deviation >= 20
                      ? 'bg-rose-50/40'
                      : 'bg-white'

              const pnlColor = row.pnl >= 0 ? 'text-emerald-600' : 'text-red-500'
              const retColor = row.returnPct >= 0 ? 'text-emerald-600' : 'text-red-500'

              const fiiSector = row.industry ? (INDUSTRY_TO_FII_SECTOR[row.industry] ?? null) : null
              const fiiFlow   = fiiSector && fiiFlows ? (fiiFlows[fiiSector] ?? null) : null

              return (
                <>
                  {/* Main row */}
                  <tr key={row.stock_id} className={`${rowBg} hover:bg-gray-50/80 transition-colors duration-300`}>
                    {/* Stock */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <a
                          href={`https://www.screener.in/company/${row.ticker}/consolidated/`}
                          target="_blank" rel="noopener noreferrer"
                          className={`font-semibold text-sm hover:underline ${nameColor}`}
                          title="View on Screener"
                        >
                          {row.ticker}
                        </a>
                        {band && (
                          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${band.style}`}>
                            {band.label}
                          </span>
                        )}
                        <TaxBadge date={row.investment_date} />
                      </div>
                      <div className="text-[10px] text-gray-500 truncate max-w-[170px] mt-0.5">{row.stock_name}</div>
                      {row.industry && (
                        <div className="text-[9px] text-gray-400 mt-0.5 flex items-center gap-1">
                          {row.industry}
                          {row.industry_pe != null && (
                            <span className="text-gray-300">· Ind PE {row.industry_pe.toFixed(1)}x</span>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Qty · Avg */}
                    <td className="px-3 py-3 text-right">
                      <div className="text-xs font-mono text-gray-700">{fmt(row.quantity)}</div>
                      <div className="text-[10px] font-mono text-gray-400 mt-0.5">@{fmt(row.avg_price, 2)}</div>
                    </td>

                    {/* Current Price */}
                    <td className="px-3 py-3 text-right">
                      <span className={`text-xs font-mono font-semibold ${row.current_price != null ? 'text-gray-900' : 'text-gray-400'}`}>
                        {row.current_price != null ? fmt(row.current_price, 2) : '—'}
                      </span>
                    </td>

                    {/* Invested */}
                    <td className="px-3 py-3 text-right">
                      <span className="text-xs font-mono text-gray-500">{fmtCurrency(row.invested)}</span>
                    </td>

                    {/* Value */}
                    <td className="px-3 py-3 text-right">
                      <span className="text-xs font-mono font-semibold text-gray-900">{fmtCurrency(row.currentValue)}</span>
                    </td>

                    {/* P&L */}
                    <td className="px-3 py-3 text-right">
                      <span className={`text-xs font-mono font-bold ${pnlColor}`}>
                        {row.pnl >= 0 ? '+' : ''}{fmtCurrency(row.pnl)}
                      </span>
                    </td>

                    {/* Return */}
                    <td className="px-3 py-3 text-right">
                      <span className={`text-xs font-mono font-bold ${retColor}`}>
                        {row.returnPct >= 0 ? '+' : ''}{row.returnPct.toFixed(2)}%
                      </span>
                    </td>

                    {/* Allocation */}
                    <td className="px-3 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <div className="w-10 h-1 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-400 rounded-full" style={{ width: `${Math.min(row.allocation, 100)}%` }} />
                        </div>
                        <span className="text-[10px] font-mono text-gray-500">{row.allocation.toFixed(1)}%</span>
                      </div>
                    </td>

                    {/* Stock PE */}
                    <td className="px-3 py-3 text-right">
                      {row.stock_pe != null ? (
                        <span className="text-xs font-mono text-gray-700">{row.stock_pe.toFixed(1)}x</span>
                      ) : (
                        <span className="text-[10px] text-gray-300">—</span>
                      )}
                    </td>

                    {/* RSI · Signal */}
                    <td className="px-3 py-3 text-right">
                      {row.rsi != null ? (
                        <div>
                          <span className={`text-xs font-mono font-semibold ${row.rsi_signal === 'Oversold' ? 'text-blue-600' : row.rsi_signal === 'Overbought' ? 'text-orange-500' : 'text-gray-600'}`}>
                            {row.rsi.toFixed(0)}
                          </span>
                          {row.rsi_signal && (
                            <div className="text-[9px] text-gray-400">{row.rsi_signal}</div>
                          )}
                        </div>
                      ) : (
                        <span className="text-[10px] text-gray-300">—</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : row.stock_id)}
                          className={`flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-lg border transition-colors ${isExpanded ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}
                        >
                          Details {isExpanded ? '▲' : '▾'}
                        </button>
                        <button
                          onClick={() => startEdit(row)}
                          title="Edit holding"
                          className="text-[10px] text-gray-400 hover:text-gray-700 px-2 py-1 rounded-lg border border-transparent hover:border-gray-200 transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(row.stock_id)}
                          disabled={deleting === row.stock_id}
                          title="Remove holding"
                          className="text-[10px] text-gray-300 hover:text-red-400 transition-colors disabled:opacity-50"
                        >
                          {deleting === row.stock_id ? '…' : '✕'}
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Expanded details card */}
                  {isExpanded && (
                    <tr className="bg-gray-50/80 border-b border-gray-200">
                      <td colSpan={11} className="px-4 py-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">

                          {/* Technicals */}
                          <div>
                            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Technicals</div>
                            <div className="space-y-1.5">
                              <SignalRow label="50 DMA">
                                <div className="flex items-center gap-1.5">
                                  <DMADot above={row.above_50_dma} />
                                  {row.dma_50 != null ? (
                                    <span className="text-xs font-mono text-gray-600">₹{fmt(row.dma_50, 0)}</span>
                                  ) : <span className="text-gray-300 text-xs">—</span>}
                                </div>
                              </SignalRow>
                              <SignalRow label="200 DMA">
                                <div className="flex items-center gap-1.5">
                                  <DMADot above={row.above_200_dma} />
                                  {row.dma_200 != null ? (
                                    <span className="text-xs font-mono text-gray-600">₹{fmt(row.dma_200, 0)}</span>
                                  ) : <span className="text-gray-300 text-xs">—</span>}
                                </div>
                              </SignalRow>
                              <SignalRow label="52W High">
                                {row.high_52w != null ? <span className="text-xs font-mono text-gray-600">₹{fmt(row.high_52w, 0)}</span> : <span className="text-gray-300 text-xs">—</span>}
                              </SignalRow>
                              <SignalRow label="52W Low">
                                {row.low_52w != null ? <span className="text-xs font-mono text-gray-600">₹{fmt(row.low_52w, 0)}</span> : <span className="text-gray-300 text-xs">—</span>}
                              </SignalRow>
                              <SignalRow label="Volume (yest)">
                                {row.vol_yesterday != null ? (
                                  <div className="text-right">
                                    <span className="text-xs font-mono text-gray-600">
                                      {row.vol_yesterday >= 1000000 ? `${(row.vol_yesterday / 1000000).toFixed(1)}M` : `${(row.vol_yesterday / 1000).toFixed(0)}K`}
                                    </span>
                                    {row.vol_ratio != null && (
                                      <div className={`text-[9px] font-mono font-semibold ${row.vol_ratio >= 3 ? 'text-red-500' : row.vol_ratio >= 2 ? 'text-orange-500' : row.vol_ratio >= 1.5 ? 'text-amber-500' : 'text-gray-400'}`}>
                                        {row.vol_ratio.toFixed(1)}× 20d avg
                                      </div>
                                    )}
                                  </div>
                                ) : <span className="text-gray-300 text-xs">—</span>}
                              </SignalRow>
                            </div>
                          </div>

                          {/* FII + Industry */}
                          <div>
                            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">FII & Valuation</div>
                            <div className="space-y-1.5">
                              <SignalRow label="Industry">
                                <span className="text-xs text-gray-600">{row.industry ?? '—'}</span>
                              </SignalRow>
                              <SignalRow label="FII Sector">
                                <span className="text-xs text-gray-600">{fiiSector ?? '—'}</span>
                              </SignalRow>
                              <SignalRow label="FII Flow (14d)">
                                {fiiFlow != null ? (
                                  <span className={`text-xs font-mono font-semibold ${fiiFlow >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                    {fiiFlow >= 0 ? '+' : ''}₹{Math.round(Math.abs(fiiFlow)).toLocaleString('en-IN')} Cr
                                  </span>
                                ) : <span className="text-gray-300 text-xs">—</span>}
                              </SignalRow>
                              <SignalRow label="Stock PE">
                                {row.stock_pe != null ? (
                                  <span className="text-xs font-mono text-gray-600">{row.stock_pe.toFixed(1)}x</span>
                                ) : <span className="text-gray-300 text-xs">—</span>}
                              </SignalRow>
                              <SignalRow label="Industry PE">
                                {row.industry_pe != null ? (
                                  <span className="text-xs font-mono text-gray-600">{row.industry_pe.toFixed(1)}x</span>
                                ) : <span className="text-gray-300 text-xs">—</span>}
                              </SignalRow>
                            </div>
                          </div>
                        </div>

                        {/* Action buttons row */}
                        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-gray-200">
                          {detailMap?.[row.stock_id] && (
                            <>
                              <ActionBtn onClick={() => setFundamentalsRow(detailMap![row.stock_id])}>
                                📊 Fundamentals
                              </ActionBtn>
                              <ActionBtn onClick={() => setChartRow(detailMap![row.stock_id])}>
                                📈 Chart
                              </ActionBtn>
                            </>
                          )}
                          <ActionBtn onClick={() => openNews(row.ticker)}>
                            📰 News & Filings
                          </ActionBtn>

                          {/* NSE link */}
                          <a
                            href={`https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(row.ticker)}`}
                            target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-600 hover:border-gray-400 transition-colors"
                          >
                            NSE ↗
                          </a>

                          {/* AI Brief */}
                          <div className="flex-1 flex justify-end">
                            {briefs[row.ticker] ? (
                              <button
                                onClick={() => setBriefs(p => { const n = { ...p }; delete n[row.ticker]; return n })}
                                className="text-[11px] text-gray-400 hover:text-gray-600 underline"
                              >
                                Clear brief
                              </button>
                            ) : (
                              <button
                                onClick={() => requestBrief(row.ticker)}
                                disabled={briefLoading[row.ticker]}
                                className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-blue-300 text-white transition-colors"
                              >
                                {briefLoading[row.ticker] ? (
                                  <>
                                    <span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
                                    Generating…
                                  </>
                                ) : '✦ Get AI Brief'}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* AI Brief result */}
                        {briefError[row.ticker] && (
                          <div className="mt-3 text-xs text-red-500">{briefError[row.ticker]}</div>
                        )}
                        {briefs[row.ticker] && (
                          <div className="mt-3 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
                            <div className="text-[10px] font-bold text-blue-400 uppercase tracking-widest mb-1.5">AI Brief · {row.ticker}</div>
                            <p className="text-xs text-gray-700 leading-relaxed">{briefs[row.ticker]}</p>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}

                  {/* Edit row */}
                  {isEditing && editForm && (
                    <tr className="bg-blue-50/60 border-b border-blue-100">
                      <td className="px-4 py-3" colSpan={2}>
                        <div className="font-semibold text-gray-700 text-sm">{row.ticker}</div>
                        <div className="text-[10px] text-gray-400">{row.stock_name}</div>
                      </td>
                      <td className="px-3 py-3" colSpan={6}>
                        <div className="flex gap-3 flex-wrap">
                          <div>
                            <div className="text-[10px] text-gray-400 mb-0.5">Quantity</div>
                            <input
                              type="number" step="0.01" min="0.01"
                              value={editForm.quantity}
                              onChange={e => setEditForm(f => f ? { ...f, quantity: e.target.value } : f)}
                              className="w-24 text-xs font-mono border border-gray-300 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
                            />
                          </div>
                          <div>
                            <div className="text-[10px] text-gray-400 mb-0.5">Avg Price ₹</div>
                            <input
                              type="number" step="0.01" min="0.01"
                              value={editForm.avg_price}
                              onChange={e => setEditForm(f => f ? { ...f, avg_price: e.target.value } : f)}
                              className="w-28 text-xs font-mono border border-gray-300 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
                            />
                          </div>
                          <div>
                            <div className="text-[10px] text-gray-400 mb-0.5">Broker</div>
                            <input
                              type="text"
                              value={editForm.broker}
                              onChange={e => setEditForm(f => f ? { ...f, broker: e.target.value } : f)}
                              className="w-28 text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
                            />
                          </div>
                          <div>
                            <div className="text-[10px] text-gray-400 mb-0.5">Investment Date</div>
                            <input
                              type="date"
                              value={editForm.investment_date}
                              onChange={e => setEditForm(f => f ? { ...f, investment_date: e.target.value } : f)}
                              className="w-36 text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3" colSpan={3}>
                        <div className="flex gap-2">
                          <button
                            onClick={() => saveEdit(row.stock_id)}
                            disabled={saving}
                            className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50 transition-colors"
                          >
                            {saving ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            onClick={() => { setEditingId(null); setEditForm(null) }}
                            className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg border border-gray-200 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SignalRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-[10px] text-gray-400 shrink-0 w-20 pt-0.5">{label}</span>
      <div className="text-right">{children}</div>
    </div>
  )
}

function ActionBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-600 hover:border-gray-400 hover:text-gray-900 transition-colors"
    >
      {children}
    </button>
  )
}

function NewsText({ text }: { text: string }) {
  const sections = text.split(/(?=━━)/).filter(s => s.trim())
  return (
    <div className="space-y-4">
      {sections.map((section, si) => {
        const lines  = section.split('\n').map(l => l.trim()).filter(Boolean)
        const header = lines[0]?.replace(/━━/g, '').trim()
        const items: { meta: string; subject: string; link: string }[] = []
        let current: Partial<{ meta: string; subject: string; link: string }> = {}
        for (const line of lines.slice(1)) {
          if (/^\[\d+\]/.test(line)) {
            if (current.subject) items.push(current as any)
            current = { meta: line.replace(/^\[\d+\]\s*/, '') }
          } else if (line.startsWith('📅')) {
            current.meta = (current.meta ? current.meta + ' · ' : '') + line.replace('📅', '').trim()
          } else if (line.startsWith('📌')) {
            current.subject = line.replace('📌', '').trim()
          } else if (line.startsWith('🔗')) {
            current.link = line.replace('🔗', '').trim()
          }
        }
        if (current.subject) items.push(current as any)
        return (
          <div key={si}>
            <div className="text-xs font-semibold text-gray-500 mb-2">{header}</div>
            <div className="space-y-2">
              {items.map((item, ii) => (
                <div key={ii} className="bg-white rounded-lg px-3 py-2.5 text-xs border border-gray-100">
                  <div className="text-gray-400 mb-0.5">{item.meta}</div>
                  {item.link ? (
                    <a href={item.link} target="_blank" rel="noopener noreferrer" className="text-gray-800 hover:text-blue-600 hover:underline leading-snug">
                      {item.subject}
                    </a>
                  ) : (
                    <div className="text-gray-800 leading-snug">{item.subject}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
