'use client'
// DashboardReturnCard — client components for Watchlist + Portfolio return cards.
// Recalculates total return % and P&L from live Kite prices so the big number
// stays in sync instead of being frozen at SSR-time DB value.

import Link from 'next/link'
import { useState, useEffect } from 'react'

type WatchRow = { ticker: string; invested: number; entryPrice: number }
type PortRow  = { ticker: string; quantity: number; avgPrice: number; price5dAgo?: number | null }

type LivePrices = Record<string, { change: number; last: number }>

function GainInline({ label, gain, pct, dim }: { label: string; gain: number; pct: number; dim?: boolean }) {
  const positive = gain >= 0
  const sign = positive ? '+' : ''
  const color = positive ? 'var(--artha-teal)' : 'var(--artha-negative)'
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px]" style={{ color: dim ? 'var(--artha-text-faint)' : 'var(--artha-text-muted)' }}>{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-mono font-semibold" style={{ color: dim ? 'var(--artha-text-muted)' : color }}>
          {sign}₹{Math.abs(gain).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
        </span>
        <span
          className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded"
          style={{
            background: positive ? 'var(--artha-teal-subtle)' : 'var(--artha-negative-bg)',
            color,
            opacity: dim ? 0.7 : 1,
          }}
        >
          {sign}{pct.toFixed(2)}%
        </span>
      </div>
    </div>
  )
}

export function WatchlistReturnCard({ rows, watchlistCount }: { rows: WatchRow[]; watchlistCount: number }) {
  const [prices, setPrices] = useState<LivePrices | null>(null)

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
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Calculate totals using live prices where available, fall back to entry price
  const { totalInvested, totalCurrent, todayGain, todayBase } = (() => {
    let inv = 0, cur = 0, tGain = 0, tBase = 0
    for (const r of rows) {
      if (!r.entryPrice || !r.invested) continue
      const virtualShares = r.invested / r.entryPrice
      const livePrice = prices?.[r.ticker]?.last ?? null
      inv += r.invested
      cur += livePrice != null ? livePrice * virtualShares : r.invested // fallback: no gain shown
      if (prices?.[r.ticker]) {
        tGain += prices[r.ticker].change * virtualShares
        tBase += (prices[r.ticker].last - prices[r.ticker].change) * virtualShares
      }
    }
    return { totalInvested: inv, totalCurrent: cur, todayGain: tGain, todayBase: tBase }
  })()

  const hasData    = totalInvested > 0
  const totalPnl   = totalCurrent - totalInvested
  const totalPct   = hasData ? (totalPnl / totalInvested) * 100 : 0
  const positive   = totalPnl >= 0
  const accentColor = hasData ? (positive ? 'var(--artha-teal)' : 'var(--artha-negative)') : 'var(--artha-surface-low)'

  return (
    <Link href="/watchlist" className="artha-card artha-card-hover block overflow-hidden" style={{ padding: 0 }}>
      <div className="h-1 w-full" style={{ background: hasData ? accentColor : 'var(--artha-surface-low)' }} />
      <div className="px-5 py-4">
        <div className="flex items-center justify-between mb-3">
          <span className="artha-label">Watchlist Return</span>
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: 'var(--artha-surface-low)', color: 'var(--artha-text-muted)' }}>
            {watchlistCount} stocks
          </span>
        </div>
        {hasData ? (
          <>
            <div className="flex items-end justify-between gap-3 mb-3">
              <div>
                <div className="font-display font-bold text-3xl leading-none" style={{ color: accentColor, letterSpacing: '-0.03em' }}>
                  {positive ? '+' : ''}{totalPct.toFixed(2)}%
                </div>
                <div className="text-xs mt-1.5 font-mono" style={{ color: 'var(--artha-text-muted)' }}>
                  {positive ? '+' : '−'}₹{Math.abs(totalPnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })} total P&amp;L
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[11px]" style={{ color: 'var(--artha-text-faint)' }}>Invested</div>
                <div className="text-xs font-mono font-semibold" style={{ color: 'var(--artha-text-secondary)' }}>
                  ₹{totalInvested.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </div>
              </div>
            </div>
            {prices && todayBase > 0 && (
              <div className="mt-2 pt-2 space-y-1" style={{ borderTop: '1px solid var(--artha-surface-low)' }}>
                <GainInline label="Today's gain" gain={todayGain} pct={(todayGain / todayBase) * 100} />
              </div>
            )}
          </>
        ) : (
          <div className="text-sm py-2" style={{ color: 'var(--artha-text-muted)' }}>
            {watchlistCount} stocks tracked · set entry prices to see P&amp;L
          </div>
        )}
      </div>
    </Link>
  )
}

export function PortfolioReturnCard({ rows }: { rows: PortRow[] }) {
  const [prices, setPrices] = useState<LivePrices | null>(null)

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
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const { portInvested, portCurrent, todayGain, todayBase, gain5d, base5d } = (() => {
    let inv = 0, cur = 0, tGain = 0, tBase = 0, g5 = 0, b5 = 0
    for (const r of rows) {
      const livePrice = prices?.[r.ticker]?.last ?? null
      inv += r.quantity * r.avgPrice
      cur += livePrice != null ? livePrice * r.quantity : r.quantity * r.avgPrice
      if (prices?.[r.ticker]) {
        tGain += prices[r.ticker].change * r.quantity
        tBase += (prices[r.ticker].last - prices[r.ticker].change) * r.quantity
      }
      if (r.price5dAgo && prices?.[r.ticker]) {
        g5 += (prices[r.ticker].last - r.price5dAgo) * r.quantity
        b5 += r.price5dAgo * r.quantity
      }
    }
    return { portInvested: inv, portCurrent: cur, todayGain: tGain, todayBase: tBase, gain5d: g5, base5d: b5 }
  })()

  const hasHoldings = rows.length > 0
  const portPnl     = portCurrent - portInvested
  const portPct     = portInvested > 0 ? (portPnl / portInvested) * 100 : 0
  const positive    = portPnl >= 0
  const accentColor = hasHoldings ? (positive ? 'var(--artha-teal)' : 'var(--artha-negative)') : 'var(--artha-text-faint)'

  return (
    <Link href="/portfolio" className="artha-card artha-card-hover block overflow-hidden" style={{ padding: 0 }}>
      <div className="h-1 w-full" style={{ background: hasHoldings ? accentColor : 'var(--artha-surface-low)' }} />
      <div className="px-5 py-4">
        <div className="flex items-center justify-between mb-3">
          <span className="artha-label">Portfolio Return</span>
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: 'var(--artha-surface-low)', color: 'var(--artha-text-muted)' }}>
            {rows.length} holdings
          </span>
        </div>
        {hasHoldings ? (
          <>
            <div className="flex items-end justify-between gap-3 mb-3">
              <div>
                <div className="font-display font-bold text-3xl leading-none" style={{ color: accentColor, letterSpacing: '-0.03em' }}>
                  {positive ? '+' : ''}{portPct.toFixed(2)}%
                </div>
                <div className="text-xs mt-1.5 font-mono" style={{ color: 'var(--artha-text-muted)' }}>
                  {positive ? '+' : '−'}₹{Math.abs(portPnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })} total P&amp;L
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[11px]" style={{ color: 'var(--artha-text-faint)' }}>Invested</div>
                <div className="text-xs font-mono font-semibold" style={{ color: 'var(--artha-text-secondary)' }}>
                  ₹{portInvested.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </div>
              </div>
            </div>
            {prices && (
              <div className="mt-2 pt-2 space-y-1" style={{ borderTop: '1px solid var(--artha-surface-low)' }}>
                {todayBase > 0 && <GainInline label="Today's gain" gain={todayGain} pct={(todayGain / todayBase) * 100} />}
                {base5d > 0    && <GainInline label="5-day gain"   gain={gain5d}    pct={(gain5d / base5d) * 100} dim />}
              </div>
            )}
          </>
        ) : (
          <div className="text-sm py-2" style={{ color: 'var(--artha-text-muted)' }}>No holdings yet</div>
        )}
      </div>
    </Link>
  )
}
