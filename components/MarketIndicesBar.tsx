'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts'
import type { GlobalQuote } from '@/app/api/global-markets/route'

// Kite instrument tokens for Indian index charts — same as GlobalMarketsClient
const KITE_TOKENS: Record<string, number> = {
  'NIFTY 50':    256265,
  'NIFTY 500':   268041,
  'BANK NIFTY':  260105,
  'SENSEX':      265,
  'MIDCAP 100':  256777,
  'SMALLCAP 100':267017,
  'IT':          259849,
  'PHARMA':      262409,
  'AUTO':        263433,
  'FMCG':        261897,
  'METAL':       263689,
}

function calcRSI(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null
  let avgGain = 0, avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d > 0) avgGain += d; else avgLoss += Math.abs(d)
  }
  avgGain /= period; avgLoss /= period
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    avgGain = (avgGain * (period - 1) + Math.max(0, d)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -d)) / period
  }
  if (avgLoss === 0) return 100
  return parseFloat((100 - 100 / (1 + avgGain / avgLoss)).toFixed(1))
}

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function IndexChartPanel({ name, kiteToken, changePct, onClose }: {
  name: string; kiteToken: number; changePct: number; onClose: () => void
}) {
  const [closes, setCloses]   = useState<{ date: string; close: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(false)

  useEffect(() => {
    setLoading(true); setCloses([]); setError(false)
    fetch(`/api/index-chart?token=${kiteToken}`)
      .then(r => r.json())
      .then(d => {
        if (d.closes?.length) setCloses(d.closes)
        else setError(true)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [kiteToken])

  const rsi = calcRSI(closes.map(c => c.close))
  const up  = changePct >= 0
  const color = up ? '#006a61' : '#c0392b'
  const gradId = `db-cg-${kiteToken}`

  const vals = closes.map(c => c.close)
  const min  = Math.min(...vals)
  const max  = Math.max(...vals)
  const pad  = (max - min) * 0.15

  const ticks = closes.length >= 2 ? [
    closes[0].date,
    closes[Math.floor(closes.length / 2)].date,
    closes[closes.length - 1].date,
  ] : []

  return (
    <div className="mt-2 rounded-xl border overflow-hidden"
      style={{ borderColor: 'rgba(11,28,48,0.1)', borderTop: `2px solid ${color}`, background: 'var(--artha-card)' }}>
      <div className="flex items-center justify-between px-4 py-2"
        style={{ borderBottom: '1px solid rgba(11,28,48,0.06)' }}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold" style={{ color: 'var(--artha-text)' }}>{name}</span>
          <span className="text-[11px] font-mono font-bold px-1.5 py-0.5 rounded-full"
            style={{ background: up ? '#e6f4f2' : '#fef2f2', color }}>
            {up ? '+' : ''}{changePct.toFixed(2)}%
          </span>
          <span className="text-[9px] font-mono" style={{ color: 'var(--artha-text-faint)' }}>3M</span>
        </div>
        <button onClick={onClose}
          className="text-xs px-2 py-0.5 rounded"
          style={{ color: 'var(--artha-text-faint)', background: 'var(--artha-surface-low)' }}>✕</button>
      </div>
      <div className="px-4 py-3">
        {loading ? (
          <div className="h-24 rounded animate-pulse" style={{ background: 'var(--artha-surface-low)' }} />
        ) : error || !closes.length ? (
          <div className="h-24 flex items-center justify-center text-xs" style={{ color: 'var(--artha-text-faint)' }}>
            Chart unavailable
          </div>
        ) : (
          <div className="flex gap-4 items-start">
            <div className="flex-1" style={{ height: 96 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={closes} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={color} stopOpacity={0.18} />
                      <stop offset="100%" stopColor={color} stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" ticks={ticks} tickFormatter={fmtDate}
                    tick={{ fontSize: 8, fill: '#9ca3af', fontFamily: 'inherit' }}
                    axisLine={false} tickLine={false} />
                  <YAxis domain={[min - pad, max + pad]} hide />
                  <Tooltip
                    contentStyle={{ background: '#0f2133', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '4px 8px', fontSize: 10, color: '#e5e7eb' }}
                    formatter={(val: any) => [val.toLocaleString('en-IN', { maximumFractionDigits: 2 }), 'Close']}
                    labelFormatter={(l) => fmtDate(String(l))}
                  />
                  <Area type="monotone" dataKey="close" stroke={color} strokeWidth={1.5}
                    fill={`url(#${gradId})`} dot={false} isAnimationActive={false}
                    activeDot={{ r: 3, fill: color, stroke: 'white', strokeWidth: 1.5 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            {rsi != null && (
              <div className="shrink-0 w-24">
                <div className="text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--artha-text-faint)' }}>RSI · 14d</div>
                <div className="flex items-end gap-1 mb-1">
                  <span className="font-display font-bold text-xl leading-none"
                    style={{ color: rsi < 30 ? '#003d9b' : rsi > 70 ? '#b45309' : '#006a61', letterSpacing: '-0.03em' }}>
                    {rsi.toFixed(1)}
                  </span>
                  <span className="text-[9px] mb-0.5 font-semibold"
                    style={{ color: rsi < 30 ? '#003d9b' : rsi > 70 ? '#b45309' : '#006a61' }}>
                    {rsi < 30 ? 'Oversold' : rsi > 70 ? 'Overbought' : 'Neutral'}
                  </span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--artha-surface-low)' }}>
                  <div style={{
                    width: `${rsi}%`, height: '100%', borderRadius: 999,
                    background: rsi < 30 ? '#003d9b' : rsi > 70 ? '#b45309' : '#006a61',
                    transition: 'width 0.4s ease',
                  }} />
                </div>
                <div className="flex justify-between mt-0.5 text-[8px]" style={{ color: 'var(--artha-text-faint)' }}>
                  <span>0</span><span>50</span><span>100</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

type IndexQuote = {
  name:      string
  last:      number
  prevClose: number
  change:    number
  changePct: number
  group:     string
}

type Breadth   = { advances: number; declines: number; unchanged: number; total: number }
type StockTile = { sym: string; changePct: number }

function fmt(n: number) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function vixLabel(vix: number): { text: string; color: string } {
  if (vix < 12) return { text: 'Very Calm', color: '#059669' }
  if (vix < 16) return { text: 'Calm',      color: '#059669' }
  if (vix < 20) return { text: 'Neutral',   color: '#6b7280' }
  if (vix < 25) return { text: 'Cautious',  color: '#d97706' }
  if (vix < 30) return { text: 'Fearful',   color: '#ea580c' }
  return               { text: 'High Fear', color: '#dc2626' }
}

function tileColor(pct: number): string {
  if (pct >= 3)  return 'bg-emerald-700 text-white'
  if (pct >= 2)  return 'bg-emerald-600 text-white'
  if (pct >= 1)  return 'bg-emerald-500 text-white'
  if (pct >= 0)  return 'bg-emerald-200 text-emerald-900'
  if (pct >= -1) return 'bg-red-200 text-red-900'
  if (pct >= -2) return 'bg-red-500 text-white'
  if (pct >= -3) return 'bg-red-600 text-white'
  return               'bg-red-700 text-white'
}

function HeatmapModal({ title, tiles, cols, stale, onClose }: {
  title: string; tiles: StockTile[]; cols: number; stale: boolean; onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-200 p-5 w-full max-w-2xl max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm font-bold text-gray-900">{title} Heatmap</div>
            <div className="text-[10px] text-gray-400 mt-0.5">{stale ? 'Closing snapshot' : 'Live · updates every 15s'} · sorted best → worst</div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 text-sm">✕</button>
        </div>
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {tiles.map(t => (
            <div key={t.sym} className={`flex flex-col items-center justify-center rounded-lg py-2 px-1 ${tileColor(t.changePct)}`}>
              <span className="text-[10px] font-bold leading-tight truncate w-full text-center">{t.sym}</span>
              <span className="text-[9px] font-mono leading-tight mt-0.5 opacity-90">{t.changePct >= 0 ? '+' : ''}{t.changePct.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Single unified index chip — size controlled by `large` prop
function IndexChip({
  idx, flash, large, onClick, onHeatmapClick, active, chartActive, vix, breadth, stale, accent,
}: {
  idx: IndexQuote; flash: 'up' | 'down' | null; large?: boolean
  onClick?: () => void; onHeatmapClick?: () => void; active?: boolean; chartActive?: boolean; vix?: boolean
  breadth?: Breadth | null; stale?: boolean; accent?: boolean
}) {
  const up        = idx.changePct >= 0
  const positive  = 'var(--artha-teal)'
  const negative  = 'var(--artha-negative)'
  const changeColor = up ? positive : negative

  // Flash background
  const flashBg = flash === 'up'   ? 'rgba(0,106,97,0.07)' :
                  flash === 'down' ? 'rgba(192,57,43,0.07)' : 'transparent'

  const borderColor = active ? 'rgba(0,61,155,0.3)' :
                      chartActive ? (up ? 'rgba(0,106,97,0.35)' : 'rgba(192,57,43,0.25)') :
                      accent ? 'rgba(99,102,241,0.2)' :
                      'rgba(11,28,48,0.08)'

  if (vix) {
    const mood = vixLabel(idx.last)
    return (
      <div className="flex flex-col justify-center px-3 py-2 rounded-xl border shrink-0"
        style={{ borderColor, background: flashBg, minWidth: 72 }}>
        <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'var(--artha-text-faint)' }}>VIX</span>
        <span className="text-sm font-bold font-mono leading-tight mt-0.5" style={{ color: 'var(--artha-text)' }}>{idx.last.toFixed(2)}</span>
        <span className="text-[9px] font-semibold mt-0.5" style={{ color: mood.color }}>{mood.text}</span>
      </div>
    )
  }

  if (large) {
    return (
      <div
        onClick={onClick}
        className="flex flex-col justify-between px-3 py-2 rounded-xl border shrink-0"
        style={{
          borderColor: active ? 'rgba(0,61,155,0.35)' : borderColor,
          borderLeftWidth: 2,
          borderLeftColor: up ? 'var(--artha-teal)' : 'var(--artha-negative)',
          background: chartActive ? (up ? 'rgba(0,106,97,0.04)' : 'rgba(192,57,43,0.03)') : active ? 'rgba(0,61,155,0.04)' : flashBg || 'var(--artha-card)',
          minWidth: 130,
          cursor: 'pointer',
        }}
      >
        <div className="flex items-center justify-between gap-1">
          <span className="text-[9px] font-bold uppercase tracking-widest whitespace-nowrap" style={{ color: 'var(--artha-text-faint)' }}>{idx.name}</span>
          {onHeatmapClick && (
            <button
              onClick={e => { e.stopPropagation(); onHeatmapClick() }}
              className="text-[9px] px-1 rounded hover:bg-gray-100"
              style={{ color: 'var(--artha-text-faint)' }}
              title="Heatmap"
            >⊞</button>
          )}
        </div>
        <span className="text-[15px] font-bold font-mono leading-tight mt-1" style={{ color: 'var(--artha-text)' }}>{fmt(idx.last)}</span>
        <span className="text-[10px] font-mono font-semibold mt-0.5" style={{ color: changeColor }}>
          {up ? '▲' : '▼'} {Math.abs(idx.change).toFixed(1)} ({Math.abs(idx.changePct).toFixed(2)}%)
        </span>
        {breadth && breadth.total > 0 && (
          <div className="mt-2">
            <div className="flex h-1 rounded-full overflow-hidden gap-px">
              <div className="rounded-l-full" style={{ width: `${(breadth.advances / breadth.total) * 100}%`, background: 'var(--artha-teal)' }} />
              {breadth.unchanged > 0 && <div style={{ width: `${(breadth.unchanged / breadth.total) * 100}%`, background: '#d1d5db' }} />}
              <div className="rounded-r-full" style={{ width: `${(breadth.declines / breadth.total) * 100}%`, background: 'var(--artha-negative)' }} />
            </div>
            <div className="flex justify-between mt-0.5">
              <span className="text-[9px] font-bold" style={{ color: 'var(--artha-teal)' }}>{breadth.advances}</span>
              <span className="text-[9px] font-bold" style={{ color: 'var(--artha-negative)' }}>{breadth.declines}</span>
            </div>
          </div>
        )}
      </div>
    )
  }

  // Small chip
  return (
    <div className="flex flex-col justify-center px-2.5 py-2 rounded-xl border shrink-0"
      style={{ borderColor, background: flashBg || 'var(--artha-card)', minWidth: 80 }}>
      <span className="text-[9px] font-bold uppercase tracking-wider whitespace-nowrap"
        style={{ color: accent ? 'rgba(99,102,241,0.7)' : 'var(--artha-text-faint)' }}>{idx.name}</span>
      <span className="text-[12px] font-bold font-mono leading-tight mt-0.5" style={{ color: 'var(--artha-text)' }}>{fmt(idx.last)}</span>
      <span className="text-[9px] font-mono font-semibold mt-0.5" style={{ color: changeColor }}>
        {up ? '▲' : '▼'}{Math.abs(idx.changePct).toFixed(2)}%
      </span>
    </div>
  )
}

// Sector pill — very compact inline chip
function SectorPill({ idx, flash, selected }: { idx: IndexQuote; flash: 'up' | 'down' | null; selected?: boolean }) {
  const up = idx.changePct >= 0
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border shrink-0"
      style={{
        borderColor: selected ? (up ? 'rgba(0,106,97,0.4)' : 'rgba(192,57,43,0.35)') : 'rgba(11,28,48,0.08)',
        background: up ? 'rgba(0,106,97,0.05)' : 'rgba(192,57,43,0.05)',
        outline: selected ? `1.5px solid ${up ? 'rgba(0,106,97,0.3)' : 'rgba(192,57,43,0.25)'}` : 'none',
      }}>
      <span className="text-[9px] font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: 'var(--artha-text-faint)' }}>{idx.name}</span>
      <span className="text-[10px] font-mono font-bold" style={{ color: up ? 'var(--artha-teal)' : 'var(--artha-negative)' }}>
        {up ? '▲' : '▼'}{Math.abs(idx.changePct).toFixed(2)}%
      </span>
    </div>
  )
}

function fmtGlobal(price: number, currency: string, symbol: string): string {
  if (symbol === 'USDINR=X') return `₹${price.toFixed(2)}`
  if (currency === 'INR')    return `₹${price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
  if (symbol === 'DX-Y.NYB') return price.toFixed(2)
  if (['GC=F', 'SI=F'].includes(symbol)) return `$${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
  if (['CL=F', 'BZ=F'].includes(symbol)) return `$${price.toFixed(2)}`
  if (price > 10000) return price.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (price > 1000)  return price.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return price.toFixed(2)
}

function GlobalMarketsModal({ onClose }: { onClose: () => void }) {
  const [quotes, setQuotes] = useState<GlobalQuote[]>([])
  const [loading, setLoading] = useState(true)
  const [lastTs, setLastTs] = useState<number | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res  = await fetch('/api/global-markets')
      if (!res.ok) return
      const json = await res.json()
      setQuotes(json.quotes ?? [])
      setLastTs(json.ts ?? Date.now())
    } catch { /* silent */ } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const id = setInterval(fetchData, 60000)
    return () => clearInterval(id)
  }, [fetchData])

  const currency    = quotes.filter(q => q.group === 'currency')
  const indices     = quotes.filter(q => q.group === 'indices')
  const commodities = quotes.filter(q => q.group === 'commodities')

  function GlobalQuoteRow({ q }: { q: GlobalQuote }) {
    const up   = q.changePct >= 0
    const zero = q.change === 0
    const color = zero ? '#9ca3af' : up ? 'var(--artha-teal)' : 'var(--artha-negative)'
    return (
      <div className="flex items-center justify-between py-2 border-b last:border-0" style={{ borderColor: 'rgba(11,28,48,0.06)' }}>
        <div className="flex items-center gap-2 min-w-0">
          {q.flag && <span className="text-sm leading-none shrink-0">{q.flag}</span>}
          <span className="text-xs font-medium truncate" style={{ color: 'var(--artha-text)' }}>{q.name}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-2">
          <span className="text-xs font-bold font-mono" style={{ color: 'var(--artha-text)' }}>
            {fmtGlobal(q.price, q.currency, q.symbol)}
          </span>
          <span className="text-[11px] font-bold font-mono w-14 text-right" style={{ color }}>
            {zero ? '—' : `${up ? '+' : ''}${q.changePct.toFixed(2)}%`}
          </span>
        </div>
      </div>
    )
  }

  function SectionGroup({ title, icon, items }: { title: string; icon: string; items: GlobalQuote[] }) {
    if (!items.length) return null
    return (
      <div>
        <div className="text-[10px] font-bold uppercase tracking-widest mb-1 flex items-center gap-1.5" style={{ color: 'var(--artha-text-faint)' }}>
          <span>{icon}</span>{title}
        </div>
        {items.map(q => <GlobalQuoteRow key={q.symbol} q={q} />)}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end p-4 pt-16" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
      <div
        className="relative rounded-2xl shadow-2xl border overflow-hidden"
        style={{
          width: 320,
          maxHeight: 'calc(100vh - 80px)',
          background: 'var(--artha-card)',
          borderColor: 'rgba(11,28,48,0.1)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'rgba(11,28,48,0.08)' }}>
          <div>
            <div className="text-sm font-bold" style={{ color: 'var(--artha-text)' }}>Global Markets</div>
            {lastTs && (
              <div className="text-[10px] mt-0.5 flex items-center gap-1" style={{ color: 'var(--artha-text-faint)' }}>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Refreshes every 60s
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center text-sm transition-colors hover:bg-gray-100"
            style={{ color: 'var(--artha-text-muted)' }}
          >✕</button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-4 py-3 space-y-4" style={{ maxHeight: 'calc(100vh - 160px)' }}>
          {loading ? (
            <div className="space-y-2">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="h-8 rounded animate-pulse" style={{ background: 'var(--artha-surface-low)' }} />
              ))}
            </div>
          ) : (
            <>
              <SectionGroup title="Currency & FX"  icon="💱" items={currency} />
              <SectionGroup title="Global Indices"  icon="🌐" items={indices} />
              <SectionGroup title="Commodities"     icon="⚡" items={commodities} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function MarketIndicesBar() {
  const [indices, setIndices]         = useState<IndexQuote[]>([])
  const [breadth, setBreadth]         = useState<Breadth | null>(null)
  const [tiles, setTiles]             = useState<StockTile[]>([])
  const [bankBreadth, setBankBreadth] = useState<Breadth | null>(null)
  const [bankTiles, setBankTiles]     = useState<StockTile[]>([])
  const [stale, setStale]             = useState(false)
  const [openModal, setOpenModal]     = useState<'nifty50' | 'banknifty' | 'global' | null>(null)
  const [selectedChart, setSelectedChart] = useState<string | null>(null)
  const [loading, setLoading]         = useState(true)
  const prevRef                       = useRef<Record<string, number>>({})
  const [flashes, setFlashes]         = useState<Record<string, 'up' | 'down' | null>>({})

  async function fetchIndices() {
    try {
      const res  = await fetch('/api/market-indices')
      const json = await res.json()
      if (!json.indices?.length) return
      const newFlashes: Record<string, 'up' | 'down' | null> = {}
      for (const idx of json.indices) {
        const prev = prevRef.current[idx.name]
        if (prev !== undefined && prev !== idx.last)
          newFlashes[idx.name] = idx.last > prev ? 'up' : 'down'
        prevRef.current[idx.name] = idx.last
      }
      setIndices(json.indices)
      if (json.breadth)     setBreadth(json.breadth)
      if (json.tiles)       setTiles(json.tiles)
      if (json.bankBreadth) setBankBreadth(json.bankBreadth)
      if (json.bankTiles)   setBankTiles(json.bankTiles)
      setStale(!!json.stale)
      if (Object.keys(newFlashes).length > 0) {
        setFlashes(newFlashes)
        setTimeout(() => setFlashes({}), 1000)
      }
    } catch { /* silent */ } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchIndices()
    const id = setInterval(fetchIndices, 15000)
    return () => clearInterval(id)
  }, [])

  if (loading) {
    return (
      <div className="flex items-center gap-2">
        {[130, 130, 80, 80, 80, 80, 80, 72].map((w, i) => (
          <div key={i} className="rounded-xl border border-gray-100 bg-gray-50 animate-pulse shrink-0"
            style={{ width: w, height: i < 2 ? 82 : 58 }} />
        ))}
      </div>
    )
  }

  if (indices.length === 0) {
    return (
      <div className="flex items-center gap-2 py-1">
        <span className="text-xs px-3 py-1.5 rounded-lg border" style={{ color: 'var(--artha-text-muted)', borderColor: 'rgba(11,28,48,0.08)', background: 'var(--artha-surface-low)' }}>
          Indices unavailable
        </span>
      </div>
    )
  }

  const primary   = indices.filter(i => i.name === 'NIFTY 50' || i.name === 'BANK NIFTY')
  const gift      = indices.filter(i => i.group === 'gift')
  const secondary = indices.filter(i => i.group === 'broad' && i.name !== 'NIFTY 50' && i.name !== 'BANK NIFTY')
  const vixIdx    = indices.find(i => i.group === 'vix') ?? null
  const sectors   = indices.filter(i => i.group === 'sector')

  return (
    <>
      <div className="flex flex-col gap-1.5">
        {/* Row 1: main indices */}
        <div className="flex items-stretch gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>

          {/* NIFTY 50 + BANK NIFTY */}
          {primary.map(idx => (
            <IndexChip
              key={idx.name} idx={idx} large
              flash={flashes[idx.name] ?? null}
              breadth={idx.name === 'NIFTY 50' ? breadth : bankBreadth}
              stale={stale}
              onClick={() => setSelectedChart(c => c === idx.name ? null : idx.name)}
              onHeatmapClick={
                idx.name === 'NIFTY 50'   && tiles.length     > 0 ? () => setOpenModal(o => o === 'nifty50'   ? null : 'nifty50')   :
                idx.name === 'BANK NIFTY' && bankTiles.length > 0 ? () => setOpenModal(o => o === 'banknifty' ? null : 'banknifty') :
                undefined
              }
              active={(idx.name === 'NIFTY 50' && openModal === 'nifty50') || (idx.name === 'BANK NIFTY' && openModal === 'banknifty')}
              chartActive={selectedChart === idx.name}
            />
          ))}

          {/* Divider */}
          <div className="w-px shrink-0 self-stretch rounded-full" style={{ background: 'rgba(11,28,48,0.08)', margin: '2px 0' }} />

          {/* GIFT NIFTY */}
          {gift.map(idx => (
            <IndexChip key={idx.name} idx={idx} flash={flashes[idx.name] ?? null} accent />
          ))}

          {/* SENSEX, NIFTY 500, MIDCAP, SMALLCAP */}
          {secondary.map(idx => (
            <IndexChip key={idx.name} idx={idx} flash={flashes[idx.name] ?? null}
              onClick={KITE_TOKENS[idx.name] ? () => setSelectedChart(c => c === idx.name ? null : idx.name) : undefined}
              chartActive={selectedChart === idx.name}
            />
          ))}

          {/* VIX */}
          {vixIdx && <IndexChip idx={vixIdx} flash={flashes[vixIdx.name] ?? null} vix />}

          {stale && (
            <span className="self-center shrink-0 text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-full"
              style={{ background: 'rgba(11,28,48,0.06)', color: 'var(--artha-text-muted)' }}>
              Closed
            </span>
          )}

          {/* Globe button — global markets modal */}
          <button
            onClick={() => setOpenModal(o => o === 'global' ? null : 'global')}
            className="self-center shrink-0 flex flex-col items-center justify-center rounded-xl border transition-colors px-2 py-2 hover:bg-gray-50"
            title="Global Markets"
            style={{
              borderColor: openModal === 'global' ? 'rgba(99,102,241,0.4)' : 'rgba(11,28,48,0.08)',
              background: openModal === 'global' ? 'rgba(99,102,241,0.06)' : 'var(--artha-card)',
              minWidth: 40, height: 40,
              color: openModal === 'global' ? 'rgba(99,102,241,0.8)' : 'var(--artha-text-faint)',
            }}
          >
            <span className="text-base leading-none">🌐</span>
            <span className="text-[8px] font-bold uppercase tracking-wider mt-0.5" style={{ color: 'inherit' }}>Global</span>
          </button>
        </div>

        {/* Row 2: sector pills — clickable for chart */}
        {sectors.length > 0 && (
          <div className="flex flex-wrap gap-1" style={{ maxHeight: 58 }}>
            {sectors.map(idx => (
              <button key={idx.name}
                onClick={() => setSelectedChart(c => c === idx.name ? null : idx.name)}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                <SectorPill idx={idx} flash={flashes[idx.name] ?? null} selected={selectedChart === idx.name} />
              </button>
            ))}
          </div>
        )}

        {/* Index chart panel */}
        {selectedChart && KITE_TOKENS[selectedChart] && (() => {
          const idx = indices.find(i => i.name === selectedChart)
          if (!idx) return null
          return (
            <IndexChartPanel
              name={idx.name}
              kiteToken={KITE_TOKENS[idx.name]}
              changePct={idx.changePct}
              onClose={() => setSelectedChart(null)}
            />
          )
        })()}
      </div>

      {openModal === 'nifty50' && tiles.length > 0 && (
        <HeatmapModal title="Nifty 50" tiles={tiles} cols={10} stale={stale} onClose={() => setOpenModal(null)} />
      )}
      {openModal === 'banknifty' && bankTiles.length > 0 && (
        <HeatmapModal title="Bank Nifty" tiles={bankTiles} cols={6} stale={stale} onClose={() => setOpenModal(null)} />
      )}
      {openModal === 'global' && (
        <GlobalMarketsModal onClose={() => setOpenModal(null)} />
      )}
    </>
  )
}
