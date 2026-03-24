'use client'

import { BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, Legend } from 'recharts'

type Row = { date: string; fii_net: number | null; dii_net: number | null }

function formatCr(val: number) {
  const abs = Math.abs(val)
  if (abs >= 1000) return `${(val / 1000).toFixed(1)}k`
  return `${val.toFixed(0)}`
}

export default function DailyFlowChart({ data }: { data: Row[] }) {
  const last30 = data.slice(-30).map(d => ({
    date: d.date,
    FII: d.fii_net != null ? Math.round(d.fii_net) : null,
    DII: d.dii_net != null ? Math.round(d.dii_net) : null,
  }))

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
      <h2 className="text-base font-semibold text-gray-900 mb-4">Daily FII / DII Net Flow (₹ Cr) — Last 30 days</h2>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={last30} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barGap={2}>
          <XAxis
            dataKey="date"
            tickFormatter={d => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            interval={4}
          />
          <YAxis
            tickFormatter={v => formatCr(v)}
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            width={55}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              return (
                <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 shadow text-xs space-y-1">
                  <p className="text-gray-500">{new Date(label).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}</p>
                  {payload.map(p => (
                    <p key={p.name} className="font-mono font-semibold" style={{ color: p.color }}>
                      {p.name}: {(p.value as number) >= 0 ? '+' : ''}₹{((p.value as number) / 1).toLocaleString('en-IN')} Cr
                    </p>
                  ))}
                </div>
              )
            }}
          />
          <ReferenceLine y={0} stroke="#d1d5db" />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="FII" fill="#3b82f6" radius={[2, 2, 0, 0]}
            label={false}
            // negative bars in red
            isAnimationActive={false}
          />
          <Bar dataKey="DII" fill="#10b981" radius={[2, 2, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
