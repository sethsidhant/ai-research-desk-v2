'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

export type PortRow = {
  ticker: string
  quantity: number
  avgPrice: number
  alloc: number
}

type LivePrice = { last: number; change: number; changePct: number }

export default function PortfolioMiniSection({ rows }: { rows: PortRow[] }) {
  const [prices, setPrices] = useState<Record<string, LivePrice>>({})

  useEffect(() => {
    async function poll() {
      const res  = await fetch('/api/portfolio/live-prices').catch(() => null)
      if (!res?.ok) return
      const json = await res.json().catch(() => null)
      if (json?.prices) setPrices(json.prices)
    }
    poll()
    const id = setInterval(poll, 15000)
    return () => clearInterval(id)
  }, [])

  const display = rows.slice(0, 6)

  if (display.length === 0) {
    return (
      <div className="px-5 py-4 text-sm" style={{ color: 'var(--artha-text-muted)' }}>
        No portfolio holdings yet.
      </div>
    )
  }

  return (
    <div className="px-5 pb-4">
      <div className="space-y-1.5 mt-1">
        {display.map(row => {
          const live    = prices[row.ticker]
          const price   = live?.last
          const pnlPct  = price != null && row.avgPrice > 0
            ? ((price - row.avgPrice) / row.avgPrice) * 100
            : null
          const up = pnlPct != null && pnlPct >= 0

          return (
            <div
              key={row.ticker}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2"
              style={{ background: 'var(--artha-surface)' }}
            >
              {/* Ticker */}
              <span
                className="font-mono font-bold text-[11px] px-2 py-0.5 rounded-md shrink-0 min-w-[52px] text-center"
                style={{
                  background: 'rgba(11,28,48,0.07)',
                  color: 'var(--artha-text)',
                  border: '1px solid var(--artha-border)',
                }}
              >
                {row.ticker}
              </span>

              {/* Allocation bar */}
              <div className="flex-1 flex items-center gap-2 min-w-0">
                <div
                  className="h-1.5 rounded-full overflow-hidden flex-1"
                  style={{ background: 'rgba(11,28,48,0.08)' }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(row.alloc, 100)}%`,
                      background: 'linear-gradient(90deg, #006a61, #00c4b4)',
                    }}
                  />
                </div>
                <span className="font-mono text-[10px] shrink-0" style={{ color: 'var(--artha-text-muted)' }}>
                  {row.alloc.toFixed(1)}%
                </span>
              </div>

              {/* Live P&L % */}
              {pnlPct != null ? (
                <span
                  className="font-mono font-bold text-[10px] px-1.5 py-0.5 rounded shrink-0"
                  style={{
                    background: up ? 'var(--artha-teal-subtle)' : 'var(--artha-negative-bg)',
                    color: up ? 'var(--artha-teal)' : 'var(--artha-negative)',
                  }}
                >
                  {up ? '+' : ''}{pnlPct.toFixed(2)}%
                </span>
              ) : (
                <span className="text-[10px] shrink-0" style={{ color: 'var(--artha-text-faint)' }}>—</span>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-3 flex justify-end">
        <Link href="/portfolio" className="text-xs font-semibold transition-colors hover:opacity-70" style={{ color: 'var(--artha-teal)' }}>
          Portfolio →
        </Link>
      </div>
    </div>
  )
}
