'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { type WatchlistRow } from './WatchlistTable'
import StockSummaryPanel from './StockSummaryPanel'
import FundamentalsDrawer from './FundamentalsDrawer'
import StockChartPanel from './StockChartPanel'

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
  // analysis
  pe_deviation:     number | null
  rsi:              number | null
  rsi_signal:       string | null
  composite_score:  number | null
  classification:   string | null
  suggested_action: string | null
  above_200_dma:    boolean | null
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
    <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${ltcg ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}
      title={`${days}d held · ${ltcg ? 'LTCG' : 'STCG'}`}>
      {ltcg ? 'LTCG' : 'STCG'} {days >= 365 ? `${Math.floor(days/365)}y` : `${days}d`}
    </span>
  )
}

function ScoreBadge({ score, cls }: { score: number | null; cls: string | null }) {
  if (score == null) return <span className="text-[10px] text-gray-300">—</span>
  const color =
    cls === 'Strong Buy'  ? 'bg-emerald-100 text-emerald-700' :
    cls === 'Buy'         ? 'bg-green-100 text-green-700'     :
    cls === 'Hold'        ? 'bg-yellow-100 text-yellow-700'   :
    cls === 'Sell'        ? 'bg-orange-100 text-orange-700'   :
    cls === 'Strong Sell' ? 'bg-red-100 text-red-700'         : 'bg-gray-100 text-gray-600'
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${color}`}>
      {score.toFixed(0)}
    </span>
  )
}

function RSIChip({ rsi, signal }: { rsi: number | null; signal: string | null }) {
  if (rsi == null) return <span className="text-[10px] text-gray-300">—</span>
  const color =
    signal === 'Oversold'   ? 'text-blue-600'   :
    signal === 'Overbought' ? 'text-orange-500' : 'text-gray-500'
  return (
    <span className={`text-[10px] font-mono font-semibold ${color}`}>
      {rsi.toFixed(0)}{signal === 'Oversold' ? ' ↓' : signal === 'Overbought' ? ' ↑' : ''}
    </span>
  )
}

function PEChip({ dev }: { dev: number | null }) {
  if (dev == null) return <span className="text-[10px] text-gray-300">—</span>
  const color = dev < -10 ? 'text-emerald-600' : dev > 10 ? 'text-red-500' : 'text-gray-500'
  return (
    <span className={`text-[10px] font-mono font-semibold ${color}`}>
      {dev >= 0 ? '+' : ''}{dev.toFixed(0)}%
    </span>
  )
}

export default function HoldingsTable({
  initialRows, totalInvested, detailMap,
}: {
  initialRows:   HoldingRow[]
  totalInvested: number
  detailMap?:    Record<string, WatchlistRow>
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

  // Edit state
  const [editingId, setEditingId]           = useState<string | null>(null)
  const [editForm, setEditForm]             = useState<{ quantity: string; avg_price: string; broker: string; investment_date: string } | null>(null)
  const [saving, setSaving]                 = useState(false)

  // Panel state
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null)
  const [panelMode, setPanelMode]           = useState<'summary' | 'filings'>('summary')
  const [fundamentalsRow, setFundamentalsRow] = useState<WatchlistRow | null>(null)
  const [chartRow, setChartRow]             = useState<WatchlistRow | null>(null)

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

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  // Compute per-row derived values
  const computedRows = rows.map(row => {
    const invested     = row.quantity * row.avg_price
    const currentPrice = row.current_price ?? row.avg_price
    const currentValue = row.quantity * currentPrice
    const pnl          = currentValue - invested
    const returnPct    = invested > 0 ? (pnl / invested) * 100 : 0
    const allocation   = totalInvested > 0 ? (invested / totalInvested) * 100 : 0
    return { ...row, invested, currentValue, pnl, returnPct, allocation }
  })

  // Sort
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

  if (!sorted.length) {
    return (
      <div className="text-center py-16 text-sm text-gray-400">
        No holdings yet — sync from Zerodha, upload a CSV, or add manually above.
      </div>
    )
  }

  return (
    <div>
      {/* Analysis panels */}
      <StockSummaryPanel ticker={selectedTicker} mode={panelMode} onClose={() => setSelectedTicker(null)} />
      <FundamentalsDrawer row={fundamentalsRow} onClose={() => setFundamentalsRow(null)} />
      <StockChartPanel ticker={chartRow?.ticker ?? null} stockName={chartRow?.stock_name} onClose={() => setChartRow(null)} />

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
              {secondsSince < 5 ? 'Updated just now' : `Updated ${secondsSince}s ago`}
            </span>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-2.5">
                <SortHeader label="Stock" field="ticker" />
              </th>
              <th className="text-right px-3 py-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Qty</th>
              <th className="text-right px-3 py-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Avg ₹</th>
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
              <th className="text-center px-3 py-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Score</th>
              <th className="text-center px-3 py-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">RSI</th>
              <th className="text-center px-3 py-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">PE Dev</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.map(row => {
              const flash = flashes[row.ticker]
              const rowBg = flash === 'up' ? 'bg-emerald-50' : flash === 'down' ? 'bg-red-50' : 'bg-white'
              const pnlColor  = row.pnl >= 0  ? 'text-emerald-600' : 'text-red-500'
              const retColor  = row.returnPct >= 0 ? 'text-emerald-600' : 'text-red-500'

              return (
                <>
                  <tr key={row.stock_id} className={`${rowBg} hover:bg-gray-50 transition-colors duration-300`}>
                    {/* Stock */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-gray-900 text-sm">{row.ticker}</span>
                        <TaxBadge date={row.investment_date} />
                      </div>
                      <div className="text-[10px] text-gray-400 truncate max-w-[160px]">{row.stock_name}</div>
                      {row.broker && (
                        <div className="text-[9px] text-gray-300 mt-0.5">{row.broker}</div>
                      )}
                    </td>

                    {/* Qty */}
                    <td className="px-3 py-3 text-right">
                      <span className="text-xs font-mono text-gray-700">{fmt(row.quantity)}</span>
                    </td>

                    {/* Avg Price */}
                    <td className="px-3 py-3 text-right">
                      <span className="text-xs font-mono text-gray-700">{fmt(row.avg_price, 2)}</span>
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

                    {/* Current Value */}
                    <td className="px-3 py-3 text-right">
                      <span className="text-xs font-mono font-semibold text-gray-900">{fmtCurrency(row.currentValue)}</span>
                    </td>

                    {/* P&L */}
                    <td className="px-3 py-3 text-right">
                      <span className={`text-xs font-mono font-bold ${pnlColor}`}>
                        {row.pnl >= 0 ? '+' : ''}{fmtCurrency(row.pnl)}
                      </span>
                    </td>

                    {/* Return % */}
                    <td className="px-3 py-3 text-right">
                      <span className={`text-xs font-mono font-bold ${retColor}`}>
                        {row.returnPct >= 0 ? '+' : ''}{row.returnPct.toFixed(2)}%
                      </span>
                    </td>

                    {/* Allocation */}
                    <td className="px-3 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <div className="w-12 h-1 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-400 rounded-full" style={{ width: `${Math.min(row.allocation, 100)}%` }} />
                        </div>
                        <span className="text-[10px] font-mono text-gray-500">{row.allocation.toFixed(1)}%</span>
                      </div>
                    </td>

                    {/* Score */}
                    <td className="px-3 py-3 text-center">
                      <ScoreBadge score={row.composite_score} cls={row.classification} />
                    </td>

                    {/* RSI */}
                    <td className="px-3 py-3 text-center">
                      <RSIChip rsi={row.rsi} signal={row.rsi_signal} />
                    </td>

                    {/* PE Dev */}
                    <td className="px-3 py-3 text-center">
                      <PEChip dev={row.pe_deviation} />
                    </td>

                    {/* Actions */}
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => { setSelectedTicker(row.ticker); setPanelMode('summary') }} title="AI Summary" className="text-sm hover:scale-110 transition-transform leading-none">🤖</button>
                        <button onClick={() => { setSelectedTicker(row.ticker); setPanelMode('filings') }} title="News & filings" className="text-sm hover:scale-110 transition-transform leading-none">📰</button>
                        {detailMap?.[row.stock_id] && (
                          <>
                            <button onClick={() => setFundamentalsRow(detailMap![row.stock_id])} title="Fundamentals" className="text-sm hover:scale-110 transition-transform leading-none">📊</button>
                            <button onClick={() => setChartRow(detailMap![row.stock_id])} title="Chart" className="text-sm hover:scale-110 transition-transform leading-none">📈</button>
                          </>
                        )}
                        <button onClick={() => startEdit(row)} title="Edit holding" className="text-sm hover:scale-110 transition-transform leading-none">✏️</button>
                        <button onClick={() => handleDelete(row.stock_id)} disabled={deleting === row.stock_id} title="Remove holding" className="text-[10px] text-gray-300 hover:text-red-400 transition-colors disabled:opacity-50 ml-1">
                          {deleting === row.stock_id ? '…' : '✕'}
                        </button>
                      </div>
                    </td>
                  </tr>

                  {editingId === row.stock_id && editForm && (
                    <tr className="bg-blue-50 border-b border-blue-100">
                      <td className="px-4 py-3" colSpan={3}>
                        <div className="font-semibold text-gray-700 text-sm">{row.ticker}</div>
                        <div className="text-[10px] text-gray-400">{row.stock_name}</div>
                      </td>
                      <td className="px-3 py-3" colSpan={3}>
                        <div className="flex gap-2 flex-wrap">
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
                            <div className="text-[10px] text-gray-400 mb-0.5">Investment Date <span className="text-gray-300">(optional)</span></div>
                            <input
                              type="date"
                              value={editForm.investment_date}
                              onChange={e => setEditForm(f => f ? { ...f, investment_date: e.target.value } : f)}
                              className="w-36 text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3" colSpan={7}>
                        <div className="flex gap-2">
                          <button
                            onClick={() => saveEdit(row.stock_id)}
                            disabled={saving}
                            className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded-lg font-semibold disabled:opacity-50 transition-colors"
                          >
                            {saving ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            onClick={() => { setEditingId(null); setEditForm(null) }}
                            className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1 rounded-lg border border-gray-200 transition-colors"
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
