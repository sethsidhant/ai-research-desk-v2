'use client'

import { useState, useEffect, type ReactNode } from 'react'
import { type WatchlistRow } from './WatchlistTable'
type Tab = 'overview' | 'growth' | 'comparison'

function fmt(n: number | null, suffix = '', decimals = 1) {
  if (n == null) return '—'
  return `${n.toFixed(decimals)}${suffix}`
}

function fmtCr(n: number | null) {
  if (n == null) return '—'
  if (n >= 10000) return `₹${(n / 10000).toFixed(1)}L Cr`
  if (n >= 100)   return `₹${(n / 100).toFixed(0)}K Cr`
  return `₹${n.toFixed(0)} Cr`
}

function GrowthBar({ value }: { value: number | null }) {
  if (value == null) return <span className="text-gray-400 text-xs">—</span>
  const color = value >= 15 ? 'bg-emerald-500' : value >= 0 ? 'bg-amber-400' : 'bg-red-500'
  const width = Math.min(Math.abs(value), 100)
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${width}%` }} />
      </div>
      <span className={`text-xs font-mono w-14 text-right ${value >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
        {value > 0 ? '+' : ''}{value.toFixed(1)}%
      </span>
    </div>
  )
}

function MetricRow({ label, value, highlight, sub }: { label: string; value: string; highlight?: 'green' | 'red' | 'amber'; sub?: string }) {
  const color = highlight === 'green' ? 'text-emerald-600' : highlight === 'red' ? 'text-red-600' : highlight === 'amber' ? 'text-amber-600' : 'text-gray-900'
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-gray-100 last:border-0">
      <div>
        <span className="text-sm text-gray-500">{label}</span>
        {sub && <div className="text-xs text-gray-400">{sub}</div>}
      </div>
      <span className={`text-sm font-semibold font-mono ${color}`}>{value}</span>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3 mt-5 first:mt-0">{children}</div>
}

function returnHighlight(stock: number | null, bench: number | null): 'green' | 'red' | undefined {
  if (stock == null || bench == null) return undefined
  return stock >= bench ? 'green' : 'red'
}

function BenchCompare({ label, stockVal, benchVal, benchLabel }: { label: string; stockVal: number | null; benchVal: number | null; benchLabel: string }) {
  const diff = stockVal != null && benchVal != null ? stockVal - benchVal : null
  return (
    <div className="mb-5">
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">{label}</div>
      <MetricRow label={label.includes('Stock') ? label : 'Stock'} value={stockVal != null ? `${stockVal > 0 ? '+' : ''}${stockVal.toFixed(1)}%` : '—'} highlight={returnHighlight(stockVal, benchVal)} />
      <MetricRow label={benchLabel} value={benchVal != null ? `${benchVal > 0 ? '+' : ''}${benchVal.toFixed(1)}%` : '—'} />
      {diff != null && (
        <div className={`text-xs mt-1.5 font-medium ${diff >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
          {diff >= 0 ? `↑ Outperforming by ${diff.toFixed(1)}%` : `↓ Underperforming by ${Math.abs(diff).toFixed(1)}%`}
        </div>
      )}
    </div>
  )
}

export default function FundamentalsDrawer({ row, onClose }: { row: WatchlistRow | null; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('overview')

  useEffect(() => { if (row) setTab('overview') }, [row?.stock_id])

  if (!row) return null

  const r = row as any
  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview',   label: 'Fundamentals' },
    { id: 'growth',     label: 'Growth' },
    { id: 'comparison', label: 'vs Nifty' },
  ]

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full sm:w-96 bg-white shadow-2xl z-50 flex flex-col">

        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <div className="font-bold text-gray-900 text-base">{row.stock_name}</div>
            <div className="text-xs text-gray-400 font-mono mt-0.5">{row.ticker} · {row.industry ?? 'N/A'}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none mt-0.5">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
                tab === t.id ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">

          {tab === 'overview' && (
            <div>
              <SectionTitle>Valuation</SectionTitle>
              <MetricRow label="Stock PE" value={fmt(row.stock_pe, 'x')} />
              <MetricRow label="Industry PE" value={fmt(row.industry_pe, 'x')} />
              <MetricRow label="PE vs Industry" value={row.pe_deviation != null ? `${row.pe_deviation > 0 ? '+' : ''}${row.pe_deviation.toFixed(1)}%` : '—'} highlight={row.pe_deviation != null ? (row.pe_deviation <= -10 ? 'green' : row.pe_deviation >= 20 ? 'red' : undefined) : undefined} />
              <MetricRow label="P/B Ratio" value={fmt(r.pb, 'x')} />
              <MetricRow label="EPS" value={r.eps != null ? `₹${r.eps.toFixed(2)}` : '—'} />
              <MetricRow label="Dividend Yield" value={fmt(r.dividend_yield, '%')} />
              <MetricRow label="Market Cap" value={fmtCr(r.market_cap)} />

              <SectionTitle>Quality</SectionTitle>
              <MetricRow label="ROCE" value={fmt(r.roce, '%')} highlight={r.roce != null ? (r.roce >= 15 ? 'green' : r.roce < 10 ? 'red' : 'amber') : undefined} />
              <MetricRow label="ROE"  value={fmt(r.roe, '%')}  highlight={r.roe  != null ? (r.roe  >= 15 ? 'green' : r.roe  < 10 ? 'red' : 'amber') : undefined} />

              <SectionTitle>Ownership</SectionTitle>
              <MetricRow label="Promoter Holding" value={fmt(r.promoter_holding, '%')} />
              <MetricRow label="FII Holding"       value={fmt(r.fii_holding, '%')} />
              <MetricRow label="DII Holding"       value={fmt(r.dii_holding, '%')} />

              <SectionTitle>Balance Sheet</SectionTitle>
              <MetricRow label="Reserves"     value={fmtCr(r.reserves)} />
              <MetricRow label="Borrowings"   value={fmtCr(r.borrowings)} highlight={r.borrowings != null && r.reserves != null ? (r.borrowings < r.reserves ? 'green' : r.borrowings > r.reserves * 2 ? 'red' : 'amber') : undefined} />
              <MetricRow label="Total Debt"   value={fmtCr(r.total_debt)} />
              <MetricRow label="Debt / Equity" value={fmt(r.debt_to_equity, 'x')} highlight={r.debt_to_equity != null ? (r.debt_to_equity <= 0.5 ? 'green' : r.debt_to_equity >= 1.5 ? 'red' : 'amber') : undefined} />
              <MetricRow label="Current Ratio" value={fmt(r.current_ratio, 'x')} />
            </div>
          )}

          {tab === 'growth' && (
            <div>
              <SectionTitle>Revenue CAGR</SectionTitle>
              <div className="space-y-3 mb-2">
                {(['1y', '3y', '5y'] as const).map(p => (
                  <div key={p}>
                    <div className="text-xs text-gray-500 mb-1">{p === '1y' ? '1 Year' : p === '3y' ? '3 Year' : '5 Year'}</div>
                    <GrowthBar value={r[`revenue_growth_${p}`]} />
                  </div>
                ))}
              </div>
              <SectionTitle>Profit CAGR</SectionTitle>
              <div className="space-y-3">
                {(['1y', '3y', '5y'] as const).map(p => (
                  <div key={p}>
                    <div className="text-xs text-gray-500 mb-1">{p === '1y' ? '1 Year' : p === '3y' ? '3 Year' : '5 Year'}</div>
                    <GrowthBar value={r[`profit_growth_${p}`]} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'comparison' && (
            <div>
              <SectionTitle>6 Month Returns</SectionTitle>
              <BenchCompare label="Stock" stockVal={row.stock_6m} benchVal={row.nifty50_6m}  benchLabel="Nifty 50" />
              <BenchCompare label="Stock" stockVal={row.stock_6m} benchVal={row.nifty500_6m} benchLabel="Nifty 500" />

              <SectionTitle>1 Year Returns</SectionTitle>
              <BenchCompare label="Stock" stockVal={row.stock_1y} benchVal={row.nifty50_1y}  benchLabel="Nifty 50" />
              <BenchCompare label="Stock" stockVal={row.stock_1y} benchVal={row.nifty500_1y} benchLabel="Nifty 500" />
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-200">
          <a href={`https://www.screener.in/company/${row.ticker}/consolidated/`} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:text-blue-500 font-medium">
            View full report on Screener →
          </a>
        </div>
      </div>
    </>
  )
}
