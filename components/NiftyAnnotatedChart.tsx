'use client'

import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'

type Close = { date: string; close: number }
type NewsItem = { summary: string; channel: string; affected_sectors: string[] | null }
type TP = { date: string; pct: number; close: number; news: NewsItem[] }

const CH: Record<string, string> = {
  trump: '🇺🇸', trump_ts_posts: '🇺🇸', trumptruthposts: '🇺🇸',
  moneycontrol: '📊', et_markets: '📰',
}

function fmtD(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

// Recharts custom dot — only renders for turning point dates
function TurningDot(props: any) {
  const { cx, cy, payload } = props
  if (!payload?.tp) return <g />
  const up = payload.tp.pct >= 0
  const color = up ? '#006a61' : '#c0392b'
  const bg = up ? 'rgba(0,106,97,0.12)' : 'rgba(192,57,43,0.1)'
  return (
    <g>
      {/* Halo */}
      <circle cx={cx} cy={cy} r={13} fill={bg} />
      {/* Dot */}
      <circle cx={cx} cy={cy} r={8} fill={color} stroke="white" strokeWidth={2} />
      {/* Arrow */}
      <text x={cx} y={cy + 0.5} textAnchor="middle" dominantBaseline="middle"
        fill="white" fontSize={8} fontWeight="bold">
        {up ? '▲' : '▼'}
      </text>
    </g>
  )
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.[0]?.payload?.tp) return null
  const tp: TP = payload[0].payload.tp
  const up = tp.pct >= 0
  const color = up ? '#4ade80' : '#f87171'
  return (
    <div style={{
      background: '#0f2133',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 10,
      padding: '10px 14px',
      maxWidth: 260,
      boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      pointerEvents: 'none',
    }}>
      <div style={{ color: '#9ca3af', fontSize: 10, marginBottom: 4 }}>
        {fmtD(tp.date)} · {tp.close.toLocaleString('en-IN')}
      </div>
      <div style={{ color, fontSize: 16, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 8 }}>
        {up ? '+' : ''}{tp.pct.toFixed(2)}% Nifty
      </div>
      {tp.news.length === 0 ? (
        <p style={{ color: '#6b7280', fontSize: 10, fontStyle: 'italic' }}>No news captured</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {tp.news.slice(0, 2).map((n, i) => (
            <div key={i} style={{ display: 'flex', gap: 6 }}>
              <span style={{ fontSize: 10, flexShrink: 0, marginTop: 1 }}>
                {CH[n.channel] ?? '📰'}
              </span>
              <p style={{ color: '#e5e7eb', fontSize: 10, lineHeight: 1.45, margin: 0 }}>
                {n.summary}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function NiftyAnnotatedChart({
  closes,
  turningPoints,
}: {
  closes: Close[]
  turningPoints: TP[]
}) {
  const tpMap = new Map(turningPoints.map(tp => [tp.date, tp]))

  const data = closes
    .filter(c => c.close != null)
    .map(c => ({ date: c.date, close: c.close, tp: tpMap.get(c.date) ?? null }))

  const vals = data.map(d => d.close)
  const minV = Math.min(...vals)
  const maxV = Math.max(...vals)
  const pad  = (maxV - minV) * 0.2
  const domain: [number, number] = [Math.floor(minV - pad), Math.ceil(maxV + pad)]

  const tpDates = turningPoints.map(tp => tp.date)

  return (
    <ResponsiveContainer width="100%" height={148}>
      <AreaChart data={data} margin={{ top: 18, right: 12, bottom: 0, left: 12 }}>
        <defs>
          <linearGradient id="niftyGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#006a61" stopOpacity={0.18} />
            <stop offset="100%" stopColor="#006a61" stopOpacity={0.01} />
          </linearGradient>
        </defs>

        {/* Subtle vertical reference lines at turning points */}
        {tpDates.map(d => (
          <ReferenceLine key={d} x={d} stroke="rgba(11,28,48,0.07)" strokeDasharray="3 3" />
        ))}

        <XAxis
          dataKey="date"
          ticks={tpDates}
          tickFormatter={fmtD}
          tick={{ fontSize: 8, fill: '#9ca3af', fontFamily: 'inherit' }}
          axisLine={false}
          tickLine={false}
          interval={0}
        />
        <YAxis domain={domain} hide />

        <Tooltip
          content={<CustomTooltip />}
          cursor={{ stroke: 'rgba(11,28,48,0.1)', strokeWidth: 1, strokeDasharray: '4 3' }}
        />

        <Area
          type="monotone"
          dataKey="close"
          stroke="#006a61"
          strokeWidth={1.5}
          fill="url(#niftyGrad)"
          dot={<TurningDot />}
          activeDot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
