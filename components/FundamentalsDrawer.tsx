'use client'

import { useState } from 'react'
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

function MetricRow({ label, value, highlight }: { label: string; value: string; highlight?: 'green' | 'red' | 'amber' }) {
  const color = highlight === 'green' ? 'text-emerald-600' : highlight === 'red' ? 'text-red-600' : highlight === 'amber' ? 'text-amber-600' : 'text-gray-900'
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className={`text-sm font-semibold font-mono ${color}`}>{value}</span>
    </div>
  )
}

function returnHighlight(stock: number | null, bench: number | null): 'green' | 'red' | undefined {
  if (stock == null || bench == null) return undefined
  return stock >= bench ? 'green' : 'red'
}

export default function FundamentalsDrawer({
  row,
  onClose,
}: {
  row: WatchlistRow | null
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('overview')

  if (!row) return null

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview',    label: 'Fundamentals' },
    { id: 'growth',      label: 'Growth' },
    { id: 'comparison',  label: 'vs Nifty' },
  ]

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 z-40"
        onClick={onClose}
      />

      {/* Drawer */}
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
                tab === t.id
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-400 hover:text-gray-600'
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
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Valuation</div>
              <MetricRow label="Stock PE" value={fmt(row.stock_pe, 'x')} />
              <MetricRow label="Industry PE" value={fmt(row.industry_pe, 'x')} />
              <MetricRow
                label="PE vs Industry"
                value={row.pe_deviation != null ? `${row.pe_deviation > 0 ? '+' : ''}${row.pe_deviation.toFixed(1)}%` : '—'}
                highlight={row.pe_deviation != null ? (row.pe_deviation <= -10 ? 'green' : row.pe_deviation >= 20 ? 'red' : undefined) : undefined}
              />
              <MetricRow label="P/B Ratio" value={fmt((row as any).pb, 'x')} />
              <MetricRow label="EPS" value={(row as any).eps != null ? `₹${(row as any).eps.toFixed(2)}` : '—'} />
              <MetricRow label="Dividend Yield" value={fmt((row as any).dividend_yield, '%')} />
              <MetricRow label="Market Cap" value={fmtCr((row as any).market_cap)} />

              <div className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3 mt-5">Quality</div>
              <MetricRow
                label="ROCE"
                value={fmt((row as any).roce, '%')}
                highlight={(row as any).roce != null ? ((row as any).roce >= 15 ? 'green' : (row as any).roce < 10 ? 'red' : 'amber') : undefined}
              />
              <MetricRow
                label="ROE"
                value={fmt((row as any).roe, '%')}
                highlight={(row as any).roe != null ? ((row as any).roe >= 15 ? 'green' : (row as any).roe < 10 ? 'red' : 'amber') : undefined}
              />
              <MetricRow label="Promoter Holding" value={fmt((row as any).promoter_holding, '%')} />

              <div className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3 mt-5">Financial Health</div>
              <MetricRow
                label="Debt / Equity"
                value={fmt((row as any).debt_to_equity, 'x')}
                highlight={(row as any).debt_to_equity != null ? ((row as any).debt_to_equity <= 0.5 ? 'green' : (row as any).debt_to_equity >= 1.5 ? 'red' : 'amber') : undefined}
              />
              <MetricRow label="Current Ratio" value={fmt((row as any).current_ratio, 'x')} />
              <MetricRow label="Total Debt" value={fmtCr((row as any).total_debt)} />
            </div>
          )}

          {tab === 'growth' && (
            <div>
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">Revenue CAGR</div>
              <div className="space-y-3 mb-6">
                <div>
                  <div className="text-xs text-gray-500 mb-1">1 Year</div>
                  <GrowthBar value={(row as any).revenue_growth_1y} />
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">3 Year</div>
                  <GrowthBar value={(row as any).revenue_growth_3y} />
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">5 Year</div>
                  <GrowthBar value={(row as any).revenue_growth_5y} />
                </div>
              </div>

              <div className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">Profit CAGR</div>
              <div className="space-y-3">
                <div>
                  <div className="text-xs text-gray-500 mb-1">1 Year</div>
                  <GrowthBar value={(row as any).profit_growth_1y} />
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">3 Year</div>
                  <GrowthBar value={(row as any).profit_growth_3y} />
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">5 Year</div>
                  <GrowthBar value={(row as any).profit_growth_5y} />
                </div>
              </div>
            </div>
          )}

          {tab === 'comparison' && (
            <div>
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">6 Month Returns</div>
              <MetricRow label={row.stock_name} value={row.stock_6m != null ? `${row.stock_6m > 0 ? '+' : ''}${row.stock_6m.toFixed(1)}%` : '—'} highlight={returnHighlight(row.stock_6m, row.nifty50_6m)} />
              <MetricRow label="Nifty 50" value={row.nifty50_6m != null ? `${row.nifty50_6m > 0 ? '+' : ''}${row.nifty50_6m.toFixed(1)}%` : '—'} />

              {row.stock_6m != null && row.nifty50_6m != null && (
                <div className={`text-xs mt-2 mb-4 font-medium ${row.stock_6m >= row.nifty50_6m ? 'text-emerald-600' : 'text-red-600'}`}>
                  {row.stock_6m >= row.nifty50_6m
                    ? `↑ Outperforming Nifty 50 by ${(row.stock_6m - row.nifty50_6m).toFixed(1)}%`
                    : `↓ Underperforming Nifty 50 by ${(row.nifty50_6m - row.stock_6m).toFixed(1)}%`}
                </div>
              )}

              <div className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3 mt-5">1 Year Returns</div>
              <MetricRow label={row.stock_name} value={row.stock_1y != null ? `${row.stock_1y > 0 ? '+' : ''}${row.stock_1y.toFixed(1)}%` : '—'} highlight={returnHighlight(row.stock_1y, row.nifty50_1y)} />
              <MetricRow label="Nifty 50" value={row.nifty50_1y != null ? `${row.nifty50_1y > 0 ? '+' : ''}${row.nifty50_1y.toFixed(1)}%` : '—'} />

              {row.stock_1y != null && row.nifty50_1y != null && (
                <div className={`text-xs mt-2 font-medium ${row.stock_1y >= row.nifty50_1y ? 'text-emerald-600' : 'text-red-600'}`}>
                  {row.stock_1y >= row.nifty50_1y
                    ? `↑ Outperforming Nifty 50 by ${(row.stock_1y - row.nifty50_1y).toFixed(1)}%`
                    : `↓ Underperforming Nifty 50 by ${(row.nifty50_1y - row.stock_1y).toFixed(1)}%`}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer — Screener link */}
        <div className="px-5 py-3 border-t border-gray-200">
          <a
            href={`https://www.screener.in/company/${row.ticker}/consolidated/`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:text-blue-500 font-medium"
          >
            View full report on Screener →
          </a>
        </div>
      </div>
    </>
  )
}
