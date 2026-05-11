'use client'

import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, Legend,
} from 'recharts'

type Round = {
  date:            string
  round_no:        number | null
  csi:             number
  fei:             number
  cs_general_econ: number | null
  cs_employment:   number | null
  cs_income:       number | null
  cs_spending:     number | null
}

function fmt(v: number | null) { return v == null ? '—' : v.toFixed(1) }

function delta(curr: number, prev: number | undefined) {
  if (prev == null) return null
  return curr - prev
}

function DeltaBadge({ d }: { d: number | null }) {
  if (d == null) return null
  const pos = d >= 0
  return (
    <span className="text-xs font-medium ml-1" style={{ color: pos ? '#10b981' : '#ef4444' }}>
      {pos ? '+' : ''}{d.toFixed(1)}
    </span>
  )
}

function IndexZone({ value }: { value: number }) {
  if (value >= 120) return <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">Very Optimistic</span>
  if (value >= 110) return <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Optimistic</span>
  if (value >= 100) return <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-medium">Mildly Optimistic</span>
  if (value >= 90)  return <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium">Cautious</span>
  return <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-medium">Pessimistic</span>
}

function interpretation(fei: number, csi: number) {
  const gap = fei - csi
  if (fei >= 120 && csi >= 100) return { text: 'Consumers bullish on both present and future. Strong demand tailwind for FMCG, auto, consumer discretionary.', color: '#10b981' }
  if (fei >= 110 && gap >= 20) return { text: 'Future expectations well above current situation — consumers expect improvement. Positive for discretionary, retail, auto.', color: '#059669' }
  if (fei < 100) return { text: 'Future expectations below neutral. Demand headwinds likely for consumer discretionary; FMCG staples relatively resilient.', color: '#ef4444' }
  if (csi < 90)  return { text: 'Consumers perceive current conditions as poor. Watch for near-term volume pressure in FMCG and consumer-facing sectors.', color: '#f97316' }
  return { text: 'Mixed signals. Consumers cautiously optimistic. Staples likely steady; discretionary depends on income trajectory.', color: '#6366f1' }
}

const SECTOR_MAP = [
  { label: 'FMCG', note: 'CSI-sensitive — current income & spending sub-indices drive near-term volume', icon: '🧴' },
  { label: 'Consumer Discretionary', note: 'FEI-sensitive — durables/aspirational buys tied to future income confidence', icon: '🛍️' },
  { label: 'Auto', note: 'FEI + employment sub-index — 2W closely tracks income expectations', icon: '🚗' },
  { label: 'Retail / QSR', note: 'CSI-driven — footfall and ticket size track current situation', icon: '🏪' },
  { label: 'BFSI (Retail credit)', note: 'FEI-driven — personal loan / credit card demand tracks future optimism', icon: '🏦' },
]

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="artha-card p-3 text-xs shadow-lg" style={{ minWidth: 160 }}>
      <p className="font-semibold mb-1" style={{ color: 'var(--artha-text)' }}>{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: <span className="font-semibold">{p.value?.toFixed(1)}</span>
        </p>
      ))}
      <p className="mt-1" style={{ color: 'var(--artha-text-muted)' }}>100 = neutral</p>
    </div>
  )
}

export default function ConsumerSentimentPanel({ data }: { data: Round[] }) {
  if (data.length === 0) {
    return (
      <div className="artha-card p-8 text-center text-sm" style={{ color: 'var(--artha-text-muted)' }}>
        No consumer confidence data yet — run{' '}
        <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">node rbiConsumerAgent.js backfill</code> to populate.
      </div>
    )
  }

  const sorted  = [...data].sort((a, b) => a.date.localeCompare(b.date))
  const latest  = sorted[sorted.length - 1]
  const prev    = sorted[sorted.length - 2]
  const dCsi    = delta(latest.csi, prev?.csi)
  const dFei    = delta(latest.fei, prev?.fei)
  const interp  = interpretation(latest.fei, latest.csi)

  const chartData = sorted.map(r => ({
    label: new Date(r.date + 'T00:00:00Z').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
    CSI: r.csi,
    FEI: r.fei,
  }))

  const roundLabel = latest.round_no ? `Round ${latest.round_no}` : ''
  const surveyDate = new Date(latest.date + 'T00:00:00Z').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

  return (
    <div className="space-y-4">

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="artha-card p-4">
          <p className="text-xs font-medium" style={{ color: 'var(--artha-text-muted)' }}>Current Situation (CSI)</p>
          <p className="text-2xl font-bold font-display mt-1" style={{ color: latest.csi >= 100 ? '#10b981' : '#ef4444', letterSpacing: '-0.02em' }}>
            {fmt(latest.csi)}<DeltaBadge d={dCsi} />
          </p>
          <div className="mt-1"><IndexZone value={latest.csi} /></div>
        </div>
        <div className="artha-card p-4">
          <p className="text-xs font-medium" style={{ color: 'var(--artha-text-muted)' }}>Future Expectations (FEI)</p>
          <p className="text-2xl font-bold font-display mt-1" style={{ color: latest.fei >= 100 ? '#10b981' : '#ef4444', letterSpacing: '-0.02em' }}>
            {fmt(latest.fei)}<DeltaBadge d={dFei} />
          </p>
          <div className="mt-1"><IndexZone value={latest.fei} /></div>
        </div>
        <div className="artha-card p-4">
          <p className="text-xs font-medium" style={{ color: 'var(--artha-text-muted)' }}>CSI vs FEI Gap</p>
          <p className="text-2xl font-bold font-display mt-1" style={{ color: '#6366f1', letterSpacing: '-0.02em' }}>
            +{(latest.fei - latest.csi).toFixed(1)}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--artha-text-muted)' }}>future − current</p>
        </div>
        <div className="artha-card p-4">
          <p className="text-xs font-medium" style={{ color: 'var(--artha-text-muted)' }}>Survey Round</p>
          <p className="text-base font-bold font-display mt-1" style={{ color: 'var(--artha-text)', letterSpacing: '-0.02em' }}>{surveyDate}</p>
          <p className="text-xs mt-1" style={{ color: 'var(--artha-text-muted)' }}>{roundLabel} · RBI bi-monthly</p>
        </div>
      </div>

      {/* Interpretation */}
      <div className="artha-card px-4 py-3 flex items-start gap-2 border-l-4" style={{ borderLeftColor: interp.color }}>
        <span className="text-base">💡</span>
        <p className="text-sm" style={{ color: 'var(--artha-text)' }}>{interp.text}</p>
      </div>

      {/* Chart */}
      <div className="artha-card p-5">
        <div className="mb-3">
          <h2 className="text-base font-semibold" style={{ color: 'var(--artha-text)' }}>Consumer Confidence Trend</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--artha-text-muted)' }}>
            Source: RBI Consumer Confidence Survey · bi-monthly · 100 = neutral threshold
          </p>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} />
            <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11, fill: '#9ca3af' }} width={36} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <ReferenceLine y={100} stroke="#d1d5db" strokeDasharray="4 4" label={{ value: '100', fontSize: 10, fill: '#9ca3af', position: 'insideTopRight' }} />
            <Line type="monotone" dataKey="CSI" name="CSI (current)" stroke="#ef4444" strokeWidth={2} dot={{ r: 4, fill: '#ef4444' }} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="FEI" name="FEI (future)" stroke="#10b981" strokeWidth={2} dot={{ r: 4, fill: '#10b981' }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Sub-indices */}
      {(latest.cs_general_econ || latest.cs_employment || latest.cs_income || latest.cs_spending) && (
        <div className="artha-card p-5">
          <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--artha-text)' }}>Current Situation Sub-Indices</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'General Economy', v: latest.cs_general_econ },
              { label: 'Employment',      v: latest.cs_employment },
              { label: 'Income',          v: latest.cs_income },
              { label: 'Spending',        v: latest.cs_spending },
            ].filter(x => x.v != null).map(x => (
              <div key={x.label}>
                <p className="text-xs" style={{ color: 'var(--artha-text-muted)' }}>{x.label}</p>
                <p className="text-lg font-bold font-display" style={{ color: (x.v ?? 0) >= 100 ? '#10b981' : '#ef4444', letterSpacing: '-0.02em' }}>
                  {fmt(x.v)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sector correlation */}
      <div className="artha-card p-5">
        <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--artha-text)' }}>Sector Correlation Guide</h2>
        <div className="space-y-2">
          {SECTOR_MAP.map(s => (
            <div key={s.label} className="flex items-start gap-2">
              <span className="text-base shrink-0">{s.icon}</span>
              <div>
                <span className="text-xs font-semibold" style={{ color: 'var(--artha-text)' }}>{s.label}</span>
                <span className="text-xs ml-1.5" style={{ color: 'var(--artha-text-muted)' }}>{s.note}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs mt-3 pt-3 border-t border-gray-100" style={{ color: 'var(--artha-text-muted)' }}>
          CSI drives near-term demand (staples). FEI drives big-ticket & aspirational purchases (discretionary). Both are scored above/below 100 neutral.
        </p>
      </div>

    </div>
  )
}
