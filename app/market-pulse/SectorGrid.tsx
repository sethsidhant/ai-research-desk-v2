'use client'

import { useState } from 'react'
import { AreaChart, Area, ResponsiveContainer } from 'recharts'
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

function Sparkline({ values }: { values: string }) {
  const pts = values.split(',').map((v, i) => ({ i, v: parseFloat(v) || 0 }))
  const last = pts[pts.length - 1]?.v ?? 0
  const color = last >= 0 ? '#10b981' : '#ef4444'
  return (
    <ResponsiveContainer width="100%" height={48}>
      <AreaChart data={pts} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`sg-${last}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.2} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#sg-${last})`} dot={false} isAnimationActive={false} />
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
        <h2 className="text-base font-semibold text-gray-900">Sector-wise FII Net Flow (₹ Cr)</h2>
        <div className="flex gap-1">
          {(['fortnight', 'oneyear', 'aum'] as const).map(opt => (
            <button
              key={opt}
              onClick={() => setSortBy(opt)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                sortBy === opt ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {opt === 'fortnight' ? 'Fortnight' : opt === 'oneyear' ? '1Y Flow' : 'Total AUM'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {sorted.map(s => {
          const fortnightUp  = (s.fortnight_flow ?? 0) >= 0
          const oneyearUp    = (s.oneyear_flow   ?? 0) >= 0
          const sectorName   = decodeSector(s.sector)
          const myStocks     = stocksBySector[sectorName] ?? []
          const hasMyStocks  = myStocks.length > 0
          const anchorId     = 'sector-' + sectorName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
          return (
            <div key={s.sector} id={anchorId} className={`bg-white border rounded-xl p-4 shadow-sm scroll-mt-6 ${hasMyStocks ? 'border-blue-200 ring-1 ring-blue-100' : 'border-gray-200'}`}>
              <div className="flex justify-between items-start gap-2 mb-1">
                <div>
                  <div className="text-sm font-semibold text-gray-900 leading-tight">{sectorName}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{s.aum_pct?.toFixed(1)}% of AUM</div>
                </div>
                <div className="text-right shrink-0">
                  <span className={`text-xs font-semibold font-mono ${fortnightUp ? 'text-emerald-600' : 'text-red-600'}`}>
                    {fortnightUp ? '▲' : '▼'} {Math.abs(s.fortnight_flow ?? 0).toLocaleString('en-IN')} Cr
                  </span>
                  <div className="text-[10px] text-gray-400 mt-0.5">Last fortnight</div>
                </div>
              </div>

              {s.sparkline_values && <Sparkline values={s.sparkline_values} />}

              <div className="text-center mt-1">
                <div className={`text-sm font-semibold font-mono ${oneyearUp ? 'text-emerald-600' : 'text-red-600'}`}>
                  {formatCr(s.oneyear_flow)}
                </div>
                <div className="text-[10px] text-gray-400">1Y net flow</div>
              </div>

              {hasMyStocks && (
                <div className="mt-2.5 pt-2.5 border-t border-blue-100">
                  <div className="text-[9px] font-semibold uppercase tracking-wide text-blue-400 mb-1.5">Your stocks</div>
                  <div className="flex flex-wrap gap-1">
                    {myStocks.map(st => (
                      <span key={st.ticker} title={st.stock_name}
                        className={`text-[10px] font-mono font-medium px-1.5 py-0.5 rounded-md ${
                          fortnightUp
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-red-50 text-red-700 border border-red-200'
                        }`}>
                        {st.ticker}
                      </span>
                    ))}
                  </div>
                  <div className="text-[9px] text-gray-400 mt-1.5 leading-tight">
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
