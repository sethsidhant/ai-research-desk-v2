'use client'

import { useEffect, useRef, useState } from 'react'

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

function vixLabel(vix: number): { text: string; color: string; bg: string } {
  if (vix < 12) return { text: 'Extremely Calm',  color: 'text-emerald-700', bg: 'bg-emerald-50' }
  if (vix < 16) return { text: 'Calm',             color: 'text-emerald-600', bg: 'bg-emerald-50' }
  if (vix < 20) return { text: 'Neutral',          color: 'text-gray-500',    bg: 'bg-gray-50'    }
  if (vix < 25) return { text: 'Cautious',         color: 'text-amber-600',   bg: 'bg-amber-50'   }
  if (vix < 30) return { text: 'Fearful',          color: 'text-orange-600',  bg: 'bg-orange-50'  }
  if (vix < 40) return { text: 'High Fear',        color: 'text-red-600',     bg: 'bg-red-50'     }
  return               { text: 'Extreme Fear',     color: 'text-red-700',     bg: 'bg-red-100'    }
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

function BreadthBar({ breadth, stale }: { breadth: Breadth; stale?: boolean }) {
  const { advances, declines, unchanged, total } = breadth
  if (total === 0) return null
  const advPct  = (advances  / total) * 100
  const decPct  = (declines  / total) * 100
  const unchPct = (unchanged / total) * 100
  return (
    <div className="mt-1.5">
      {stale && <div className="text-[8px] font-semibold text-gray-400 uppercase tracking-wide mb-1">At close</div>}
      <div className="flex h-1 rounded-full overflow-hidden gap-[1px]">
        <div className="bg-emerald-400 rounded-l-full transition-all duration-500" style={{ width: `${advPct}%` }} />
        {unchPct > 0 && <div className="bg-gray-300 transition-all duration-500" style={{ width: `${unchPct}%` }} />}
        <div className="bg-red-400 rounded-r-full transition-all duration-500" style={{ width: `${decPct}%` }} />
      </div>
      <div className="flex justify-between items-center mt-1">
        <span className="text-[9px] font-bold text-emerald-600 flex items-center gap-0.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />{advances}
        </span>
        {unchanged > 0 && (
          <span className="text-[9px] text-gray-400 flex items-center gap-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-300 inline-block" />{unchanged}
          </span>
        )}
        <span className="text-[9px] font-bold text-red-500 flex items-center gap-0.5">
          {declines}<span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />
        </span>
      </div>
    </div>
  )
}

function HeatmapModal({
  title, tiles, cols, stale, onClose,
}: {
  title:   string
  tiles:   StockTile[]
  cols:    number
  stale:   boolean
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      {/* Modal */}
      <div
        className="relative bg-white rounded-2xl shadow-2xl border border-gray-200 p-5 w-full max-w-2xl max-h-[80vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm font-bold text-gray-900">{title} Heatmap</div>
            <div className="text-[10px] text-gray-400 mt-0.5">
              {stale ? 'Closing snapshot' : 'Live · updates every 15s'} · sorted best → worst
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 text-sm transition-colors"
          >✕</button>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-4">
          {[
            { color: 'bg-emerald-700', label: '≥+3%' },
            { color: 'bg-emerald-500', label: '+1–3%' },
            { color: 'bg-emerald-200', label: '0–1%' },
            { color: 'bg-red-200',     label: '0–1%' },
            { color: 'bg-red-500',     label: '-1–3%' },
            { color: 'bg-red-700',     label: '≤-3%' },
          ].map(l => (
            <span key={l.label} className="flex items-center gap-1 text-[9px] text-gray-500">
              <span className={`w-2.5 h-2.5 rounded-sm inline-block ${l.color}`} />{l.label}
            </span>
          ))}
        </div>

        {/* Grid */}
        <div className={`grid gap-1`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {tiles.map(t => (
            <div
              key={t.sym}
              className={`flex flex-col items-center justify-center rounded-lg py-2 px-1 ${tileColor(t.changePct)}`}
              title={`${t.sym}: ${t.changePct >= 0 ? '+' : ''}${t.changePct.toFixed(2)}%`}
            >
              <span className="text-[10px] font-bold leading-tight truncate w-full text-center">{t.sym}</span>
              <span className="text-[9px] font-mono leading-tight mt-0.5 opacity-90">
                {t.changePct >= 0 ? '+' : ''}{t.changePct.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function BroadCard({
  idx, flash, breadth, stale, onClick, active,
}: {
  idx:      IndexQuote
  flash:    'up' | 'down' | null
  breadth?: Breadth | null
  stale?:   boolean
  onClick?: () => void
  active?:  boolean
}) {
  const up          = idx.change >= 0
  const bgFlash     = flash === 'up' ? 'bg-emerald-50' : flash === 'down' ? 'bg-red-50' : 'bg-white'
  const showBreadth = breadth && breadth.total > 0
  const isClickable = !!onClick

  if (idx.group === 'vix') {
    const mood = vixLabel(idx.last)
    return (
      <div className={`flex flex-col px-3 py-2 rounded-xl border border-gray-200 min-w-[96px] transition-colors duration-300 ${mood.bg}`}>
        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">VIX</span>
        <span className="text-sm font-bold font-mono text-gray-900">{idx.last.toFixed(2)}</span>
        <span className={`text-[10px] font-semibold mt-0.5 ${mood.color}`}>{mood.text}</span>
      </div>
    )
  }

  return (
    <div
      onClick={onClick}
      className={`flex flex-col px-3 py-2 rounded-xl border transition-colors duration-300
        ${showBreadth ? 'min-w-[130px]' : 'min-w-[110px]'}
        ${active
          ? 'border-blue-300 ring-1 ring-blue-200 bg-blue-50'
          : `border-gray-200 ${bgFlash}`}
        ${isClickable ? 'cursor-pointer hover:border-gray-400 select-none' : ''}
      `}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">{idx.name}</span>
        {isClickable && (
          <span className="text-[9px] text-gray-300">⊞</span>
        )}
      </div>
      <span className="text-sm font-bold font-mono text-gray-900">{fmt(idx.last)}</span>
      <span className={`text-[10px] font-mono font-medium mt-0.5 ${up ? 'text-emerald-600' : 'text-red-500'}`}>
        {up ? '▲' : '▼'} {Math.abs(idx.change).toFixed(1)} ({Math.abs(idx.changePct).toFixed(2)}%)
      </span>
      {showBreadth && <BreadthBar breadth={breadth!} stale={stale} />}
    </div>
  )
}

function SectorChip({ idx, flash }: { idx: IndexQuote; flash: 'up' | 'down' | null }) {
  const up      = idx.change >= 0
  const bgFlash = flash === 'up' ? 'bg-emerald-50 border-emerald-200' : flash === 'down' ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition-colors duration-300 ${bgFlash}`}>
      <span className="font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{idx.name}</span>
      <span className={`font-mono font-bold ${up ? 'text-emerald-600' : 'text-red-500'}`}>
        {up ? '▲' : '▼'}{Math.abs(idx.changePct).toFixed(2)}%
      </span>
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
  const [openModal, setOpenModal]     = useState<'nifty50' | 'banknifty' | null>(null)
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
        if (prev !== undefined && prev !== idx.last) {
          newFlashes[idx.name] = idx.last > prev ? 'up' : 'down'
        }
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
    } catch { /* silent */ }
  }

  useEffect(() => {
    fetchIndices()
    const id = setInterval(fetchIndices, 15000)
    return () => clearInterval(id)
  }, [])

  if (indices.length === 0) return null

  const gift    = indices.filter(i => i.group === 'gift')
  const broad   = indices.filter(i => i.group === 'broad' || i.group === 'vix')
  const sectors = indices.filter(i => i.group === 'sector')

  return (
    <>
      <div className="space-y-2">
        {/* Row 1 — broad market */}
        <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
          {gift.map(idx => (
            <div key={idx.name} className="flex flex-col px-3 py-2 rounded-xl border border-indigo-200 bg-indigo-50 min-w-[110px]">
              <span className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider mb-0.5 whitespace-nowrap">GIFT NIFTY</span>
              <span className="text-sm font-bold font-mono text-gray-900">{fmt(idx.last)}</span>
              <span className={`text-[10px] font-mono font-medium mt-0.5 ${idx.change >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {idx.change >= 0 ? '▲' : '▼'} {Math.abs(idx.change).toFixed(1)} ({Math.abs(idx.changePct).toFixed(2)}%)
              </span>
            </div>
          ))}
          {broad.map(idx => (
            <BroadCard
              key={idx.name}
              idx={idx}
              flash={flashes[idx.name] ?? null}
              breadth={
                idx.name === 'NIFTY 50'   ? breadth :
                idx.name === 'BANK NIFTY' ? bankBreadth : null
              }
              stale={stale}
              onClick={
                idx.name === 'NIFTY 50'   && tiles.length     > 0 ? () => setOpenModal(o => o === 'nifty50'   ? null : 'nifty50')   :
                idx.name === 'BANK NIFTY' && bankTiles.length > 0 ? () => setOpenModal(o => o === 'banknifty' ? null : 'banknifty') :
                undefined
              }
              active={
                (idx.name === 'NIFTY 50'   && openModal === 'nifty50') ||
                (idx.name === 'BANK NIFTY' && openModal === 'banknifty')
              }
            />
          ))}
          {stale && (
            <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 border border-gray-200 px-2 py-1 rounded-full whitespace-nowrap">
              CLOSED · Last close
            </span>
          )}
        </div>

        {/* Row 2 — sectors */}
        {sectors.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto">
            <span className="text-[10px] font-semibold text-gray-300 uppercase tracking-widest whitespace-nowrap">Sectors</span>
            {sectors.map(idx => (
              <SectorChip key={idx.name} idx={idx} flash={flashes[idx.name] ?? null} />
            ))}
          </div>
        )}
      </div>

      {/* Heatmap modal — portal-style fixed overlay */}
      {openModal === 'nifty50' && tiles.length > 0 && (
        <HeatmapModal
          title="Nifty 50"
          tiles={tiles}
          cols={10}
          stale={stale}
          onClose={() => setOpenModal(null)}
        />
      )}
      {openModal === 'banknifty' && bankTiles.length > 0 && (
        <HeatmapModal
          title="Bank Nifty"
          tiles={bankTiles}
          cols={6}
          stale={stale}
          onClose={() => setOpenModal(null)}
        />
      )}
    </>
  )
}
