'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

type IndexRow = {
  name: string
  last: number
  change: number
  changePct: number
  group: string
}

type Breadth = {
  advances: number
  declines: number
  total: number
}

type ApiResponse = {
  indices: IndexRow[]
  breadth: Breadth
}

const BROAD_NAMES = ['NIFTY 50', 'SENSEX', 'BANK NIFTY', 'NIFTY 500', 'MIDCAP 100', 'SMALLCAP 100']

export default function GlobalMiniWidget() {
  const [data, setData] = useState<ApiResponse | null>(null)

  useEffect(() => {
    async function poll() {
      const res  = await fetch('/api/market-indices').catch(() => null)
      if (!res?.ok) return
      const json = await res.json().catch(() => null)
      if (json?.indices) setData(json)
    }
    poll()
    const id = setInterval(poll, 30000)
    return () => clearInterval(id)
  }, [])

  if (!data) {
    return (
      <div className="text-sm py-2" style={{ color: 'var(--artha-text-muted)' }}>
        Loading…
      </div>
    )
  }

  const broad = data.indices.filter(
    i => i.group === 'broad' && BROAD_NAMES.some(n => i.name.toUpperCase().includes(n.toUpperCase()) || n.toUpperCase().includes(i.name.toUpperCase()))
  ).slice(0, 6)

  const vix = data.indices.find(i => i.group === 'vix')

  const display: IndexRow[] = vix ? [...broad, vix] : broad

  const { advances, declines } = data.breadth

  function shortName(name: string): string {
    return name
      .replace(/^NIFTY\s+/i, '')
      .replace(/^NSE:/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 14)
  }

  return (
    <div>
      <div className="space-y-1">
        {display.map(idx => {
          const up = idx.changePct >= 0
          const isVix = idx.group === 'vix'
          return (
            <div key={idx.name} className="flex items-center justify-between py-1">
              <span
                className="text-xs truncate flex-1 mr-2"
                style={{ color: isVix ? 'var(--artha-text-muted)' : 'var(--artha-text)', maxWidth: '140px' }}
                title={idx.name}
              >
                {isVix ? 'India VIX' : shortName(idx.name)}
              </span>
              <span
                className="font-mono font-bold text-[11px] shrink-0"
                style={{ color: up ? 'var(--artha-teal)' : 'var(--artha-negative)' }}
              >
                {up ? '+' : ''}{idx.changePct.toFixed(2)}%
              </span>
            </div>
          )
        })}
      </div>

      {/* Breadth row */}
      {(advances > 0 || declines > 0) && (
        <div className="flex items-center gap-2 mt-3 pt-2.5" style={{ borderTop: '1px solid var(--artha-border)' }}>
          <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: 'var(--artha-teal)' }} />
          <span className="text-[11px]" style={{ color: 'var(--artha-text-muted)' }}>
            Advances <strong style={{ color: 'var(--artha-teal)' }}>{advances}</strong>
          </span>
          <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: 'var(--artha-negative)' }} />
          <span className="text-[11px]" style={{ color: 'var(--artha-text-muted)' }}>
            Declines <strong style={{ color: 'var(--artha-negative)' }}>{declines}</strong>
          </span>
        </div>
      )}

      <div className="mt-3 flex justify-end">
        <Link href="/global-indices" className="text-xs font-semibold transition-colors hover:opacity-70" style={{ color: 'var(--artha-teal)' }}>
          Global Markets →
        </Link>
      </div>
    </div>
  )
}
