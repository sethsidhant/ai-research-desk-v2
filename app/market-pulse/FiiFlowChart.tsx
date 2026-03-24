'use client'

import { useState, useMemo } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts'

type Point = { date: string; cumulative_net: number | null }

const PERIODS = [
  { label: '1Y', days: 365 },
  { label: '3Y', days: 1095 },
  { label: '5Y', days: 1825 },
]

function formatCr(val: number) {
  const abs = Math.abs(val)
  if (abs >= 100000) return `${(val / 100000).toFixed(1)}L Cr`
  if (abs >= 1000)   return `${(val / 1000).toFixed(1)}k Cr`
  return `${val.toFixed(0)} Cr`
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })
}

export default function FiiFlowChart({ data }: { data: Point[] }) {
  const [period, setPeriod] = useState('1Y')

  const filtered = useMemo(() => {
    const days = PERIODS.find(p => p.label === period)?.days ?? 365
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    const pts = data
      .filter(d => d.cumulative_net != null && new Date(d.date) >= cutoff)
      .map(d => ({ date: d.date, value: d.cumulative_net as number }))

    // Compute day flow (delta) and 1W flow (sum of last 5 deltas) for tooltip
    return pts.map((p, i) => {
      const dayFlow = i === 0 ? 0 : parseFloat((p.value - pts[i - 1].value).toFixed(2))
      const weekFlow = parseFloat(
        [1,2,3,4,5].reduce((sum, k) => {
          const prev = pts[i - k]
          const cur  = pts[i - k + 1]
          return sum + (prev && cur ? cur.value - prev.value : 0)
        }, 0).toFixed(2)
      )
      return { ...p, dayFlow, weekFlow }
    })
  }, [data, period])

  const first  = filtered[0]?.value ?? 0
  const latest = filtered[filtered.length - 1]?.value ?? 0
  const periodChange = parseFloat((latest - first).toFixed(2))
  const isPositive   = periodChange >= 0

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Cumulative FII Net Flow (₹ Cr)</h2>
          <div className="flex items-center gap-2 mt-0.5">
            <p className={`text-sm font-mono font-semibold ${isPositive ? 'text-emerald-600' : 'text-red-600'}`}>
              {isPositive ? '+' : ''}{formatCr(periodChange)}
            </p>
            <span className="text-xs text-gray-400">{period} change</span>
            <span className="text-xs text-gray-300">·</span>
            <span className="text-xs text-gray-400 font-mono">{formatCr(latest)} total</span>
          </div>
        </div>
        <div className="flex gap-1">
          {PERIODS.map(p => (
            <button
              key={p.label}
              onClick={() => setPeriod(p.label)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                period === p.label
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={filtered} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="fiiGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={isPositive ? '#10b981' : '#ef4444'} stopOpacity={0.15} />
              <stop offset="95%" stopColor={isPositive ? '#10b981' : '#ef4444'} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="date"
            tickFormatter={d => new Date(d).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })}
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={60}
          />
          <YAxis
            tickFormatter={v => formatCr(v)}
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            width={70}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const pt = payload[0].payload
              return (
                <div className="bg-white border border-gray-200 rounded-lg px-3 py-2.5 shadow text-xs space-y-1">
                  <p className="text-gray-500 font-medium">{formatDate(pt.date)}</p>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-gray-400">Day flow</span>
                    <span className={`font-mono font-semibold ${pt.dayFlow >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {pt.dayFlow >= 0 ? '+' : ''}{formatCr(pt.dayFlow)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-gray-400">1W flow</span>
                    <span className={`font-mono font-semibold ${pt.weekFlow >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {pt.weekFlow >= 0 ? '+' : ''}{formatCr(pt.weekFlow)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4 pt-0.5 border-t border-gray-100">
                    <span className="text-gray-400">Cumulative</span>
                    <span className="font-mono text-gray-600">{formatCr(pt.value)}</span>
                  </div>
                </div>
              )
            }}
          />
          <ReferenceLine y={0} stroke="#d1d5db" strokeDasharray="3 3" />
          <Area
            type="monotone"
            dataKey="value"
            stroke={isPositive ? '#10b981' : '#ef4444'}
            strokeWidth={2}
            fill="url(#fiiGradient)"
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
