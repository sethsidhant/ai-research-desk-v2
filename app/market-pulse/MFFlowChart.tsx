'use client'

import { useState, useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, AreaChart, Area } from 'recharts'

type Row = { date: string; eq_net: number | null; dbt_net: number | null }

function formatCr(val: number) {
  const abs = Math.abs(val)
  if (abs >= 1000) return `${(val / 1000).toFixed(1)}k`
  return `${val.toFixed(0)}`
}

function exactCr(val: number) {
  return `${val >= 0 ? '+' : ''}₹${Math.round(val).toLocaleString('en-IN')} Cr`
}

const PERIODS = [
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '1Y', days: 365 },
]

export default function MFFlowChart({ data }: { data: Row[] }) {
  const [period, setPeriod]   = useState('3M')
  const [view,   setView]     = useState<'daily' | 'cumulative'>('daily')

  const filtered = useMemo(() => {
    const days   = PERIODS.find(p => p.label === period)?.days ?? 90
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    return data
      .filter(r => r.eq_net != null && new Date(r.date) >= cutoff)
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [data, period])

  const chartData = useMemo(() => {
    if (view === 'daily') {
      return filtered.map(r => ({
        date:    r.date,
        Equity:  Math.round(r.eq_net ?? 0),
        Debt:    Math.round(r.dbt_net ?? 0),
      }))
    }
    // Cumulative
    let cumEq = 0, cumDbt = 0
    return filtered.map(r => {
      cumEq  += r.eq_net  ?? 0
      cumDbt += r.dbt_net ?? 0
      return { date: r.date, Equity: Math.round(cumEq), Debt: Math.round(cumDbt) }
    })
  }, [filtered, view])

  const latestEq  = chartData[chartData.length - 1]?.Equity  ?? 0
  const latestDbt = chartData[chartData.length - 1]?.Debt    ?? 0

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h2 className="text-base font-semibold text-gray-900">MF Flow · SEBI (₹ Cr)</h2>
          <div className="flex items-center gap-3 mt-0.5">
            <span className={`text-sm font-mono font-semibold ${latestEq >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              Eq {exactCr(latestEq)}
            </span>
            <span className={`text-sm font-mono font-semibold ${latestDbt >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              Dbt {exactCr(latestDbt)}
            </span>
            <span className="text-xs text-gray-400">{view === 'cumulative' ? period + ' cumulative' : 'daily'}</span>
          </div>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
            {(['daily', 'cumulative'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${view === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                {v === 'daily' ? 'Daily' : 'Cumulative'}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            {PERIODS.map(p => (
              <button key={p.label} onClick={() => setPeriod(p.label)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${period === p.label ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={240}>
        {view === 'daily' ? (
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barGap={2}>
            <XAxis dataKey="date"
              tickFormatter={d => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
              tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false}
              interval={Math.floor(chartData.length / 8)}
            />
            <YAxis tickFormatter={v => formatCr(v)} tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={55} />
            <Tooltip content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              return (
                <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 shadow text-xs space-y-1">
                  <p className="text-gray-500">{label ? new Date(label).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }) : ''}</p>
                  {payload.map(p => (
                    <p key={p.name} className="font-mono font-semibold" style={{ color: p.color }}>
                      {p.name}: {exactCr(p.value as number)}
                    </p>
                  ))}
                </div>
              )
            }} />
            <ReferenceLine y={0} stroke="#d1d5db" />
            <Bar dataKey="Equity" fill="#8b5cf6" radius={[2, 2, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="Debt"   fill="#f59e0b" radius={[2, 2, 0, 0]} isAnimationActive={false} />
          </BarChart>
        ) : (
          <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <XAxis dataKey="date"
              tickFormatter={d => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
              tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false}
              interval={Math.floor(chartData.length / 8)}
            />
            <YAxis tickFormatter={v => formatCr(v)} tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={55} />
            <Tooltip content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              return (
                <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 shadow text-xs space-y-1">
                  <p className="text-gray-500">{label ? new Date(label).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }) : ''}</p>
                  {payload.map(p => (
                    <p key={p.name} className="font-mono font-semibold" style={{ color: p.color }}>
                      {p.name}: {exactCr(p.value as number)}
                    </p>
                  ))}
                </div>
              )
            }} />
            <ReferenceLine y={0} stroke="#d1d5db" strokeDasharray="3 3" />
            <Area dataKey="Equity" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.1} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Area dataKey="Debt"   stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.1} strokeWidth={2} dot={false} isAnimationActive={false} />
          </AreaChart>
        )}
      </ResponsiveContainer>

      <div className="flex items-center gap-4 mt-2">
        <span className="flex items-center gap-1.5 text-[11px] text-gray-500">
          <span className="w-2.5 h-2.5 rounded-sm bg-violet-500 inline-block" /> Equity
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-gray-500">
          <span className="w-2.5 h-2.5 rounded-sm bg-amber-400 inline-block" /> Debt
        </span>
        <span className="text-[10px] text-gray-400 ml-auto">Source: SEBI · 3-5 day lag</span>
      </div>
    </div>
  )
}
