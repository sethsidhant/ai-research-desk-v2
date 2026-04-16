'use client'
// DashboardReturnCard — client components for Watchlist + Portfolio return cards.
// Recalculates total return % and P&L from live Kite prices so the big number
// stays in sync instead of being frozen at SSR-time DB value.

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { Sparkles, X } from 'lucide-react'

type OverviewBriefData = {
  sentiment: 'bull' | 'bear' | 'neutral'
  summary: string
  sections: {
    composition: string
    signals: string
    macro: string
    outlook: string
  }
}

const OV_SENTIMENT = {
  bull:    { bg: 'rgba(0,106,97,0.12)',     color: 'var(--artha-teal)',      label: 'Bullish'  },
  bear:    { bg: 'rgba(192,57,43,0.12)',    color: 'var(--artha-negative)',  label: 'Bearish'  },
  neutral: { bg: 'rgba(107,114,128,0.12)', color: 'var(--artha-text-muted)', label: 'Neutral' },
}

const OV_SECTIONS = [
  { key: 'composition' as const, label: 'Composition', icon: '🗂️' },
  { key: 'signals'     as const, label: 'Signals',     icon: '📡' },
  { key: 'macro'       as const, label: 'Macro',       icon: '🌐' },
  { key: 'outlook'     as const, label: 'Outlook',     icon: '🎯' },
]

function OverviewBriefModal({
  type,
  title,
  onClose,
}: {
  type: 'portfolio' | 'watchlist'
  title: string
  onClose: () => void
}) {
  const [brief,   setBrief]   = useState<OverviewBriefData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [cached,  setCached]  = useState(false)

  useEffect(() => {
    const cacheKey = `noesis_overview_brief_${type}`
    const today    = new Date().toISOString().slice(0, 10)
    try {
      const raw = sessionStorage.getItem(cacheKey)
      if (raw) {
        const data = JSON.parse(raw)
        if (data.date === today && data.brief) {
          setBrief(data.brief); setCached(true); return
        }
        sessionStorage.removeItem(cacheKey)
      }
    } catch {}
    fetchBrief()
  }, [type]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function fetchBrief() {
    setLoading(true); setError(null)
    try {
      const res  = await fetch('/api/overview-brief', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ type }),
      })
      const json = await res.json()
      if (json.error) { setError(json.error); return }
      const data: OverviewBriefData = typeof json.brief === 'string' ? JSON.parse(json.brief) : json.brief
      setBrief(data); setCached(json.cached ?? false)
      try {
        sessionStorage.setItem(`noesis_overview_brief_${type}`, JSON.stringify({ brief: data, date: new Date().toISOString().slice(0, 10) }))
      } catch {}
    } catch {
      setError('Failed to generate brief')
    } finally {
      setLoading(false)
    }
  }

  const s = OV_SENTIMENT[brief?.sentiment ?? 'neutral']

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: 'var(--artha-card)', border: '1px solid rgba(0,106,97,0.15)' }}
        onClick={e => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ background: 'linear-gradient(135deg, rgba(0,61,155,0.06), rgba(0,106,97,0.08))', borderBottom: '1px solid rgba(0,106,97,0.12)' }}
        >
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center rounded-xl" style={{ width: 32, height: 32, background: 'linear-gradient(135deg, #003d9b, #006a61)' }}>
              <Sparkles size={14} color="white" strokeWidth={2.5} />
            </div>
            <div>
              <div className="text-sm font-bold" style={{ color: 'var(--artha-text)', letterSpacing: '-0.01em' }}>{title}</div>
              <div className="text-[11px]" style={{ color: 'var(--artha-text-muted)' }}>AI Overview Brief</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {brief && (
              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full" style={{ background: s.bg, color: s.color }}>{s.label}</span>
            )}
            <button onClick={onClose} className="flex items-center justify-center rounded-full hover:bg-black/5 transition-colors" style={{ width: 28, height: 28, color: 'var(--artha-text-muted)' }}>
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm" style={{ color: 'var(--artha-text-muted)' }}>
              <span className="w-4 h-4 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
              Generating overview…
            </div>
          )}
          {error && <div className="text-sm py-6 text-center" style={{ color: 'var(--artha-negative)' }}>{error}</div>}
          {brief && (
            <>
              <div className="rounded-xl px-4 py-3" style={{ background: 'var(--artha-surface-low)', border: '1px solid rgba(11,28,48,0.06)' }}>
                <div className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--artha-teal)' }}>Summary</div>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--artha-text-secondary)' }}>{brief.summary}</p>
              </div>
              {OV_SECTIONS.map(({ key, label, icon }) => brief.sections[key] && (
                <div key={key} className="flex gap-3 rounded-xl px-4 py-3" style={{ background: 'var(--artha-surface-low)', border: '1px solid rgba(11,28,48,0.06)' }}>
                  <div className="shrink-0 text-base leading-snug mt-0.5">{icon}</div>
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--artha-teal)' }}>{label}</div>
                    <div className="text-sm leading-relaxed" style={{ color: 'var(--artha-text-secondary)' }}>{brief.sections[key]}</div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="px-5 pb-4 text-[10px] text-center" style={{ color: 'var(--artha-text-faint)' }}>
          {cached ? 'Cached today · ' : ''}Generated by Noesis AI · Haiku · Not investment advice
        </div>
      </div>
    </div>
  )
}

type WatchRow = { ticker: string; invested: number; entryPrice: number }
type PortRow  = { ticker: string; quantity: number; avgPrice: number; price5dAgo?: number | null }

type LivePrices = Record<string, { change: number; last: number }>

// Semi-circle arc gauge. Range: -30% to +30% P&L.
// Uses TWO 90° arcs (left quarter + right quarter) to avoid SVG 180° arc ambiguity.
// cx=52, cy=52, r=42. Left=(10,52) Top=(52,10) Right=(94,52).
function ArcGauge({ pct }: { pct: number }) {
  const cx = 52, cy = 52, r = 42
  const totalLen = Math.PI * r  // ≈ 131.9
  const minPct = -30, maxPct = 30
  const t = Math.max(0, Math.min(1, (pct - minPct) / (maxPct - minPct)))
  const filled = t * totalLen
  const color  = pct >= 0 ? '#006a61' : '#c0392b'

  // Two-arc path: left-bottom → top → right-bottom (both sweep=0, 90° each)
  const arcPath = `M ${cx - r} ${cy} A ${r} ${r} 0 0 0 ${cx} ${cy - r} A ${r} ${r} 0 0 0 ${cx + r} ${cy}`

  // Needle
  const angle = (1 - t) * Math.PI
  const nr = r - 12
  const nx = cx + nr * Math.cos(angle)
  const ny = cy - nr * Math.sin(angle)

  // Tick dots at inner radius (visible without clipping)
  const tickDots = [0, 0.5, 1].map(tv => {
    const ta = (1 - tv) * Math.PI
    const tr = r - 6
    return { x: cx + tr * Math.cos(ta), y: cy - tr * Math.sin(ta) }
  })

  // viewBox: x 4→100, y 4→60 — all stroke edges have ≥4px clearance
  return (
    <svg width="104" height="60" viewBox="4 4 96 56" style={{ flexShrink: 0 }}>
      {/* Track — #9ca3af clearly visible on white (#fff), contrast ~2.8:1 */}
      <path d={arcPath} fill="none" stroke="#9ca3af" strokeWidth="8" strokeLinecap="round" />
      {/* Fill — draws over track from left, length = t * totalLen */}
      <path d={arcPath} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
        strokeDasharray={`${filled} ${totalLen}`} />
      {/* Tick dots */}
      {tickDots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r="2" fill="white" opacity="0.8" />
      ))}
      {/* Needle */}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      {/* Pivot */}
      <circle cx={cx} cy={cy} r="4" fill={color} />
      <circle cx={cx} cy={cy} r="1.8" fill="white" />
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
  const [prices, setPrices]   = useState<LivePrices | null>(null)
  const [briefOpen, setBriefOpen] = useState(false)

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
    <>
    {briefOpen && <OverviewBriefModal type="watchlist" title="Watchlist" onClose={() => setBriefOpen(false)} />}
    <Link href="/watchlist" className="artha-card artha-card-hover block overflow-hidden" style={{ padding: 0 }}>
      <div className="h-1 w-full" style={{ background: hasData ? accentColor : 'var(--artha-surface-low)' }} />
      <div className="px-5 py-4">
        <div className="flex items-center justify-between mb-3">
          <span className="artha-label">Watchlist Return</span>
          <div className="flex items-center gap-2">
            <button
              onClick={e => { e.preventDefault(); e.stopPropagation(); setBriefOpen(true) }}
              title="AI Overview"
              className="flex items-center justify-center rounded-lg transition-colors hover:opacity-80"
              style={{ width: 24, height: 24, background: 'linear-gradient(135deg, rgba(0,61,155,0.1), rgba(0,106,97,0.1))', color: 'var(--artha-teal)' }}
            >
              <Sparkles size={11} strokeWidth={2.5} />
            </button>
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: 'var(--artha-surface-low)', color: 'var(--artha-text-muted)' }}>
              {watchlistCount} stocks
            </span>
          </div>
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
    </>
  )
}

export function PortfolioReturnCard({ rows }: { rows: PortRow[] }) {
  const [prices, setPrices]       = useState<LivePrices | null>(null)
  const [briefOpen, setBriefOpen] = useState(false)

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
    <>
    {briefOpen && <OverviewBriefModal type="portfolio" title="Portfolio" onClose={() => setBriefOpen(false)} />}
    <Link href="/portfolio" className="artha-card artha-card-hover block overflow-hidden" style={{ padding: 0 }}>
      <div className="h-1 w-full" style={{ background: hasHoldings ? accentColor : 'var(--artha-surface-low)' }} />
      <div className="px-5 py-4">
        <div className="flex items-center justify-between mb-3">
          <span className="artha-label">Portfolio Return</span>
          <div className="flex items-center gap-2">
            <button
              onClick={e => { e.preventDefault(); e.stopPropagation(); setBriefOpen(true) }}
              title="AI Overview"
              className="flex items-center justify-center rounded-lg transition-colors hover:opacity-80"
              style={{ width: 24, height: 24, background: 'linear-gradient(135deg, rgba(0,61,155,0.1), rgba(0,106,97,0.1))', color: 'var(--artha-teal)' }}
            >
              <Sparkles size={11} strokeWidth={2.5} />
            </button>
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: 'var(--artha-surface-low)', color: 'var(--artha-text-muted)' }}>
              {rows.length} holdings
            </span>
          </div>
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
    </>
  )
}
