'use client'

import { useState, useEffect, type ReactNode } from 'react'
import { type WatchlistRow, type EarningsQuarter, type ScreenerSection } from './WatchlistTable'
type Tab = 'overview' | 'growth' | 'comparison' | 'analyst' | 'history'
type HistorySection = 'quarterly' | 'annual_pl' | 'balance_sheet' | 'cash_flow' | 'ratios' | 'shareholding'

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

function fmtEarnings(n: number | null) {
  if (n == null) return '—'
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L Cr`
  if (n >= 1000)   return `₹${(n / 1000).toFixed(0)}K Cr`
  return `₹${n.toFixed(0)} Cr`
}

function EarningsTable({ quarters, revenueQuarters }: { quarters: EarningsQuarter[]; revenueQuarters: EarningsQuarter[] }) {
  // Merge by date
  const dates = [...new Set([...quarters.map(q => q.date), ...revenueQuarters.map(q => q.date)])]
  const revMap = Object.fromEntries(revenueQuarters.map(q => [q.date, q]))
  const profMap = Object.fromEntries(quarters.map(q => [q.date, q]))

  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-xs border-separate border-spacing-0">
        <thead>
          <tr>
            <th className="text-left text-gray-400 font-semibold pb-2 pr-2">Qtr</th>
            <th className="text-right text-gray-400 font-semibold pb-2 pr-2">Revenue</th>
            <th className="text-right text-gray-400 font-semibold pb-2">Net Profit</th>
          </tr>
        </thead>
        <tbody>
          {dates.map(date => {
            const rev  = revMap[date]
            const prof = profMap[date]
            const hasActual = (rev?.actual != null) || (prof?.actual != null)
            return (
              <tr key={date} className="border-t border-gray-100">
                <td className="py-1.5 pr-2 text-gray-600 font-medium whitespace-nowrap">{date}</td>
                <td className="py-1.5 pr-2 text-right font-mono">
                  {hasActual && rev?.actual != null
                    ? <span className="text-emerald-700 font-semibold">{fmtEarnings(rev.actual)}</span>
                    : rev?.avg != null
                      ? <span className="text-gray-700">{fmtEarnings(rev.avg)}</span>
                      : <span className="text-gray-400">—</span>
                  }
                </td>
                <td className="py-1.5 text-right font-mono">
                  {hasActual && prof?.actual != null
                    ? <span className="text-emerald-700 font-semibold">{fmtEarnings(prof.actual)}</span>
                    : prof?.avg != null
                      ? <span className="text-gray-700">{fmtEarnings(prof.avg)}</span>
                      : <span className="text-gray-400">—</span>
                  }
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="text-[10px] text-gray-400 mt-1.5">Bold green = actual reported · Gray = analyst estimate (avg)</div>
    </div>
  )
}

// ── Screener history table ────────────────────────────────────────────────────

function fmtHistVal(v: number | null): string {
  if (v == null) return '—'
  return v.toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

// Labels where LOWER value = better (invert green/red)
const INVERT_KEYWORDS = ['borrowing', 'debt', 'days', 'payable', 'expense', 'pledged', 'interest payable', 'provisions']

function isInverted(label: string): boolean {
  const l = label.toLowerCase()
  return INVERT_KEYWORDS.some(k => l.includes(k))
}

// Comparison offset: quarterly YoY = 4 back, everything else = 1 back
function getOffset(sectionKey: HistorySection, qMode: 'qoq' | 'yoy'): number {
  if (sectionKey === 'quarterly') return qMode === 'yoy' ? 4 : 1
  return 1
}

function cellBg(current: number | null, ref: number | null, inverted: boolean): string {
  if (current == null || ref == null || ref === 0) return ''
  const better = inverted ? current < ref : current > ref
  const worse  = inverted ? current > ref : current < ref
  if (better) return 'bg-green-50'
  if (worse)  return 'bg-red-50'
  return ''
}

function ScreenerHistoryTable({ section, sectionKey, qMode }: {
  section: ScreenerSection
  sectionKey: HistorySection
  qMode: 'qoq' | 'yoy'
}) {
  const { headers, rows } = section
  if (!rows.length) return <div className="text-base text-gray-400 py-6">No data available</div>

  const offset = getOffset(sectionKey, qMode)

  return (
    <div>
      <div className="text-xs font-medium text-gray-400 tracking-wide mb-4">Consolidated Figures in Rs. Crores</div>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0">
          <thead>
            <tr className="bg-gray-50">
              <th className="text-left text-gray-500 text-xs font-bold uppercase tracking-wider py-3 px-4 sticky left-0 bg-gray-50 whitespace-nowrap min-w-[180px] z-10 border-b border-gray-200">Metric</th>
              {headers.map((h, i) => (
                <th key={i} className="text-right text-gray-500 text-xs font-bold uppercase tracking-wider py-3 px-4 whitespace-nowrap border-b border-gray-200">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => {
              const inverted = isInverted(row.label)
              return (
                <tr key={ri}>
                  <td className={`py-2.5 px-4 sticky left-0 font-semibold text-sm text-gray-700 whitespace-nowrap border-r border-b border-gray-100 z-10 ${ri % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}`}>{row.label}</td>
                  {row.values.map((v, vi) => {
                    const ref = row.values[vi + offset] ?? null
                    const bg  = cellBg(v, ref, inverted)
                    return (
                      <td key={vi} className={`py-2.5 px-4 text-right text-sm font-mono whitespace-nowrap border-b border-gray-100 ${bg} ${v == null ? 'text-gray-300' : 'text-gray-800'}`}>
                        {fmtHistVal(v)}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
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

const HISTORY_SECTIONS: { id: HistorySection; label: string }[] = [
  { id: 'quarterly',    label: 'Quarterly' },
  { id: 'annual_pl',    label: 'P&L' },
  { id: 'balance_sheet', label: 'Bal. Sheet' },
  { id: 'cash_flow',    label: 'Cash Flow' },
  { id: 'ratios',       label: 'Ratios' },
  { id: 'shareholding', label: 'Holding' },
]

export default function FundamentalsDrawer({ row, onClose }: { row: WatchlistRow | null; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('overview')
  const [historySection, setHistorySection] = useState<HistorySection>('quarterly')
  const [qMode, setQMode] = useState<'qoq' | 'yoy'>('yoy')

  useEffect(() => { if (row) setTab('overview') }, [row?.stock_id])

  if (!row) return null

  const r = row as any
  const hasAnalystData = row.industry !== 'ETF' && (row.analyst_rating || row.target_mean)
  const hasHistory = !!row.earnings_history
  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview',   label: 'Fundamentals' },
    { id: 'growth',     label: 'Growth' },
    { id: 'comparison', label: 'vs Nifty' },
    ...(hasAnalystData ? [{ id: 'analyst' as Tab, label: 'Analyst' }] : []),
    ...(hasHistory ? [{ id: 'history' as Tab, label: 'History' }] : []),
  ]

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
      <div className={`fixed right-0 top-0 h-full w-full bg-white shadow-2xl z-50 flex flex-col transition-[width] duration-200 ${tab === 'history' ? 'sm:w-screen' : 'sm:w-[420px]'}`}>

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

          {tab === 'analyst' && (
            <div>
              {/* Analyst Consensus */}
              {row.analyst_rating && (
                <>
                  <SectionTitle>Analyst Consensus</SectionTitle>
                  <div className="flex items-center justify-between mb-3">
                    <span className={`text-sm font-bold px-3 py-1 rounded-full ${
                      row.analyst_rating === 'Buy' ? 'bg-emerald-100 text-emerald-700' :
                      row.analyst_rating === 'Sell' ? 'bg-red-100 text-red-700' :
                      'bg-amber-100 text-amber-700'
                    }`}>{row.analyst_rating}</span>
                    {row.analyst_count && (
                      <span className="text-xs text-gray-400">{row.analyst_count} analysts</span>
                    )}
                  </div>
                  {(row.analyst_buy_pct != null || row.analyst_hold_pct != null || row.analyst_sell_pct != null) && (
                    <div className="space-y-2 mb-4">
                      {[
                        { label: 'Buy', pct: row.analyst_buy_pct, color: 'bg-emerald-500', text: 'text-emerald-700' },
                        { label: 'Hold', pct: row.analyst_hold_pct, color: 'bg-amber-400', text: 'text-amber-700' },
                        { label: 'Sell', pct: row.analyst_sell_pct, color: 'bg-red-500', text: 'text-red-700' },
                      ].map(({ label, pct, color, text }) => (
                        <div key={label} className="flex items-center gap-2">
                          <span className={`text-xs font-semibold w-8 ${text}`}>{label}</span>
                          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${color}`} style={{ width: `${pct ?? 0}%` }} />
                          </div>
                          <span className="text-xs font-mono text-gray-500 w-8 text-right">{pct != null ? `${pct.toFixed(0)}%` : '—'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* Price Target */}
              {row.target_mean != null && row.current_price != null && (
                <>
                  <SectionTitle>Price Target</SectionTitle>
                  <div className="bg-gray-50 rounded-xl p-3 mb-4">
                    <div className="flex justify-between items-end mb-2">
                      {[
                        { label: 'Low', value: row.target_low },
                        { label: 'Mean', value: row.target_mean, bold: true },
                        { label: 'High', value: row.target_high },
                      ].map(({ label, value, bold }) => (
                        <div key={label} className="text-center">
                          <div className={`font-mono ${bold ? 'text-base font-bold text-gray-900' : 'text-sm font-semibold text-gray-500'}`}>
                            {value != null ? `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'}
                          </div>
                          <div className="text-[10px] text-gray-400 mt-0.5">{label}</div>
                        </div>
                      ))}
                    </div>
                    {row.target_mean != null && (
                      <div className="text-center mt-1">
                        <span className={`text-sm font-semibold ${row.target_mean > row.current_price ? 'text-emerald-600' : 'text-red-600'}`}>
                          {row.target_mean > row.current_price ? '▲' : '▼'} {Math.abs(((row.target_mean - row.current_price) / row.current_price) * 100).toFixed(1)}% upside
                        </span>
                        <span className="text-xs text-gray-400 ml-1">(vs ₹{row.current_price.toLocaleString('en-IN', { maximumFractionDigits: 0 })})</span>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Earnings Forecast */}
              {row.mc_earnings_json && (row.mc_earnings_json.revenue?.length > 0 || row.mc_earnings_json.netProfit?.length > 0) && (
                <>
                  <SectionTitle>Earnings Forecast</SectionTitle>
                  <EarningsTable
                    quarters={row.mc_earnings_json.netProfit ?? []}
                    revenueQuarters={row.mc_earnings_json.revenue ?? []}
                  />
                </>
              )}

            </div>
          )}

          {tab === 'history' && row.earnings_history && (
            <div>
              {/* Sub-section pills + YoY/QoQ toggle */}
              <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
                <div className="flex gap-2 flex-wrap">
                  {HISTORY_SECTIONS.map(s => (
                    <button
                      key={s.id}
                      onClick={() => setHistorySection(s.id)}
                      className={`px-4 py-1.5 text-xs font-semibold rounded-full transition-colors ${
                        historySection === s.id
                          ? 'bg-gray-900 text-white'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                {historySection === 'quarterly' && (
                  <div className="flex items-center gap-1 bg-gray-100 rounded-full p-0.5">
                    {(['yoy', 'qoq'] as const).map(m => (
                      <button
                        key={m}
                        onClick={() => setQMode(m)}
                        className={`px-3 py-1 text-xs font-semibold rounded-full transition-colors ${
                          qMode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'
                        }`}
                      >
                        {m.toUpperCase()}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {(() => {
                const section = row.earnings_history![historySection]
                if (!section) return <div className="text-xs text-gray-400 py-4">No data for this section</div>
                return <ScreenerHistoryTable section={section} sectionKey={historySection} qMode={qMode} />
              })()}
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-200 flex items-center gap-4">
          <a href={`https://www.screener.in/company/${row.ticker}/consolidated/`} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:text-blue-500 font-medium">
            Screener →
          </a>
          <a href={`https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(row.ticker)}`} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-500 hover:text-gray-700 font-medium">
            NSE →
          </a>
          <a href={`https://www.bseindia.com/equity_stock_info/${row.ticker}`} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-500 hover:text-gray-700 font-medium">
            BSE →
          </a>
        </div>
      </div>
    </>
  )
}
