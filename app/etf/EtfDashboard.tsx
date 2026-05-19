'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { ArrowUpRight, ArrowDownRight, Minus, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react'

type EtfMeta = {
  ticker:           string
  name:             string
  fund_house:       string
  category:         string
  underlying_index: string | null
  expense_ratio:    number | null
  aum_cr:           number | null
  inav_ticker:      string | null
}

type EtfQuote = {
  price:      number
  change:     number
  changePct:  number
  nav:        number | null
  premiumPct: number | null
  high52w:    number | null
  low52w:     number | null
  volume:     number
  dayHigh:    number
  dayLow:     number
}

const CATEGORIES = [
  { id: 'all',           label: 'All ETFs' },
  { id: 'equity_broad',  label: 'Equity Index' },
  { id: 'equity_midcap',    label: 'Midcap' },
  { id: 'equity_smallcap', label: 'Smallcap' },
  { id: 'equity_sector',   label: 'Sectoral' },
  { id: 'gold',          label: 'Gold' },
  { id: 'silver',        label: 'Silver' },
  { id: 'international', label: 'International' },
  { id: 'debt',          label: 'Debt' },
  { id: 'liquid',        label: 'Liquid' },
]

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  equity_broad:  { bg: '#dbeafe', text: '#1d4ed8' },
  equity_midcap:    { bg: '#e0e7ff', text: '#4338ca' },
  equity_smallcap:  { bg: '#ede9fe', text: '#6d28d9' },
  equity_sector:    { bg: '#fce7f3', text: '#be185d' },
  gold:          { bg: '#fef3c7', text: '#92400e' },
  silver:        { bg: '#f1f5f9', text: '#475569' },
  international: { bg: '#dcfce7', text: '#166534' },
  debt:          { bg: '#fff7ed', text: '#9a3412' },
  liquid:        { bg: '#f0fdf4', text: '#15803d' },
}

const SORT_OPTIONS = [
  { id: 'aum_cr',      label: 'AUM' },
  { id: 'changePct',   label: 'Day Change' },
  { id: 'premiumPct',  label: 'Premium/Discount' },
  { id: 'expense_ratio', label: 'Expense Ratio' },
  { id: 'volume',      label: 'Volume' },
]

function fmtPrice(v: number) {
  return v >= 1000 ? `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 1 })}` : `₹${v.toFixed(2)}`
}

function fmtAum(v: number | null) {
  if (!v) return '—'
  if (v >= 10000) return `₹${(v / 1000).toFixed(1)}K Cr`
  return `₹${Math.round(v).toLocaleString('en-IN')} Cr`
}

function fmtVol(v: number) {
  if (v >= 1_00_00_000) return `${(v / 1_00_00_000).toFixed(1)}Cr`
  if (v >= 1_00_000)    return `${(v / 1_00_000).toFixed(1)}L`
  if (v >= 1_000)       return `${(v / 1_000).toFixed(1)}K`
  return String(v)
}

function RangeBar({ price, low, high }: { price: number; low: number; high: number }) {
  if (!low || !high || high <= low) return <span style={{ color: 'var(--artha-text-muted)', fontSize: 11 }}>—</span>
  const pct = Math.min(100, Math.max(0, ((price - low) / (high - low)) * 100))
  const color = pct >= 70 ? '#10b981' : pct >= 40 ? '#6366f1' : '#ef4444'
  return (
    <div className="flex items-center gap-1.5" style={{ minWidth: 80 }}>
      <span style={{ fontSize: 9, color: 'var(--artha-text-muted)', whiteSpace: 'nowrap' }}>
        {fmtPrice(low)}
      </span>
      <div className="flex-1 rounded-full overflow-hidden" style={{ height: 4, background: '#e5e7eb', minWidth: 40 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '9999px', transition: 'width 0.4s' }} />
      </div>
      <span style={{ fontSize: 9, color: 'var(--artha-text-muted)', whiteSpace: 'nowrap' }}>
        {fmtPrice(high)}
      </span>
    </div>
  )
}

function PremiumBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span style={{ color: 'var(--artha-text-muted)', fontSize: 11 }}>N/A</span>
  const abs = Math.abs(pct)
  const isDiscount = pct < 0
  const color = isDiscount ? '#10b981' : pct > 0.5 ? '#ef4444' : '#f97316'
  const bg    = isDiscount ? '#d1fae5' : pct > 0.5 ? '#fee2e2' : '#ffedd5'
  return (
    <span
      className="inline-flex items-center gap-0.5 font-mono font-semibold rounded px-1.5 py-0.5"
      style={{ fontSize: 11, color, background: bg }}
    >
      {isDiscount ? <ArrowDownRight size={10} /> : <ArrowUpRight size={10} />}
      {isDiscount ? '-' : '+'}{abs.toFixed(3)}%
    </span>
  )
}

function FlashCell({ value, children }: { value: number; children: React.ReactNode }) {
  const [flash, setFlash] = useState<'up' | 'down' | null>(null)
  const prev = useRef(value)
  useEffect(() => {
    if (prev.current === value) return
    setFlash(value > prev.current ? 'up' : 'down')
    prev.current = value
    const t = setTimeout(() => setFlash(null), 700)
    return () => clearTimeout(t)
  }, [value])
  return (
    <span
      style={{
        display: 'inline-block',
        transition: 'background 0.3s',
        background: flash === 'up' ? 'rgba(16,185,129,0.15)' : flash === 'down' ? 'rgba(239,68,68,0.15)' : 'transparent',
        borderRadius: 4, padding: '1px 4px',
      }}
    >
      {children}
    </span>
  )
}

export default function EtfDashboard({ etfs }: { etfs: EtfMeta[] }) {
  const [prices, setPrices]   = useState<Record<string, EtfQuote>>({})
  const [loading, setLoading] = useState(true)
  const [lastFetch, setLastFetch] = useState<Date | null>(null)
  const [activeTab, setActiveTab] = useState('all')
  const [sortBy, setSortBy]   = useState<string>('aum_cr')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const fetchPrices = useCallback(async () => {
    try {
      const res  = await fetch('/api/etf/live-prices')
      const json = await res.json()
      if (json.prices) { setPrices(json.prices); setLastFetch(new Date()) }
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchPrices()
    const id = setInterval(fetchPrices, 15000)
    return () => clearInterval(id)
  }, [fetchPrices])

  const filtered = etfs.filter(e => activeTab === 'all' || e.category === activeTab)

  const sorted = [...filtered].sort((a, b) => {
    let av: number, bv: number
    if (sortBy === 'aum_cr')        { av = a.aum_cr ?? 0;             bv = b.aum_cr ?? 0 }
    else if (sortBy === 'changePct') { av = prices[a.ticker]?.changePct ?? -999; bv = prices[b.ticker]?.changePct ?? -999 }
    else if (sortBy === 'premiumPct'){ av = prices[a.ticker]?.premiumPct ?? 0;   bv = prices[b.ticker]?.premiumPct ?? 0 }
    else if (sortBy === 'expense_ratio') { av = a.expense_ratio ?? 99; bv = b.expense_ratio ?? 99 }
    else if (sortBy === 'volume')    { av = prices[a.ticker]?.volume ?? 0;       bv = prices[b.ticker]?.volume ?? 0 }
    else { av = 0; bv = 0 }
    return sortDir === 'desc' ? bv - av : av - bv
  })

  function toggleSort(col: string) {
    if (sortBy === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortBy(col); setSortDir('desc') }
  }

  // Summary cards
  const withPrices = etfs.filter(e => prices[e.ticker])
  const bestPerformer  = withPrices.sort((a, b) => (prices[b.ticker]?.changePct ?? -999) - (prices[a.ticker]?.changePct ?? -999))[0]
  const worstPerformer = withPrices.sort((a, b) => (prices[a.ticker]?.changePct ?? 999) - (prices[b.ticker]?.changePct ?? 999))[0]
  const mostDiscounted = withPrices.filter(e => (prices[e.ticker]?.premiumPct ?? 0) < 0)
    .sort((a, b) => (prices[a.ticker]?.premiumPct ?? 0) - (prices[b.ticker]?.premiumPct ?? 0))[0]
  const lowestExpense  = etfs.filter(e => e.expense_ratio).sort((a, b) => (a.expense_ratio ?? 99) - (b.expense_ratio ?? 99))[0]

  const priceCount = Object.keys(prices).length

  return (
    <div className="space-y-4">

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {bestPerformer && prices[bestPerformer.ticker] && (
          <div className="artha-card p-4">
            <p className="text-xs font-medium mb-1" style={{ color: 'var(--artha-text-muted)' }}>Best Today</p>
            <p className="text-sm font-bold truncate" style={{ color: 'var(--artha-text)' }}>{bestPerformer.ticker}</p>
            <p className="text-lg font-bold font-display" style={{ color: '#10b981', letterSpacing: '-0.02em' }}>
              +{prices[bestPerformer.ticker].changePct.toFixed(2)}%
            </p>
          </div>
        )}
        {worstPerformer && prices[worstPerformer.ticker] && (
          <div className="artha-card p-4">
            <p className="text-xs font-medium mb-1" style={{ color: 'var(--artha-text-muted)' }}>Worst Today</p>
            <p className="text-sm font-bold truncate" style={{ color: 'var(--artha-text)' }}>{worstPerformer.ticker}</p>
            <p className="text-lg font-bold font-display" style={{ color: '#ef4444', letterSpacing: '-0.02em' }}>
              {prices[worstPerformer.ticker].changePct.toFixed(2)}%
            </p>
          </div>
        )}
        {mostDiscounted && prices[mostDiscounted.ticker] && (
          <div className="artha-card p-4">
            <p className="text-xs font-medium mb-1" style={{ color: 'var(--artha-text-muted)' }}>Most Discounted</p>
            <p className="text-sm font-bold truncate" style={{ color: 'var(--artha-text)' }}>{mostDiscounted.ticker}</p>
            <p className="text-lg font-bold font-display" style={{ color: '#10b981', letterSpacing: '-0.02em' }}>
              {prices[mostDiscounted.ticker].premiumPct?.toFixed(3)}%
            </p>
          </div>
        )}
        {lowestExpense && (
          <div className="artha-card p-4">
            <p className="text-xs font-medium mb-1" style={{ color: 'var(--artha-text-muted)' }}>Lowest TER</p>
            <p className="text-sm font-bold truncate" style={{ color: 'var(--artha-text)' }}>{lowestExpense.ticker}</p>
            <p className="text-lg font-bold font-display" style={{ color: '#6366f1', letterSpacing: '-0.02em' }}>
              {lowestExpense.expense_ratio?.toFixed(2)}%
            </p>
          </div>
        )}
      </div>

      {/* Tabs + sort + refresh */}
      <div className="artha-card overflow-hidden">

        {/* Tab bar */}
        <div className="flex items-center gap-0 border-b border-gray-100 overflow-x-auto">
          <div className="flex gap-0 flex-1">
            {CATEGORIES.map(cat => (
              <button
                key={cat.id}
                onClick={() => setActiveTab(cat.id)}
                className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
                  activeTab === cat.id
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {cat.label}
                {cat.id !== 'all' && (
                  <span className="ml-1 text-gray-400">
                    {etfs.filter(e => e.category === cat.id).length}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 px-3 shrink-0">
            {lastFetch && (
              <span style={{ fontSize: 10, color: 'var(--artha-text-muted)' }}>
                {lastFetch.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
            {loading && <RefreshCw size={11} className="animate-spin" style={{ color: 'var(--artha-text-muted)' }} />}
          </div>
        </div>

        {/* Sort bar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-50" style={{ background: '#fafafa' }}>
          <span style={{ fontSize: 11, color: 'var(--artha-text-muted)' }}>Sort by:</span>
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt.id}
              onClick={() => toggleSort(opt.id)}
              className="flex items-center gap-0.5 rounded px-2 py-0.5 text-xs font-medium transition-colors"
              style={{
                background: sortBy === opt.id ? '#ede9fe' : 'transparent',
                color: sortBy === opt.id ? '#7c3aed' : 'var(--artha-text-muted)',
              }}
            >
              {opt.label}
              {sortBy === opt.id && (
                sortDir === 'desc' ? <TrendingDown size={10} /> : <TrendingUp size={10} />
              )}
            </button>
          ))}
          <span className="ml-auto text-xs" style={{ color: 'var(--artha-text-muted)' }}>
            {sorted.length} ETFs · {priceCount} with live prices
          </span>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '1px solid #f3f4f6' }}>
                <th className="text-left px-4 py-2.5 text-xs font-semibold" style={{ color: 'var(--artha-text-muted)', minWidth: 220 }}>ETF</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold" style={{ color: 'var(--artha-text-muted)', minWidth: 110 }}>Price / Change</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold" style={{ color: 'var(--artha-text-muted)', minWidth: 90 }}>NAV</th>
                <th className="text-center px-3 py-2.5 text-xs font-semibold" style={{ color: 'var(--artha-text-muted)', minWidth: 100 }}>Premium/Disc</th>
                <th className="text-center px-3 py-2.5 text-xs font-semibold" style={{ color: 'var(--artha-text-muted)', minWidth: 160 }}>52-Week Range</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold cursor-pointer hover:text-gray-700" style={{ color: 'var(--artha-text-muted)', minWidth: 80 }} onClick={() => toggleSort('aum_cr')}>AUM</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold cursor-pointer hover:text-gray-700" style={{ color: 'var(--artha-text-muted)', minWidth: 60 }} onClick={() => toggleSort('expense_ratio')}>TER</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold cursor-pointer hover:text-gray-700" style={{ color: 'var(--artha-text-muted)', minWidth: 80 }} onClick={() => toggleSort('volume')}>Volume</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((etf, i) => {
                const q = prices[etf.ticker]
                const catColor = CATEGORY_COLORS[etf.category] ?? { bg: '#f3f4f6', text: '#6b7280' }
                const isPositive = (q?.changePct ?? 0) >= 0

                return (
                  <tr
                    key={etf.ticker}
                    className="border-b border-gray-50 hover:bg-gray-50 transition-colors"
                    style={{ borderBottom: i === sorted.length - 1 ? 'none' : undefined }}
                  >
                    {/* ETF name */}
                    <td className="px-4 py-3">
                      <div className="flex items-start gap-2.5">
                        <div
                          className="shrink-0 rounded font-mono font-bold text-center"
                          style={{
                            width: 44, height: 22, lineHeight: '22px',
                            fontSize: 9, letterSpacing: '0.03em',
                            background: catColor.bg, color: catColor.text,
                          }}
                        >
                          {etf.ticker.slice(0, 6)}
                        </div>
                        <div>
                          <p className="text-xs font-semibold leading-tight" style={{ color: 'var(--artha-text)' }}>
                            {etf.ticker}
                          </p>
                          <p className="text-xs leading-tight mt-0.5" style={{ color: 'var(--artha-text-muted)', maxWidth: 180 }}>
                            {etf.name}
                          </p>
                          {etf.underlying_index && (
                            <p style={{ fontSize: 10, color: 'var(--artha-text-muted)', marginTop: 1 }}>
                              {etf.underlying_index} · {etf.fund_house}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Price */}
                    <td className="px-3 py-3 text-right">
                      {q ? (
                        <>
                          <FlashCell value={q.price}>
                            <p className="text-sm font-bold font-mono" style={{ color: 'var(--artha-text)' }}>
                              {fmtPrice(q.price)}
                            </p>
                          </FlashCell>
                          <p className="text-xs font-medium mt-0.5" style={{ color: isPositive ? '#10b981' : '#ef4444' }}>
                            {isPositive ? '+' : ''}{q.changePct.toFixed(2)}%
                          </p>
                        </>
                      ) : (
                        <span style={{ color: 'var(--artha-text-muted)', fontSize: 11 }}>—</span>
                      )}
                    </td>

                    {/* NAV */}
                    <td className="px-3 py-3 text-right">
                      {q?.nav ? (
                        <p className="text-xs font-mono" style={{ color: 'var(--artha-text-muted)' }}>
                          {fmtPrice(q.nav)}
                        </p>
                      ) : (
                        <span style={{ color: 'var(--artha-text-muted)', fontSize: 11 }}>—</span>
                      )}
                    </td>

                    {/* Premium/Discount */}
                    <td className="px-3 py-3 text-center">
                      <PremiumBadge pct={q?.premiumPct ?? null} />
                    </td>

                    {/* 52W Range */}
                    <td className="px-3 py-3">
                      {q?.high52w && q?.low52w ? (
                        <RangeBar price={q.price} low={q.low52w} high={q.high52w} />
                      ) : (
                        <span style={{ color: 'var(--artha-text-muted)', fontSize: 11 }}>—</span>
                      )}
                    </td>

                    {/* AUM */}
                    <td className="px-3 py-3 text-right">
                      <span className="text-xs font-medium" style={{ color: 'var(--artha-text)' }}>
                        {fmtAum(etf.aum_cr)}
                      </span>
                    </td>

                    {/* TER */}
                    <td className="px-3 py-3 text-right">
                      <span
                        className="text-xs font-mono font-medium"
                        style={{ color: (etf.expense_ratio ?? 1) <= 0.10 ? '#10b981' : (etf.expense_ratio ?? 1) >= 0.5 ? '#ef4444' : 'var(--artha-text)' }}
                      >
                        {etf.expense_ratio != null ? `${etf.expense_ratio.toFixed(2)}%` : '—'}
                      </span>
                    </td>

                    {/* Volume */}
                    <td className="px-3 py-3 text-right">
                      <span className="text-xs font-mono" style={{ color: 'var(--artha-text-muted)' }}>
                        {q ? fmtVol(q.volume) : '—'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {sorted.length === 0 && (
            <div className="py-12 text-center text-sm" style={{ color: 'var(--artha-text-muted)' }}>
              No ETFs in this category yet.
            </div>
          )}
        </div>

        {/* Footer legend */}
        <div className="px-4 py-3 flex flex-wrap gap-4 border-t border-gray-100" style={{ background: '#fafafa' }}>
          <span style={{ fontSize: 10, color: 'var(--artha-text-muted)' }}>
            <span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: '#d1fae5' }} />
            Green premium = ETF trading below NAV (discount — opportunity)
          </span>
          <span style={{ fontSize: 10, color: 'var(--artha-text-muted)' }}>
            <span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: '#fee2e2' }} />
            Red premium = ETF trading above NAV (premium — expensive)
          </span>
          <span style={{ fontSize: 10, color: 'var(--artha-text-muted)' }}>
            TER = Total Expense Ratio · NAV/INAV via Kite real-time · AUM is approximate
          </span>
        </div>
      </div>
    </div>
  )
}
