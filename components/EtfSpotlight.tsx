'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

export type EtfMeta = {
  ticker: string
  name: string
  category: string
  aum_cr: number | null
  expense_ratio: number | null
}

type EtfLivePrice = {
  price: number
  change: number
  changePct: number
  premiumPct: number | null
}

const CATEGORY_COLOR: Record<string, string> = {
  equity_broad:     '#3b82f6',
  equity_midcap:    '#8b5cf6',
  equity_smallcap:  '#a855f7',
  equity_sector:    '#ec4899',
  gold:             '#f59e0b',
  silver:           '#6b7280',
  international:    '#10b981',
  debt:             '#f97316',
  liquid:           '#14b8a6',
}

function catColor(cat: string): string {
  return CATEGORY_COLOR[cat] ?? '#6b7280'
}

export default function EtfSpotlight({ etfs }: { etfs: EtfMeta[] }) {
  const [prices, setPrices] = useState<Record<string, EtfLivePrice>>({})

  useEffect(() => {
    async function poll() {
      const res  = await fetch('/api/etf/live-prices').catch(() => null)
      if (!res?.ok) return
      const json = await res.json().catch(() => null)
      if (json?.prices) setPrices(json.prices)
    }
    poll()
    const id = setInterval(poll, 30000)
    return () => clearInterval(id)
  }, [])

  // Top 6 by aum_cr (already ordered by server, just slice)
  const display = etfs.slice(0, 6)

  if (display.length === 0) {
    return (
      <div className="text-sm py-2" style={{ color: 'var(--artha-text-muted)' }}>
        No ETFs available.
      </div>
    )
  }

  return (
    <div>
      <div className="space-y-1.5">
        {display.map(etf => {
          const live     = prices[etf.ticker]
          const up       = live ? live.changePct >= 0 : null
          const dotColor = catColor(etf.category)
          const truncName = etf.name.length > 22 ? etf.name.slice(0, 22) + '…' : etf.name

          return (
            <div
              key={etf.ticker}
              className="flex items-center gap-2 rounded-xl px-3 py-2"
              style={{ background: 'var(--artha-surface)' }}
            >
              {/* Category dot */}
              <span
                className="shrink-0 rounded-full"
                style={{ width: 7, height: 7, background: dotColor, marginTop: 1 }}
              />

              {/* Ticker */}
              <span
                className="font-mono font-bold text-[10px] px-1.5 py-0.5 rounded shrink-0"
                style={{
                  background: 'rgba(11,28,48,0.07)',
                  color: 'var(--artha-text)',
                  border: '1px solid var(--artha-border)',
                  minWidth: '48px',
                  textAlign: 'center',
                }}
              >
                {etf.ticker}
              </span>

              {/* Name */}
              <span
                className="text-[11px] flex-1 min-w-0 truncate"
                style={{ color: 'var(--artha-text-muted)' }}
                title={etf.name}
              >
                {truncName}
              </span>

              {/* Price + change */}
              {live ? (
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="font-mono text-xs font-semibold" style={{ color: 'var(--artha-text)' }}>
                    ₹{live.price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span
                    className="font-mono font-bold text-[10px] px-1.5 py-0.5 rounded"
                    style={{
                      background: up ? 'var(--artha-teal-subtle)' : 'var(--artha-negative-bg)',
                      color: up ? 'var(--artha-teal)' : 'var(--artha-negative)',
                    }}
                  >
                    {up ? '+' : ''}{live.changePct.toFixed(2)}%
                  </span>
                </div>
              ) : (
                <span className="text-[10px] shrink-0" style={{ color: 'var(--artha-text-faint)' }}>—</span>
              )}

              {/* Premium/discount chip */}
              {live?.premiumPct != null && (
                <span
                  className="font-mono text-[9px] font-bold px-1 py-0.5 rounded shrink-0"
                  style={{
                    background: live.premiumPct >= 0 ? 'rgba(0,106,97,0.08)' : 'rgba(192,57,43,0.08)',
                    color: live.premiumPct >= 0 ? 'var(--artha-teal)' : 'var(--artha-negative)',
                    border: `1px solid ${live.premiumPct >= 0 ? 'rgba(0,106,97,0.15)' : 'rgba(192,57,43,0.15)'}`,
                  }}
                  title="Premium/discount to NAV"
                >
                  {live.premiumPct >= 0 ? '+' : ''}{live.premiumPct.toFixed(2)}%
                </span>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-3 flex justify-end">
        <Link href="/etf" className="text-xs font-semibold transition-colors hover:opacity-70" style={{ color: 'var(--artha-teal)' }}>
          ETF Tracker →
        </Link>
      </div>
    </div>
  )
}
