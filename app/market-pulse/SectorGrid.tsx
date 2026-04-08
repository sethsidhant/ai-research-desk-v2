'use client'

import { useState } from 'react'
import {
  AreaChart, Area, ResponsiveContainer, Tooltip,
  XAxis, ReferenceLine,
} from 'recharts'
import { INDUSTRY_TO_FII_SECTOR } from '@/lib/fiiSectorMap'

type Sector = {
  sector: string
  aum: number | null
  aum_pct: number | null
  fortnight_flow: number | null
  oneyear_flow: number | null
  sparkline_values: string | null
  sparkline_labels: string | null
}

type UserStock = { ticker: string; stock_name: string; industry: string | null }

// Sectors from DB may have HTML-encoded ampersands (e.g. "Oil, Gas &amp; Consumable Fuels")
function decodeSector(s: string) { return s.replace(/&amp;/g, '&') }

function formatCr(val: number | null) {
  if (val == null) return '—'
  const abs = Math.abs(val)
  if (abs >= 100000) return `₹ ${(val / 100000).toFixed(1)}L Cr`
  if (abs >= 1000)   return `₹ ${(val / 1000).toFixed(1)}k Cr`
  return `₹ ${val.toLocaleString('en-IN')} Cr`
}

function Sparkline({ values, labels, sector }: { values: string; labels?: string | null; sector: string }) {
  const uid = `sg-${sector.replace(/[^a-z0-9]/gi, '').slice(0, 12)}`
  const labelArr = labels ? labels.split(',') : []
  const pts = values.split(',').map((v, i) => ({
    i,
    v: parseFloat(v) || 0,
    label: labelArr[i] ?? '',
  }))
  const last = pts[pts.length - 1]?.v ?? 0
  const color = last >= 0 ? '#10b981' : '#ef4444'
  const tickIndices = pts.length <= 6
    ? pts.map((_, i) => i)
    : [0, Math.floor((pts.length - 1) / 2), pts.length - 1]

  return (
    <ResponsiveContainer width="100%" height={72}>
      <AreaChart data={pts} margin={{ top: 4, right: 2, left: 2, bottom: 0 }}>
        <defs>
          <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.25} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="i"
          type="number"
          domain={[0, pts.length - 1]}
          ticks={tickIndices}
          tickFormatter={i => pts[i]?.label ?? ''}
          tick={{ fontSize: 8, fill: '#9ca3af', fontFamily: 'inherit' }}
          axisLine={false}
          tickLine={false}
          interval={0}
        />
        <ReferenceLine y={0} stroke="rgba(156,163,175,0.35)" strokeDasharray="3 2" strokeWidth={1} />
        <Tooltip
          contentStyle={{
            background: '#0f2133',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '6px',
            padding: '4px 8px',
            fontSize: '10px',
            color: '#e5e7eb',
          }}
          itemStyle={{ color }}
          formatter={(val: number) => [`₹ ${val.toLocaleString('en-IN')} Cr`, 'Net flow']}
          labelFormatter={(i: number) => pts[i]?.label ?? ''}
          cursor={{ stroke: 'rgba(255,255,255,0.15)', strokeWidth: 1 }}
        />
        <Area
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#${uid})`}
          dot={false}
          isAnimationActive={false}
          activeDot={{ r: 3, fill: color, stroke: 'white', strokeWidth: 1 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export default function SectorGrid({ sectors, userStocks = [] }: { sectors: Sector[]; userStocks?: UserStock[] }) {
  // Group user stocks by mapped FII sector
  const stocksBySector: Record<string, UserStock[]> = {}
  for (const s of userStocks) {
    const fiiSector = s.industry ? INDUSTRY_TO_FII_SECTOR[s.industry] : null
    if (!fiiSector) continue
    if (!stocksBySector[fiiSector]) stocksBySector[fiiSector] = []
    stocksBySector[fiiSector].push(s)
  }
  const [sortBy, setSortBy] = useState<'fortnight' | 'oneyear' | 'aum'>('fortnight')

  const sorted = [...sectors].sort((a, b) => {
    if (sortBy === 'aum') return (b.aum ?? 0) - (a.aum ?? 0)
    if (sortBy === 'oneyear') return (a.oneyear_flow ?? 0) - (b.oneyear_flow ?? 0)
    return (a.fortnight_flow ?? 0) - (b.fortnight_flow ?? 0)
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold" style={{ color: 'var(--artha-text)' }}>Sector-wise FII Net Flow (₹ Cr)</h2>
        <div className="flex gap-1">
          {(['fortnight', 'oneyear', 'aum'] as const).map(opt => (
            <button
              key={opt}
              onClick={() => setSortBy(opt)}
              className="px-3 py-1 rounded-lg text-xs font-medium transition-colors"
              style={sortBy === opt
                ? { background: '#006a61', color: '#ffffff' }
                : { background: 'var(--artha-card-border)', color: 'var(--artha-text-muted)' }}
            >
              {opt === 'fortnight' ? 'Fortnight' : opt === 'oneyear' ? '1Y Flow' : 'Total AUM'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {sorted.map(s => {
          const fortnightUp  = (s.fortnight_flow ?? 0) >= 0
          const oneyearUp    = (s.oneyear_flow   ?? 0) >= 0
          const sectorName   = decodeSector(s.sector)
          const myStocks     = stocksBySector[sectorName] ?? []
          const hasMyStocks  = myStocks.length > 0
          const anchorId     = 'sector-' + sectorName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
          return (
            <div
              key={s.sector}
              id={anchorId}
              className="artha-card scroll-mt-6"
              style={hasMyStocks ? {
                borderColor: 'rgba(0, 196, 180, 0.3)',
                boxShadow: '0 0 0 1px rgba(0, 196, 180, 0.12)',
              } : undefined}
            >
              <div className="flex justify-between items-start gap-2 mb-1">
                <div>
                  <div className="text-sm font-semibold leading-tight" style={{ color: 'var(--artha-text)' }}>{sectorName}</div>
                  <div className="text-[10px] mt-0.5" style={{ color: 'var(--artha-text-muted)' }}>{s.aum_pct?.toFixed(1)}% of AUM</div>
                </div>
                <div className="text-right shrink-0">
                  <span className={`text-xs font-semibold font-mono ${fortnightUp ? 'text-emerald-500' : 'text-red-400'}`}>
                    {fortnightUp ? '▲' : '▼'} {Math.abs(s.fortnight_flow ?? 0).toLocaleString('en-IN')} Cr
                  </span>
                  <div className="text-[10px] mt-0.5" style={{ color: 'var(--artha-text-muted)' }}>Last fortnight</div>
                </div>
              </div>

              {s.sparkline_values && <Sparkline values={s.sparkline_values} labels={s.sparkline_labels} sector={s.sector} />}

              <div className="text-center mt-1">
                <div className={`text-sm font-semibold font-mono ${oneyearUp ? 'text-emerald-500' : 'text-red-400'}`}>
                  {formatCr(s.oneyear_flow)}
                </div>
                <div className="text-[10px]" style={{ color: 'var(--artha-text-muted)' }}>1Y net flow</div>
              </div>

              {hasMyStocks && (
                <div className="mt-2.5 pt-2.5" style={{ borderTop: '1px solid rgba(0, 196, 180, 0.15)' }}>
                  <div className="text-[9px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: '#4dd9cc' }}>Your stocks</div>
                  <div className="flex flex-wrap gap-1">
                    {myStocks.map(st => (
                      <span key={st.ticker} title={st.stock_name}
                        className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded-md"
                        style={fortnightUp
                          ? { background: 'rgba(16, 185, 129, 0.1)', color: '#34d399', border: '1px solid rgba(16,185,129,0.2)' }
                          : { background: 'rgba(239, 68, 68, 0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }
                        }>
                        {st.ticker}
                      </span>
                    ))}
                  </div>
                  <div className="text-[9px] mt-1.5 leading-tight" style={{ color: 'var(--artha-text-muted)' }}>
                    FII {fortnightUp ? 'buying' : 'selling'} this sector — {fortnightUp ? 'tailwind' : 'headwind'} for your holdings
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
