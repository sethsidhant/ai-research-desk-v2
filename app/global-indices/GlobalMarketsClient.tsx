'use client'

import { useState, useEffect, useCallback } from 'react'
import type { GlobalQuote } from '@/app/api/global-markets/route'

const REFRESH_INTERVAL = 60 * 1000

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtPrice(price: number, currency: string, symbol: string): string {
  if (symbol === 'USDINR=X') return `₹${price.toFixed(2)}`
  if (currency === 'INR')    return `₹${price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
  if (symbol === 'DX-Y.NYB') return price.toFixed(2)
  if (['GC=F', 'SI=F'].includes(symbol)) return `$${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
  if (['CL=F', 'BZ=F'].includes(symbol)) return `$${price.toFixed(2)}`
  if (price > 10000)  return price.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (price > 1000)   return price.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return price.toFixed(2)
}

function fmtChange(change: number, currency: string, symbol: string): string {
  const sign = change >= 0 ? '+' : ''
  if (symbol === 'USDINR=X') return `${sign}₹${Math.abs(change).toFixed(4)}`
  if (symbol === 'DX-Y.NYB') return `${sign}${change.toFixed(3)}`
  if (['GC=F', 'SI=F', 'CL=F', 'BZ=F'].includes(symbol)) return `${sign}$${Math.abs(change).toFixed(2)}`
  if (change > 100 || change < -100) return `${sign}${change.toFixed(0)}`
  return `${sign}${change.toFixed(2)}`
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 10)  return 'just now'
  if (s < 60)  return `${s}s ago`
  if (s < 120) return '1m ago'
  return `${Math.floor(s / 60)}m ago`
}

// ── Single quote card ─────────────────────────────────────────────────────────

function QuoteCard({ q }: { q: GlobalQuote }) {
  const positive   = q.changePct >= 0
  const zero       = q.change === 0
  const accentColor = zero ? 'var(--artha-text-faint)' : positive ? 'var(--artha-teal)' : 'var(--artha-negative)'
  const accentBg    = zero ? 'var(--artha-surface-low)' : positive ? 'var(--artha-teal-subtle)' : 'var(--artha-negative-bg)'

  return (
    <div
      className="artha-card px-4 py-4 flex flex-col gap-2 overflow-hidden relative"
      style={{ borderTop: `2px solid ${zero ? 'var(--artha-surface-low)' : accentColor}` }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {q.flag && <span className="text-sm leading-none">{q.flag}</span>}
            <span className="text-xs font-bold truncate" style={{ color: 'var(--artha-text)' }}>{q.name}</span>
          </div>
        </div>
        {/* Change % badge */}
        <span
          className="shrink-0 text-[11px] font-bold font-mono px-2 py-0.5 rounded-full"
          style={{ background: accentBg, color: accentColor }}
        >
          {positive && !zero ? '+' : ''}{q.changePct.toFixed(2)}%
        </span>
      </div>

      {/* Price */}
      <div className="font-display font-bold text-xl leading-none" style={{ color: 'var(--artha-text)', letterSpacing: '-0.02em' }}>
        {fmtPrice(q.price, q.currency, q.symbol)}
      </div>

      {/* Abs change */}
      <div className="text-xs font-mono" style={{ color: accentColor }}>
        {zero ? '—' : fmtChange(q.change, q.currency, q.symbol)}
      </div>
    </div>
  )
}

// ── Section ───────────────────────────────────────────────────────────────────

function Section({ title, icon, quotes }: { title: string; icon: string; quotes: GlobalQuote[] }) {
  if (!quotes.length) return null
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">{icon}</span>
        <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--artha-text-muted)' }}>{title}</h2>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {quotes.map(q => <QuoteCard key={q.symbol} q={q} />)}
      </div>
    </section>
  )
}

// ── Main client component ─────────────────────────────────────────────────────

export default function GlobalMarketsClient() {
  const [quotes, setQuotes]     = useState<GlobalQuote[]>([])
  const [lastTs, setLastTs]     = useState<number | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [tick, setTick]         = useState(0) // forces timeAgo re-render

  const fetchData = useCallback(async () => {
    try {
      const res  = await fetch('/api/global-markets')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setQuotes(json.quotes ?? [])
      setLastTs(json.ts ?? Date.now())
      setError(null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const id = setInterval(fetchData, REFRESH_INTERVAL)
    return () => clearInterval(id)
  }, [fetchData])

  // Tick every 10s to keep "X ago" fresh
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 10000)
    return () => clearInterval(id)
  }, [])

  if (loading) return (
    <div className="space-y-8">
      {[...Array(3)].map((_, i) => (
        <div key={i}>
          <div className="h-3 w-28 rounded mb-4" style={{ background: 'var(--artha-surface-low)' }} />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {[...Array(4)].map((_, j) => (
              <div key={j} className="artha-card px-4 py-4 h-24 animate-pulse" style={{ background: 'var(--artha-surface-low)' }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )

  const currency    = quotes.filter(q => q.group === 'currency')
  const indices     = quotes.filter(q => q.group === 'indices')
  const commodities = quotes.filter(q => q.group === 'commodities')

  // India-relevant context bar: USD/INR + crude
  const usdinr = quotes.find(q => q.symbol === 'USDINR=X')
  const brent  = quotes.find(q => q.symbol === 'BZ=F')
  const sp500  = quotes.find(q => q.symbol === '^GSPC')

  return (
    <div className="space-y-8">

      {/* Context bar — most India-relevant signals */}
      {(usdinr || brent || sp500) && (
        <div
          className="artha-card px-5 py-4 flex flex-wrap gap-6 items-center"
          style={{ background: 'linear-gradient(135deg, rgba(0,61,155,0.04), rgba(0,106,97,0.05))' }}
        >
          <div className="text-[10px] font-bold uppercase tracking-widest shrink-0" style={{ color: 'var(--artha-text-faint)' }}>
            Key signals
          </div>
          {[usdinr, brent, sp500].filter(Boolean).map(q => q && (
            <div key={q.symbol} className="flex items-center gap-2">
              <span className="text-sm">{q.flag}</span>
              <div>
                <div className="text-[10px]" style={{ color: 'var(--artha-text-faint)' }}>{q.name}</div>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-bold font-display" style={{ color: 'var(--artha-text)' }}>
                    {fmtPrice(q.price, q.currency, q.symbol)}
                  </span>
                  <span
                    className="text-[11px] font-bold font-mono"
                    style={{ color: q.changePct >= 0 ? 'var(--artha-teal)' : 'var(--artha-negative)' }}
                  >
                    {q.changePct >= 0 ? '+' : ''}{q.changePct.toFixed(2)}%
                  </span>
                </div>
              </div>
            </div>
          ))}
          <div className="ml-auto text-[10px] font-mono flex items-center gap-1.5" style={{ color: 'var(--artha-text-faint)' }}>
            {error
              ? <span style={{ color: 'var(--artha-negative)' }}>⚠ {error}</span>
              : lastTs ? <>
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Updated {timeAgo(lastTs)}
                </>
              : null
            }
          </div>
        </div>
      )}

      <Section title="Currency & FX"  icon="💱" quotes={currency} />
      <Section title="Global Indices" icon="🌐" quotes={indices} />
      <Section title="Commodities"    icon="⚡" quotes={commodities} />

    </div>
  )
}
