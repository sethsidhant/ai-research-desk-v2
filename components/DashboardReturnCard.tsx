'use client'
// DashboardReturnCard — client components for Watchlist + Portfolio return cards.
// Recalculates total return % and P&L from live Kite prices so the big number
// stays in sync instead of being frozen at SSR-time DB value.

import Link from 'next/link'
import { useState, useEffect } from 'react'

type WatchRow = { ticker: string; invested: number; entryPrice: number }
type PortRow  = { ticker: string; quantity: number; avgPrice: number; price5dAgo?: number | null }

type LivePrices = Record<string, { change: number; last: number }>

// Semi-circle arc gauge. Range: -30% to +30% P&L.
// sweep=0 draws the top arch (counterclockwise in SVG = visually upward from left to right).
function ArcGauge({ pct }: { pct: number }) {
  // Layout: cx=46, cy=46, r=36. Top of arc at y=10. Sides at x=10 and x=82.
  // viewBox "4 6 84 44" shows x:4→88, y:6→50 — 6px clearance on all sides.
  const cx = 46, cy = 46, r = 36
  const totalLen = Math.PI * r
  const minPct = -30, maxPct = 30
  const t = Math.max(0, Math.min(1, (pct - minPct) / (maxPct - minPct)))
  const filled  = t * totalLen
  const color   = pct >= 0 ? '#006a61' : '#c0392b'

  // Needle
  const angle = (1 - t) * Math.PI
  const nr = r - 9
  const nx = cx + nr * Math.cos(angle)
  const ny = cy - nr * Math.sin(angle)

  // Three small inner tick dots at −, 0, +
  const tickDots = [0, 0.5, 1].map(tv => {
    const ta = (1 - tv) * Math.PI
    const tr = r - 4
    return { x: cx + tr * Math.cos(ta), y: cy - tr * Math.sin(ta) }
  })

  return (
    <svg width="92" height="48" viewBox="4 6 84 44" style={{ flexShrink: 0 }}>
      {/* Track — neutral gray so it's always visible regardless of P&L sign */}
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 0 ${cx + r} ${cy}`}
        fill="none" stroke="rgba(11,28,48,0.1)" strokeWidth="7" strokeLinecap="round"
      />
      {/* Filled portion */}
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 0 ${cx + r} ${cy}`}
        fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
        strokeDasharray={`${filled} ${totalLen}`}
      />
      {/* Inner tick dots */}
      {tickDots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r="1.5" fill="rgba(11,28,48,0.25)" />
      ))}
      {/* Needle */}
      <line x1={cx} y1={cy} x2={nx} y2={ny}
        stroke={color} strokeWidth="2" strokeLinecap="round" />
      {/* Pivot */}
      <circle cx={cx} cy={cy} r="3.5" fill={color} />
      <circle cx={cx} cy={cy} r="1.5" fill="white" opacity="0.9" />
    </svg>
  )
}

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

  const { totalInvested, totalCurrent, todayGain, todayBase } = (() => {
    let inv = 0, cur = 0, tGain = 0, tBase = 0
    for (const r of rows) {
      if (!r.entryPrice || !r.invested) continue
      const virtualShares = r.invested / r.entryPrice
      const livePrice = prices?.[r.ticker]?.last ?? null
      inv += r.invested
      cur += livePrice != null ? livePrice * virtualShares : r.invested
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
            <div className="flex items-center justify-between gap-2 mb-1">
              <div>
                <div className="font-display font-bold text-3xl leading-none" style={{ color: accentColor, letterSpacing: '-0.03em' }}>
                  {positive ? '+' : ''}{totalPct.toFixed(2)}%
                </div>
                <div className="text-xs mt-1.5 font-mono" style={{ color: 'var(--artha-text-muted)' }}>
                  {positive ? '+' : '−'}₹{Math.abs(totalPnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })} P&amp;L
                </div>
                <div className="text-[11px] mt-0.5" style={{ color: 'var(--artha-text-faint)' }}>
                  Invested ₹{totalInvested.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </div>
              </div>
              <ArcGauge pct={totalPct} />
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
            <div className="flex items-center justify-between gap-2 mb-1">
              <div>
                <div className="font-display font-bold text-3xl leading-none" style={{ color: accentColor, letterSpacing: '-0.03em' }}>
                  {positive ? '+' : ''}{portPct.toFixed(2)}%
                </div>
                <div className="text-xs mt-1.5 font-mono" style={{ color: 'var(--artha-text-muted)' }}>
                  {positive ? '+' : '−'}₹{Math.abs(portPnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })} P&amp;L
                </div>
                <div className="text-[11px] mt-0.5" style={{ color: 'var(--artha-text-faint)' }}>
                  Invested ₹{portInvested.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </div>
              </div>
              <ArcGauge pct={portPct} />
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
