'use client'
// DashboardTodayGain — polls live prices and shows today's gain row
// injected into the server-rendered overview cards on the dashboard.

import { useState, useEffect } from 'react'

type WatchRow = { ticker: string; invested: number; entryPrice: number; currentPrice: number }
type PortRow  = { ticker: string; quantity: number; currentPrice: number; price5dAgo?: number | null }

function GainInline({ label, gain, pct, dim }: { label: string; gain: number; pct: number; dim?: boolean }) {
  const positive = gain >= 0
  const sign     = positive ? '+' : ''
  const color    = positive ? 'var(--artha-teal)' : 'var(--artha-negative)'
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

export function WatchlistTodayGain({ rows }: { rows: WatchRow[] }) {
  const [data, setData] = useState<{ gain: number; pct: number } | null>(null)

  useEffect(() => {
    async function poll() {
      const res  = await fetch('/api/live-prices').catch(() => null)
      if (!res?.ok) return
      const json = await res.json().catch(() => null)
      if (!json?.prices) return
      const prices: Record<string, { change: number; last: number }> = json.prices

      let gain = 0, prevClose = 0
      for (const r of rows) {
        const live = prices[r.ticker]
        if (!live || !r.entryPrice || !r.invested) continue
        const virtualShares = r.invested / r.entryPrice
        gain      += live.change * virtualShares
        prevClose += (live.last - live.change) * virtualShares
      }
      if (prevClose > 0) setData({ gain, pct: (gain / prevClose) * 100 })
    }
    poll()
    const id = setInterval(poll, 15000)
    return () => clearInterval(id)
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return null
  return (
    <div className="mt-2 pt-2 space-y-1" style={{ borderTop: '1px solid var(--artha-surface-low)' }}>
      <GainInline label="Today's gain" gain={data.gain} pct={data.pct} />
    </div>
  )
}

export function PortfolioTodayGain({ rows }: { rows: PortRow[] }) {
  const [today, setToday] = useState<{ gain: number; pct: number } | null>(null)
  const [fiveDay, setFiveDay] = useState<{ gain: number; pct: number } | null>(null)

  useEffect(() => {
    async function poll() {
      const res  = await fetch('/api/live-prices').catch(() => null)
      if (!res?.ok) return
      const json = await res.json().catch(() => null)
      if (!json?.prices) return
      const prices: Record<string, { change: number; last: number }> = json.prices

      let gain = 0, prevClose = 0
      let gain5d = 0, base5d = 0
      for (const r of rows) {
        const live = prices[r.ticker]
        if (!live) continue
        gain      += live.change * r.quantity
        prevClose += (live.last - live.change) * r.quantity
        // 5-day: compare current price vs price 5 days ago
        if (r.price5dAgo) {
          gain5d += (live.last - r.price5dAgo) * r.quantity
          base5d += r.price5dAgo * r.quantity
        }
      }
      if (prevClose > 0) setToday({ gain, pct: (gain / prevClose) * 100 })
      if (base5d > 0) setFiveDay({ gain: gain5d, pct: (gain5d / base5d) * 100 })
    }
    poll()
    const id = setInterval(poll, 15000)
    return () => clearInterval(id)
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  if (!today && !fiveDay) return null
  return (
    <div className="mt-2 pt-2 space-y-1" style={{ borderTop: '1px solid var(--artha-surface-low)' }}>
      {today  && <GainInline label="Today's gain"  gain={today.gain}   pct={today.pct} />}
      {fiveDay && <GainInline label="5-day gain"   gain={fiveDay.gain} pct={fiveDay.pct} dim />}
    </div>
  )
}
