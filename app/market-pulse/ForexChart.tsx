'use client'

import { useState, useMemo } from 'react'
import {
  ComposedChart, Area, Bar, Cell, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts'

type Row = {
  date: string
  total_usd_mn: number
  fca_usd_mn: number
  gold_usd_mn: number
  sdrs_usd_mn: number
  imf_usd_mn: number
  wow_change_usd_mn: number
  yoy_change_usd_mn: number
}

type FiiRow = {
  date: string
  fii_net: number
}

function fmtB(mn: number) { return `$${(mn / 1000).toFixed(1)}B` }
function fmtBn(mn: number) { return (mn / 1000).toFixed(1) }
function fmtCr(cr: number) { return `₹${Math.round(Math.abs(cr)).toLocaleString('en-IN')}cr` }
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })
}
function fmtDateShort(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

const PERIODS = [
  { label: '3M', months: 3 },
  { label: '6M', months: 6 },
  { label: '1Y', months: 12 },
  { label: 'All', months: 999 },
]

function StatCard({ label, value, sub, subColor }: { label: string; value: string; sub?: string; subColor?: string }) {
  return (
    <div className="artha-card p-4 flex flex-col gap-1">
      <p className="text-xs font-medium" style={{ color: 'var(--artha-text-muted)' }}>{label}</p>
      <p className="text-xl font-bold font-display" style={{ color: 'var(--artha-text)', letterSpacing: '-0.02em' }}>{value}</p>
      {sub && <p className="text-xs font-medium" style={{ color: subColor ?? 'var(--artha-text-muted)' }}>{sub}</p>}
    </div>
  )
}

function BreakdownBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0
  return (
    <div className="flex items-center gap-3">
      <div className="w-32 text-xs font-medium shrink-0" style={{ color: 'var(--artha-text-muted)' }}>{label}</div>
      <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <div className="w-20 text-xs font-semibold text-right" style={{ color: 'var(--artha-text)' }}>{fmtB(value)}</div>
      <div className="w-10 text-xs text-right" style={{ color: 'var(--artha-text-muted)' }}>{pct.toFixed(1)}%</div>
    </div>
  )
}

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const wow = d.wow_change_usd_mn
  const fii = d.fii_weekly_cr
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-xs min-w-[180px]">
      <p className="font-semibold mb-2 text-gray-700">{fmtDate(d.date)}</p>
      <p className="font-bold text-base text-gray-900 mb-1">{fmtB(d.total_usd_mn)}</p>
      <p className={`font-medium ${wow >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
        {wow >= 0 ? '▲' : '▼'} ${Math.abs(wow / 1000).toFixed(2)}B WoW reserves
      </p>
      {fii != null && (
        <p className={`font-medium mt-1 ${fii >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
          FII: {fii >= 0 ? '+' : '-'}{fmtCr(fii)} that week
        </p>
      )}
      <div className="mt-2 space-y-0.5 text-gray-500">
        <p>FCA: {fmtB(d.fca_usd_mn)}</p>
        <p>Gold: {fmtB(d.gold_usd_mn)}</p>
        <p>SDRs + IMF: {fmtB((d.sdrs_usd_mn ?? 0) + (d.imf_usd_mn ?? 0))}</p>
      </div>
    </div>
  )
}

// Aggregate daily FII net into weekly sums ending on each forex date
function buildWeeklyFii(fiiDii: FiiRow[], forexDates: string[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const forexDate of forexDates) {
    const end   = new Date(forexDate)
    const start = new Date(forexDate)
    start.setDate(start.getDate() - 6)
    const startStr = start.toISOString().slice(0, 10)
    const total = fiiDii
      .filter(r => r.date >= startStr && r.date <= forexDate)
      .reduce((s, r) => s + (r.fii_net ?? 0), 0)
    map.set(forexDate, Math.round(total))
  }
  return map
}

export default function ForexChart({ data, fiiDii = [] }: { data: Row[]; fiiDii?: FiiRow[] }) {
  const [period, setPeriod] = useState('1Y')
  const [showFii, setShowFii] = useState(true)

  const filtered = useMemo(() => {
    const months = PERIODS.find(p => p.label === period)?.months ?? 12
    const cutoff = new Date()
    cutoff.setMonth(cutoff.getMonth() - months)
    return data.filter(d => new Date(d.date) >= cutoff)
  }, [data, period])

  const latest  = data[data.length - 1]
  const prev    = data[data.length - 2]
  const oldest  = filtered[0]

  if (!latest) return null

  const wow     = latest.wow_change_usd_mn
  const yoy     = latest.yoy_change_usd_mn
  const ytdChg  = oldest ? latest.total_usd_mn - oldest.total_usd_mn : 0
  const wowColor = wow >= 0 ? '#10b981' : '#ef4444'

  const vals   = filtered.map(d => d.total_usd_mn)
  const minVal = Math.min(...vals)
  const maxVal = Math.max(...vals)
  const pad    = (maxVal - minVal) * 0.1

  // Build weekly FII map and merge into chart data
  const weeklyFiiMap = useMemo(() =>
    buildWeeklyFii(fiiDii, filtered.map(d => d.date)),
    [fiiDii, filtered]
  )

  const chartData = useMemo(() =>
    filtered.map(d => ({ ...d, fii_weekly_cr: weeklyFiiMap.get(d.date) ?? null })),
    [filtered, weeklyFiiMap]
  )

  // FII bar domain
  const fiiVals = chartData.map(d => d.fii_weekly_cr).filter(v => v != null) as number[]
  const fiiMax  = fiiVals.length ? Math.max(...fiiVals.map(Math.abs)) * 1.2 : 50000

  return (
    <div className="space-y-4">

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Total Reserves"
          value={fmtB(latest.total_usd_mn)}
          sub={`As of ${fmtDateShort(latest.date)}`}
        />
        <StatCard
          label="Week-on-Week"
          value={`${wow >= 0 ? '+' : ''}$${fmtBn(wow)}B`}
          sub={wow >= 0 ? '▲ Increased' : '▼ Decreased'}
          subColor={wowColor}
        />
        <StatCard
          label="Year-on-Year"
          value={`${yoy >= 0 ? '+' : ''}$${fmtBn(yoy)}B`}
          sub={yoy >= 0 ? '▲ vs last year' : '▼ vs last year'}
          subColor={yoy >= 0 ? '#10b981' : '#ef4444'}
        />
        <StatCard
          label={`${period === 'All' ? 'Period' : period} Change`}
          value={`${ytdChg >= 0 ? '+' : ''}$${fmtBn(ytdChg)}B`}
          sub={oldest ? `Since ${fmtDateShort(oldest.date)}` : ''}
          subColor={ytdChg >= 0 ? '#10b981' : '#ef4444'}
        />
      </div>

      {/* Chart */}
      <div className="artha-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--artha-text)' }}>
              Forex Reserves vs FII Flow
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--artha-text-muted)' }}>
              USD Billions (left) · Weekly FII net ₹Cr (right)
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowFii(v => !v)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border ${
                showFii
                  ? 'border-emerald-500 text-emerald-600 bg-emerald-50'
                  : 'border-gray-200 text-gray-400'
              }`}
            >
              FII overlay
            </button>
            <div className="flex gap-1">
              {PERIODS.map(p => (
                <button
                  key={p.label}
                  onClick={() => setPeriod(p.label)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    period === p.label
                      ? 'bg-indigo-600 text-white'
                      : 'text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 52, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="forexGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={fmtDateShort}
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              yAxisId="reserves"
              tickFormatter={v => `$${(v / 1000).toFixed(0)}B`}
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              tickLine={false}
              axisLine={false}
              width={52}
              domain={[minVal - pad, maxVal + pad]}
            />
            {showFii && (
              <YAxis
                yAxisId="fii"
                orientation="right"
                tickFormatter={v => `₹${Math.round(v / 1000)}k`}
                tick={{ fontSize: 10, fill: '#9ca3af' }}
                tickLine={false}
                axisLine={false}
                width={52}
                domain={[-fiiMax, fiiMax]}
              />
            )}
            <Tooltip content={<CustomTooltip />} />
            {showFii && (
              <Bar yAxisId="fii" dataKey="fii_weekly_cr" opacity={0.5} radius={[2, 2, 0, 0]}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={(d.fii_weekly_cr ?? 0) >= 0 ? '#10b981' : '#ef4444'} />
                ))}
              </Bar>
            )}
            <Area
              yAxisId="reserves"
              type="monotone"
              dataKey="total_usd_mn"
              stroke="#6366f1"
              strokeWidth={2}
              fill="url(#forexGrad)"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0, fill: '#6366f1' }}
            />
          </ComposedChart>
        </ResponsiveContainer>

        {showFii && (
          <div className="flex items-center gap-4 mt-3 text-xs" style={{ color: 'var(--artha-text-muted)' }}>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm bg-emerald-400 opacity-70" />
              FII net inflow (weekly)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-12 h-0.5 bg-indigo-500" />
              Forex reserves
            </span>
          </div>
        )}
      </div>

      {/* Breakdown */}
      <div className="artha-card p-5">
        <h2 className="text-base font-semibold mb-1" style={{ color: 'var(--artha-text)' }}>
          Composition Breakdown
        </h2>
        <p className="text-xs mb-4" style={{ color: 'var(--artha-text-muted)' }}>
          As of {fmtDate(latest.date)}
        </p>
        <div className="space-y-3">
          <BreakdownBar label="Foreign Currency" value={latest.fca_usd_mn}  total={latest.total_usd_mn} color="#6366f1" />
          <BreakdownBar label="Gold"             value={latest.gold_usd_mn} total={latest.total_usd_mn} color="#f59e0b" />
          <BreakdownBar label="SDRs"             value={latest.sdrs_usd_mn} total={latest.total_usd_mn} color="#10b981" />
          <BreakdownBar label="IMF Position"     value={latest.imf_usd_mn}  total={latest.total_usd_mn} color="#8b5cf6" />
        </div>
        <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'FCA WoW',  val: prev ? latest.fca_usd_mn  - prev.fca_usd_mn  : null },
            { label: 'Gold WoW', val: prev ? latest.gold_usd_mn - prev.gold_usd_mn : null },
            { label: 'SDRs WoW', val: prev ? latest.sdrs_usd_mn - prev.sdrs_usd_mn : null },
            { label: 'IMF WoW',  val: prev ? latest.imf_usd_mn  - prev.imf_usd_mn  : null },
          ].map(({ label, val }) => (
            <div key={label} className="text-center">
              <p className="text-xs" style={{ color: 'var(--artha-text-muted)' }}>{label}</p>
              <p className={`text-sm font-semibold mt-0.5 ${val == null ? 'text-gray-400' : val >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {val == null ? '—' : `${val >= 0 ? '+' : ''}$${fmtBn(val)}B`}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Weekly history table */}
      <div className="artha-card p-5">
        <h2 className="text-base font-semibold mb-4" style={{ color: 'var(--artha-text)' }}>
          Recent Weekly Data
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100">
                {['Date', 'Total', 'WoW Change', 'FII (week)', 'FCA', 'Gold', 'SDRs', 'IMF'].map(h => (
                  <th key={h} className="text-left pb-2 pr-4 font-medium" style={{ color: 'var(--artha-text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().slice(0, 12).map(row => {
                const w   = row.wow_change_usd_mn
                const fii = weeklyFiiMap.get(row.date) ?? null
                return (
                  <tr key={row.date} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 pr-4 font-medium" style={{ color: 'var(--artha-text)' }}>{fmtDateShort(row.date)}</td>
                    <td className="py-2 pr-4 font-semibold" style={{ color: 'var(--artha-text)' }}>{fmtB(row.total_usd_mn)}</td>
                    <td className={`py-2 pr-4 font-medium ${w >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {w >= 0 ? '+' : ''}${fmtBn(w)}B
                    </td>
                    <td className={`py-2 pr-4 font-medium ${fii == null ? '' : fii >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {fii == null ? '—' : `${fii >= 0 ? '+' : '-'}₹${Math.abs(fii).toLocaleString('en-IN')}cr`}
                    </td>
                    <td className="py-2 pr-4" style={{ color: 'var(--artha-text-muted)' }}>{fmtB(row.fca_usd_mn)}</td>
                    <td className="py-2 pr-4" style={{ color: 'var(--artha-text-muted)' }}>{fmtB(row.gold_usd_mn)}</td>
                    <td className="py-2 pr-4" style={{ color: 'var(--artha-text-muted)' }}>{fmtB(row.sdrs_usd_mn)}</td>
                    <td className="py-2 pr-4" style={{ color: 'var(--artha-text-muted)' }}>{fmtB(row.imf_usd_mn)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
