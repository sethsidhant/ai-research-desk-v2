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
    <div className="mt-2">
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
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl border border-gray-200 p-5 w-full max-w-2xl max-h-[80vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
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

/** Featured card for NIFTY 50 and BANK NIFTY — intentionally primary */
function PrimaryCard({
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
  const showBreadth = breadth && breadth.total > 0
  const bgBase      = flash === 'up' ? 'bg-emerald-50' : flash === 'down' ? 'bg-red-50' : 'bg-white'

  return (
    <div
      onClick={onClick}
      className={`flex flex-col px-3 py-2.5 rounded-xl border transition-colors duration-300 min-w-[140px]
        ${active
          ? 'border-blue-300 ring-1 ring-blue-200 bg-blue-50 border-l-blue-500'
          : `border-gray-200 border-l-2 ${up ? 'border-l-emerald-400' : 'border-l-red-400'} ${bgBase}`}
        ${onClick ? 'cursor-pointer hover:border-gray-300 select-none' : ''}
      `}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest whitespace-nowrap">{idx.name}</span>
        {onClick && <span className="text-[9px] text-gray-300 shrink-0">⊞</span>}
      </div>
      <span className="text-[15px] font-bold font-mono text-gray-900 leading-tight mt-0.5">{fmt(idx.last)}</span>
      <span className={`text-[11px] font-mono font-semibold mt-0.5 ${up ? 'text-emerald-600' : 'text-red-500'}`}>
        {up ? '▲' : '▼'} {Math.abs(idx.change).toFixed(1)} ({Math.abs(idx.changePct).toFixed(2)}%)
      </span>
      {showBreadth && <BreadthBar breadth={breadth!} stale={stale} />}
    </div>
  )
}

/** Compact chip for GIFT, SENSEX, NIFTY 500, MIDCAP, SMALLCAP */
function SecondaryChip({
  idx, flash, accent,
}: {
  idx:     IndexQuote
  flash:   'up' | 'down' | null
  accent?: boolean   // GIFT NIFTY gets a subtle indigo tint
}) {
  const up      = idx.change >= 0
  const bgFlash = flash === 'up' ? 'bg-emerald-50' : flash === 'down' ? 'bg-red-50' : accent ? 'bg-indigo-50' : 'bg-gray-50'
  const border  = accent ? 'border-indigo-200' : 'border-gray-200'
  const label   = accent ? 'text-indigo-400' : 'text-gray-400'

  return (
    <div className={`flex flex-col px-2.5 py-1.5 rounded-lg border ${border} min-w-[82px] transition-colors duration-200 ${bgFlash}`}>
      <span className={`text-[9px] font-semibold uppercase tracking-wider whitespace-nowrap ${label}`}>{idx.name}</span>
      <span className="text-[12px] font-bold font-mono text-gray-900 leading-tight mt-0.5">{fmt(idx.last)}</span>
      <span className={`text-[9px] font-mono font-medium mt-0.5 ${up ? 'text-emerald-600' : 'text-red-500'}`}>
        {up ? '▲' : '▼'}{Math.abs(idx.changePct).toFixed(2)}%
      </span>
    </div>
  )
}

/** VIX — standalone mood chip */
function VixChip({ idx }: { idx: IndexQuote }) {
  const mood = vixLabel(idx.last)
  return (
    <div className={`flex flex-col px-2.5 py-1.5 rounded-lg border border-gray-200 min-w-[72px] ${mood.bg}`}>
      <span className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider">VIX</span>
      <span className="text-[12px] font-bold font-mono text-gray-900 leading-tight mt-0.5">{idx.last.toFixed(2)}</span>
      <span className={`text-[9px] font-semibold mt-0.5 ${mood.color}`}>{mood.text}</span>
    </div>
  )
}

/** Sector chip — row 2 */
function SectorChip({ idx, flash }: { idx: IndexQuote; flash: 'up' | 'down' | null }) {
  const up      = idx.change >= 0
  const bgFlash = flash === 'up' ? 'bg-emerald-50 border-emerald-200' : flash === 'down' ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-colors duration-200 ${bgFlash}`}>
      <span className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">{idx.name}</span>
      <span className={`text-[10px] font-mono font-bold ${up ? 'text-emerald-600' : 'text-red-500'}`}>
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
      <div className="flex items-start gap-2 py-1">
        <div className="flex gap-2">
          {[140, 140].map((w, i) => (
            <div key={i} className="rounded-xl border border-gray-100 bg-gray-50 animate-pulse" style={{ width: w, height: 80 }} />
          ))}
        </div>
        <div className="w-px bg-gray-100 self-stretch mx-0.5" />
        <div className="flex gap-1.5 flex-wrap">
          {[82, 82, 82, 82, 72].map((w, i) => (
            <div key={i} className="rounded-lg border border-gray-100 bg-gray-50 animate-pulse" style={{ width: w, height: 56 }} />
          ))}
        </div>
      </div>
    )
  }

  if (indices.length === 0) {
    return (
      <div className="flex items-center gap-2 py-2">
        <span className="text-xs text-gray-400 bg-gray-50 border border-gray-200 px-3 py-1.5 rounded-lg">
          Indices unavailable · Kite credentials not configured
        </span>
      </div>
    )
  }

  const gift    = indices.filter(i => i.group === 'gift')
  const primary = indices.filter(i => i.name === 'NIFTY 50' || i.name === 'BANK NIFTY')
  const secondary = indices.filter(i => i.group === 'broad' && i.name !== 'NIFTY 50' && i.name !== 'BANK NIFTY')
  const vixIdx  = indices.find(i => i.group === 'vix') ?? null
  const sectors = indices.filter(i => i.group === 'sector')

  return (
    <>
      <div className="space-y-1.5">
        {/* Row 1 — primary featured + secondary compact */}
        <div className="flex items-start gap-2 overflow-x-auto pb-0.5">
          {/* Primary block: NIFTY 50 + BANK NIFTY */}
          <div className="flex gap-2 shrink-0">
            {primary.map(idx => (
              <PrimaryCard
                key={idx.name}
                idx={idx}
                flash={flashes[idx.name] ?? null}
                breadth={idx.name === 'NIFTY 50' ? breadth : bankBreadth}
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
          </div>

          {/* Vertical divider */}
          <div className="w-px bg-gray-200 self-stretch mx-0.5 shrink-0" />

          {/* Secondary compact strip: GIFT + SENSEX + NIFTY 500 + MIDCAP + SMALLCAP + VIX */}
          <div className="flex items-start gap-1.5 flex-wrap">
            {gift.map(idx => (
              <SecondaryChip key={idx.name} idx={idx} flash={flashes[idx.name] ?? null} accent />
            ))}
            {secondary.map(idx => (
              <SecondaryChip key={idx.name} idx={idx} flash={flashes[idx.name] ?? null} />
            ))}
            {vixIdx && <VixChip idx={vixIdx} />}
          </div>

          {stale && (
            <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 border border-gray-200 px-2 py-1 rounded-full whitespace-nowrap self-center shrink-0">
              CLOSED · Last close
            </span>
          )}
        </div>

        {/* Row 2 — sectors */}
        {sectors.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto">
            <span className="text-[9px] font-bold text-gray-300 uppercase tracking-widest whitespace-nowrap shrink-0">Sectors</span>
            {sectors.map(idx => (
              <SectorChip key={idx.name} idx={idx} flash={flashes[idx.name] ?? null} />
            ))}
          </div>
        )}
      </div>

      {/* Heatmap modals */}
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
