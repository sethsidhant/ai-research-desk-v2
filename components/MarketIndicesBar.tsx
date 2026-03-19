'use client'

import { useEffect, useRef, useState } from 'react'

type IndexQuote = {
  name:      string
  last:      number
  prevClose: number
  change:    number
  changePct: number
}

function fmt(n: number) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function MarketIndicesBar() {
  const [indices, setIndices]     = useState<IndexQuote[]>([])
  const [error, setError]         = useState(false)
  const prevRef                   = useRef<Record<string, number>>({})
  const [flashes, setFlashes]     = useState<Record<string, 'up' | 'down' | null>>({})

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
      setError(false)

      if (Object.keys(newFlashes).length > 0) {
        setFlashes(newFlashes)
        setTimeout(() => setFlashes({}), 1000)
      }
    } catch {
      setError(true)
    }
  }

  useEffect(() => {
    fetchIndices()
    const id = setInterval(fetchIndices, 15000)
    return () => clearInterval(id)
  }, [])

  if (error || indices.length === 0) return null

  return (
    <div className="flex items-center gap-2 sm:gap-4 min-w-max">
      {indices.map(idx => {
        const up      = idx.change >= 0
        const flash   = flashes[idx.name]
        const bgFlash = flash === 'up' ? 'bg-emerald-50' : flash === 'down' ? 'bg-red-50' : ''

        return (
          <div
            key={idx.name}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 transition-colors duration-300 ${bgFlash || 'bg-white'}`}
          >
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
              {idx.name}
            </span>
            <span className="text-sm font-mono font-bold text-gray-900">
              {fmt(idx.last)}
            </span>
            <span className={`text-xs font-mono font-medium ${up ? 'text-emerald-600' : 'text-red-600'}`}>
              {up ? '+' : ''}{fmt(idx.change)} ({up ? '+' : ''}{idx.changePct.toFixed(2)}%)
            </span>
          </div>
        )
      })}
    </div>
  )
}
