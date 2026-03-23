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

function BroadCard({ idx, flash }: { idx: IndexQuote; flash: 'up' | 'down' | null }) {
  const up      = idx.change >= 0
  const bgFlash = flash === 'up' ? 'bg-emerald-50' : flash === 'down' ? 'bg-red-50' : 'bg-white'

  if (idx.group === 'vix') {
    const mood = vixLabel(idx.last)
    return (
      <div className={`flex flex-col px-3 py-2 rounded-xl border border-gray-200 min-w-[96px] transition-colors duration-300 ${bgFlash || mood.bg}`}>
        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">VIX</span>
        <span className="text-sm font-bold font-mono text-gray-900">{idx.last.toFixed(2)}</span>
        <span className={`text-[10px] font-semibold mt-0.5 ${mood.color}`}>{mood.text}</span>
      </div>
    )
  }

  return (
    <div className={`flex flex-col px-3 py-2 rounded-xl border border-gray-200 min-w-[110px] transition-colors duration-300 ${bgFlash}`}>
      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5 whitespace-nowrap">{idx.name}</span>
      <span className="text-sm font-bold font-mono text-gray-900">{fmt(idx.last)}</span>
      <span className={`text-[10px] font-mono font-medium mt-0.5 ${up ? 'text-emerald-600' : 'text-red-500'}`}>
        {up ? '▲' : '▼'} {Math.abs(idx.changePct).toFixed(2)}%
      </span>
    </div>
  )
}

function SectorChip({ idx, flash }: { idx: IndexQuote; flash: 'up' | 'down' | null }) {
  const up      = idx.change >= 0
  const bgFlash = flash === 'up' ? 'bg-emerald-50 border-emerald-200' : flash === 'down' ? 'bg-red-50 border-red-200' : up ? 'bg-gray-50 border-gray-200' : 'bg-gray-50 border-gray-200'

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
  const [indices, setIndices] = useState<IndexQuote[]>([])
  const [stale, setStale]     = useState(false)
  const prevRef               = useRef<Record<string, number>>({})
  const [flashes, setFlashes] = useState<Record<string, 'up' | 'down' | null>>({})

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
      setStale(!!json.stale)

      if (Object.keys(newFlashes).length > 0) {
        setFlashes(newFlashes)
        setTimeout(() => setFlashes({}), 1000)
      }
    } catch { /* silent fail — keep showing last known data */ }
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
    <div className="space-y-2">
      {/* Row 1 — broad market (GIFT Nifty first as pre-market indicator) */}
      <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
        {gift.map(idx => (
          <div key={idx.name} className="flex flex-col px-3 py-2 rounded-xl border border-indigo-200 bg-indigo-50 min-w-[110px]">
            <span className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider mb-0.5 whitespace-nowrap">GIFT NIFTY</span>
            <span className="text-sm font-bold font-mono text-gray-900">{fmt(idx.last)}</span>
            <span className={`text-[10px] font-mono font-medium mt-0.5 ${idx.change >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              {idx.change >= 0 ? '▲' : '▼'} {Math.abs(idx.changePct).toFixed(2)}%
            </span>
          </div>
        ))}
        {broad.map(idx => (
          <BroadCard key={idx.name} idx={idx} flash={flashes[idx.name] ?? null} />
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
  )
}
