'use client'

import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, Legend } from 'recharts'

export type ChartPoint = {
  date:        string   // 'DD MMM' formatted
  returnPct:   number   // % return vs total invested on that day
  nifty50Pct?: number   // matched benchmark: Nifty50 % return over same holding periods
  nifty500Pct?: number  // matched benchmark: Nifty500 % return over same holding periods
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const byKey: Record<string, number> = {}
  for (const p of payload) byKey[p.dataKey] = p.value as number

  const fmt = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`

  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-lg text-xs space-y-1">
      <div className="text-gray-400 mb-1">{label}</div>
      {byKey.returnPct != null && (
        <div className={`font-bold ${byKey.returnPct >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
          Portfolio {fmt(byKey.returnPct)}
        </div>
      )}
      {byKey.nifty50Pct != null && (
        <div className="text-blue-500">Nifty 50 {fmt(byKey.nifty50Pct)}</div>
      )}
      {byKey.nifty500Pct != null && (
        <div className="text-purple-500">Nifty 500 {fmt(byKey.nifty500Pct)}</div>
      )}
    </div>
  )
}

export default function PortfolioChart({ data }: { data: ChartPoint[] }) {
  if (data.length < 2) {
    return (
      <div className="flex items-center justify-center h-32 text-xs text-gray-400">
        Not enough history yet — check back after a few trading days.
      </div>
    )
  }

  const hasBenchmark = data.some(d => d.nifty50Pct != null)
  const latest = data[data.length - 1]
  const gain   = latest.returnPct >= 0

  const allVals = data.flatMap(d => [
    d.returnPct,
    d.nifty50Pct  ?? d.returnPct,
    d.nifty500Pct ?? d.returnPct,
  ])
  const minVal  = Math.min(...allVals)
  const maxVal  = Math.max(...allVals)
  const padding = Math.max(0.5, (maxVal - minVal) * 0.15)

  return (
    <div>
      {hasBenchmark && (
        <div className="flex items-center gap-4 mb-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5 bg-red-500 rounded" />
            <span className="text-xs text-gray-500">Portfolio</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5 bg-blue-500 rounded" />
            <span className="text-xs text-gray-500">
              Nifty 50 {latest.nifty50Pct != null ? `(${latest.nifty50Pct >= 0 ? '+' : ''}${latest.nifty50Pct.toFixed(2)}%)` : ''}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5 bg-purple-500 rounded" />
            <span className="text-xs text-gray-500">
              Nifty 500 {latest.nifty500Pct != null ? `(${latest.nifty500Pct >= 0 ? '+' : ''}${latest.nifty500Pct.toFixed(2)}%)` : ''}
            </span>
          </div>
        </div>
      )}
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[minVal - padding, maxVal + padding]}
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`}
            width={48}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine y={0} stroke="#e5e7eb" strokeDasharray="3 3" />
          <Line
            type="monotone"
            dataKey="returnPct"
            stroke={gain ? '#10b981' : '#ef4444'}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
          />
          {hasBenchmark && (
            <Line
              type="monotone"
              dataKey="nifty50Pct"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0 }}
            />
          )}
          {hasBenchmark && (
            <Line
              type="monotone"
              dataKey="nifty500Pct"
              stroke="#a855f7"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0 }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
