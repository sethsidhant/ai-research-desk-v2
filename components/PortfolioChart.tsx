'use client'

import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts'

export type ChartPoint = {
  date: string        // 'DD MMM' formatted
  returnPct: number   // % return vs total invested on that day
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const val = payload[0].value as number
  const gain = val >= 0
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-lg text-xs">
      <div className="text-gray-400 mb-1">{label}</div>
      <div className={`font-bold text-sm ${gain ? 'text-emerald-600' : 'text-red-500'}`}>
        {gain ? '+' : ''}{val.toFixed(2)}%
      </div>
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

  const latest  = data[data.length - 1].returnPct
  const gain    = latest >= 0
  const minVal  = Math.min(...data.map(d => d.returnPct))
  const maxVal  = Math.max(...data.map(d => d.returnPct))
  const padding = Math.max(0.5, (maxVal - minVal) * 0.15)

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-3">
        <span className={`text-2xl font-bold ${gain ? 'text-emerald-600' : 'text-red-500'}`}>
          {gain ? '+' : ''}{latest.toFixed(2)}%
        </span>
        <span className="text-xs text-gray-400">total return since tracking</span>
      </div>
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
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
