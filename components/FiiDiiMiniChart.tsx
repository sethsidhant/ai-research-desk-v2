'use client'

import {
  BarChart, Bar, Cell, XAxis, ReferenceLine,
  Tooltip, ResponsiveContainer,
} from 'recharts'

type Row = { date: string; fii_net: number | null; dii_net: number | null }

function fmtCr(n: number) {
  const abs = Math.abs(n)
  if (abs >= 100000) return `${n >= 0 ? '+' : ''}₹${(n / 100000).toFixed(1)}L Cr`
  if (abs >= 1000)   return `${n >= 0 ? '+' : ''}₹${(n / 1000).toFixed(1)}k Cr`
  return `${n >= 0 ? '+' : ''}₹${n.toLocaleString('en-IN')} Cr`
}

export default function FiiDiiMiniChart({ data }: { data: Row[] }) {
  const pts = [...data]
    .filter(r => r.fii_net != null && r.dii_net != null)
    .reverse()
    .map(r => ({
      label: new Date(r.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
      fii: r.fii_net!,
      dii: r.dii_net!,
    }))

  if (pts.length === 0) return null

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="artha-label">7-day Flow</span>
        <div className="flex items-center gap-2 text-[9px]" style={{ color: 'var(--artha-text-faint)' }}>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: '#006a61' }} />FII
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: '#003d9b' }} />DII
          </span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={72}>
        <BarChart data={pts} barCategoryGap="22%" barGap={1}
          margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="label"
            tick={{ fontSize: 7, fill: '#9ca3af', fontFamily: 'inherit' }}
            axisLine={false} tickLine={false}
          />
          <ReferenceLine y={0} stroke="rgba(11,28,48,0.15)" strokeDasharray="3 2" strokeWidth={1} />
          <Tooltip
            contentStyle={{
              background: '#0f2133',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '10px',
              color: '#e5e7eb',
            }}
            formatter={(val, name) => [
              fmtCr(Number(val)),
              name === 'fii' ? 'FII Net' : 'DII Net',
            ]}
            labelStyle={{ color: '#9ca3af', marginBottom: '2px' }}
            cursor={{ fill: 'rgba(11,28,48,0.04)' }}
          />
          <Bar dataKey="fii" name="fii" maxBarSize={9} radius={[2, 2, 0, 0]} isAnimationActive={false}>
            {pts.map((p, i) => (
              <Cell key={i} fill={p.fii >= 0 ? '#006a61' : '#c0392b'} fillOpacity={0.85} />
            ))}
          </Bar>
          <Bar dataKey="dii" name="dii" maxBarSize={9} radius={[2, 2, 0, 0]} isAnimationActive={false}>
            {pts.map((p, i) => (
              <Cell key={i} fill={p.dii >= 0 ? '#003d9b' : '#9a3412'} fillOpacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
