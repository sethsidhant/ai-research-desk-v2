'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

export type WatchRow = {
  ticker: string
  entryPrice: number | null
  rsi: number | null
  above200dma: boolean | null
  currentPrice: number | null
}

type LivePrice = { last: number; change: number; changePct: number }

function RsiChip({ rsi }: { rsi: number }) {
  const oversold  = rsi < 30
  const overbought = rsi > 70
  const bg    = oversold  ? 'rgba(0,106,97,0.12)'  : overbought ? 'rgba(192,57,43,0.12)'  : 'var(--artha-surface)'
  const color = oversold  ? 'var(--artha-teal)'    : overbought ? 'var(--artha-negative)' : 'var(--artha-text-faint)'
  const border = oversold ? '1px solid rgba(0,106,97,0.2)' : overbought ? '1px solid rgba(192,57,43,0.2)' : '1px solid var(--artha-border)'
  return (
    <span
      className="font-mono font-bold text-[10px] px-1.5 py-0.5 rounded shrink-0"
      style={{ background: bg, color, border }}
    >
      {rsi.toFixed(0)}
    </span>
  )
}

export default function WatchlistMiniSection({ rows }: { rows: WatchRow[] }) {
  const [prices, setPrices] = useState<Record<string, LivePrice>>({})

  useEffect(() => {
    async function poll() {
      const res  = await fetch('/api/live-prices').catch(() => null)
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
        No stocks in your watchlist yet.
      </div>
    )
  }

  return (
    <div className="px-5 pb-4">
      <div className="space-y-1.5 mt-1">
        {display.map(row => {
          const live     = prices[row.ticker]
          const price    = live?.last ?? row.currentPrice
          const changePct = live?.changePct ?? null
          const vsEntry   = (price && row.entryPrice)
            ? ((price - row.entryPrice) / row.entryPrice) * 100
            : null
          const dayUp = changePct != null && changePct >= 0
          const entryUp = vsEntry != null && vsEntry >= 0

          return (
            <div
              key={row.ticker}
              className="flex items-center gap-2 rounded-xl px-3 py-2"
              style={{ background: 'var(--artha-surface)' }}
            >
              {/* Ticker badge */}
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

              {/* Live price */}
              <span className="font-mono font-semibold text-xs flex-1" style={{ color: 'var(--artha-text)' }}>
                {price ? `₹${price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
              </span>

              {/* Day change % */}
              {changePct != null && (
                <span
                  className="font-mono font-bold text-[10px] px-1.5 py-0.5 rounded shrink-0"
                  style={{
                    background: dayUp ? 'var(--artha-teal-subtle)' : 'var(--artha-negative-bg)',
                    color: dayUp ? 'var(--artha-teal)' : 'var(--artha-negative)',
                  }}
                >
                  {dayUp ? '+' : ''}{changePct.toFixed(2)}%
                </span>
              )}

              {/* vs Entry */}
              {vsEntry != null && (
                <span
                  className="font-mono text-[10px] font-semibold shrink-0"
                  style={{ color: entryUp ? 'var(--artha-teal)' : 'var(--artha-negative)' }}
                >
                  {entryUp ? '+' : ''}{vsEntry.toFixed(1)}%
                </span>
              )}

              {/* RSI chip */}
              {row.rsi != null && <RsiChip rsi={row.rsi} />}
            </div>
          )
        })}
      </div>

      <div className="mt-3 flex justify-end">
        <Link href="/watchlist" className="text-xs font-semibold transition-colors hover:opacity-70" style={{ color: 'var(--artha-teal)' }}>
          Watchlist →
        </Link>
      </div>
    </div>
  )
}
