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
    // Normalize to start at 0 for the selected period (same as Screener)
    if (pts.length > 0) {
      const base = pts[0].value
      return pts.map(p => ({ ...p, value: parseFloat((p.value - base).toFixed(2)) }))
    }
    return pts
  }, [data, period])

  const latest = filtered[filtered.length - 1]?.value ?? 0
  const isPositive = latest >= 0

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Cumulative FII Net Flow (₹ Cr)</h2>
          <p className={`text-sm font-mono font-semibold mt-0.5 ${isPositive ? 'text-emerald-600' : 'text-red-600'}`}>
            {isPositive ? '+' : ''}{formatCr(latest)}
          </p>
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
              const v = payload[0].value as number
              return (
                <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 shadow text-xs">
                  <p className="text-gray-500">{formatDate(payload[0].payload.date)}</p>
                  <p className={`font-semibold font-mono ${v >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {v >= 0 ? '+' : ''}{formatCr(v)}
                  </p>
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
