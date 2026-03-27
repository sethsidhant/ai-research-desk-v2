'use client'
// DashboardTodayGain — polls live prices and shows today's gain row
// injected into the server-rendered overview cards on the dashboard.

import { useState, useEffect } from 'react'

type WatchRow = { ticker: string; invested: number; entryPrice: number; currentPrice: number }
type PortRow  = { ticker: string; quantity: number; currentPrice: number }

function GainRow({ gain, pct }: { gain: number; pct: number }) {
  const color = gain >= 0 ? 'text-emerald-600' : 'text-red-500'
  const sign  = gain >= 0 ? '+' : ''
  return (
    <div className="flex justify-between items-center pt-1 border-t border-gray-100">
      <span className="text-xs text-gray-500">Today's Gain</span>
      <div className="text-right">
        <span className={`text-sm font-bold font-mono ${color}`}>
          {sign}₹{Math.abs(gain).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
        </span>
        <div className={`text-[11px] font-mono ${color}`}>
          {sign}{pct.toFixed(2)}%
        </div>
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
  return <GainRow gain={data.gain} pct={data.pct} />
}

export function PortfolioTodayGain({ rows }: { rows: PortRow[] }) {
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
        if (!live) continue
        gain      += live.change * r.quantity
        prevClose += (live.last - live.change) * r.quantity
      }
      if (prevClose > 0) setData({ gain, pct: (gain / prevClose) * 100 })
    }
    poll()
    const id = setInterval(poll, 15000)
    return () => clearInterval(id)
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return null
  return <GainRow gain={data.gain} pct={data.pct} />
}
