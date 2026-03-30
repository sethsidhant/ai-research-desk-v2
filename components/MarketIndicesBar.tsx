'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type { GlobalQuote } from '@/app/api/global-markets/route'

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
  idx, flash, large, onClick, active, vix, breadth, stale, accent,
}: {
  idx: IndexQuote; flash: 'up' | 'down' | null; large?: boolean
  onClick?: () => void; active?: boolean; vix?: boolean
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
          background: active ? 'rgba(0,61,155,0.04)' : flashBg || 'var(--artha-card)',
          minWidth: 130,
          cursor: onClick ? 'pointer' : 'default',
        }}
      >
        <div className="flex items-center justify-between gap-1">
          <span className="text-[9px] font-bold uppercase tracking-widest whitespace-nowrap" style={{ color: 'var(--artha-text-faint)' }}>{idx.name}</span>
          {onClick && <span className="text-[9px]" style={{ color: 'var(--artha-text-faint)' }}>⊞</span>}
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
function SectorPill({ idx, flash }: { idx: IndexQuote; flash: 'up' | 'down' | null }) {
  const up = idx.changePct >= 0
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border shrink-0"
      style={{
        borderColor: 'rgba(11,28,48,0.08)',
        background: up ? 'rgba(0,106,97,0.05)' : 'rgba(192,57,43,0.05)',
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
              onClick={
                idx.name === 'NIFTY 50'   && tiles.length     > 0 ? () => setOpenModal(o => o === 'nifty50'   ? null : 'nifty50')   :
                idx.name === 'BANK NIFTY' && bankTiles.length > 0 ? () => setOpenModal(o => o === 'banknifty' ? null : 'banknifty') :
                undefined
              }
              active={(idx.name === 'NIFTY 50' && openModal === 'nifty50') || (idx.name === 'BANK NIFTY' && openModal === 'banknifty')}
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
            <IndexChip key={idx.name} idx={idx} flash={flashes[idx.name] ?? null} />
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

        {/* Row 2: sector pills — 2 rows via flex-wrap */}
        {sectors.length > 0 && (
          <div className="flex flex-wrap gap-1" style={{ maxHeight: 58 }}>
            {sectors.map(idx => (
              <SectorPill key={idx.name} idx={idx} flash={flashes[idx.name] ?? null} />
            ))}
          </div>
        )}
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
