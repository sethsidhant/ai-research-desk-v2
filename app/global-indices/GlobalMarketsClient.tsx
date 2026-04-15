'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'
import type { GlobalQuote } from '@/app/api/global-markets/route'
import type { IndexQuote, StockTile } from '@/app/api/market-indices/route'

const REFRESH_GLOBAL = 60 * 1000
const REFRESH_KITE   = 15 * 1000

// Kite instrument tokens for Indian index charts (sourced from Kite instruments CSV).
// Indian indices use Kite historical API — not Yahoo Finance (blocked from Vercel IPs).
const KITE_TOKENS: Record<string, number> = {
  'NIFTY 50':    256265,
  'NIFTY 500':   268041,
  'BANK NIFTY':  260105,
  'SENSEX':      265,       // BSE token
  'MIDCAP 100':  256777,
  'SMALLCAP 100':267017,
  'IT':          259849,
  'PHARMA':      262409,
  'AUTO':        263433,
  'FMCG':        261897,
  'METAL':       263689,
}

// Which Kite labels have constituent heatmaps
const HEATMAP_TYPE: Record<string, 'nifty50' | 'banknifty'> = {
  'NIFTY 50':   'nifty50',
  'BANK NIFTY': 'banknifty',
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtPrice(price: number, currency: string, symbol: string): string {
  if (symbol === 'USDINR=X') return `₹${price.toFixed(2)}`
  if (currency === 'INR')    return `₹${price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
  if (symbol === 'DX-Y.NYB') return price.toFixed(2)
  if (['GC=F', 'SI=F'].includes(symbol)) return `$${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
  if (['CL=F', 'BZ=F'].includes(symbol)) return `$${price.toFixed(2)}`
  if (price > 10000) return price.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (price > 1000)  return price.toLocaleString('en-US', { maximumFractionDigits: 2 })
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

function fmtKitePrice(p: number): string {
  if (p >= 10000) return p.toLocaleString('en-IN', { maximumFractionDigits: 0 })
  return p.toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 10)  return 'just now'
  if (s < 60)  return `${s}s ago`
  if (s < 120) return '1m ago'
  return `${Math.floor(s / 60)}m ago`
}

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

// ── RSI (Wilder's 14-period) ──────────────────────────────────────────────────

function calcRSI(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null
  let avgGain = 0, avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d > 0) avgGain += d; else avgLoss += Math.abs(d)
  }
  avgGain /= period
  avgLoss /= period
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    avgGain = (avgGain * (period - 1) + Math.max(0, d)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -d)) / period
  }
  if (avgLoss === 0) return 100
  return parseFloat((100 - 100 / (1 + avgGain / avgLoss)).toFixed(1))
}

// ── RSI display ───────────────────────────────────────────────────────────────

function RSIDisplay({ rsi }: { rsi: number }) {
  const label  = rsi < 30 ? 'Oversold' : rsi > 70 ? 'Overbought' : 'Neutral'
  const color  = rsi < 30 ? '#003d9b' : rsi > 70 ? '#b45309' : '#006a61'
  const barBg  = rsi < 30 ? 'rgba(0,61,155,0.12)' : rsi > 70 ? 'rgba(180,83,9,0.12)' : 'rgba(0,106,97,0.1)'
  return (
    <div>
      <div className="artha-label mb-2">RSI · 14d</div>
      <div className="flex items-end gap-2 mb-2">
        <span className="font-display font-bold text-3xl leading-none" style={{ color, letterSpacing: '-0.03em' }}>
          {rsi.toFixed(1)}
        </span>
        <span className="text-xs mb-0.5 font-semibold" style={{ color }}>{label}</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--artha-surface-low)' }}>
        <div style={{ width: `${rsi}%`, background: color, height: '100%', borderRadius: '999px', transition: 'width 0.4s ease' }} />
      </div>
      <div className="flex justify-between text-[9px] mt-1" style={{ color: 'var(--artha-text-faint)' }}>
        <span>0</span><span>30</span><span>70</span><span>100</span>
      </div>
    </div>
  )
}

// ── Mini area chart ───────────────────────────────────────────────────────────

function MiniChart({ closes, changePct }: { closes: { date: string; close: number }[]; changePct: number }) {
  if (closes.length < 2) return (
    <div className="flex items-center justify-center h-full" style={{ color: 'var(--artha-text-faint)', fontSize: 12 }}>
      No chart data
    </div>
  )
  const up     = changePct >= 0
  const color  = up ? '#006a61' : '#c0392b'
  const gradId = `cg-${Math.random().toString(36).slice(2, 7)}`

  // Sparse x-axis ticks: first, middle, last
  const ticks = [
    closes[0].date,
    closes[Math.floor(closes.length / 2)].date,
    closes[closes.length - 1].date,
  ]

  const vals = closes.map(c => c.close)
  const min  = Math.min(...vals)
  const max  = Math.max(...vals)
  const pad  = (max - min) * 0.15
  const domain: [number, number] = [min - pad, max + pad]

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={closes} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={color} stopOpacity={0.2} />
            <stop offset="100%" stopColor={color} stopOpacity={0.01} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="date"
          ticks={ticks}
          tickFormatter={fmtDate}
          tick={{ fontSize: 8, fill: '#9ca3af', fontFamily: 'inherit' }}
          axisLine={false} tickLine={false}
        />
        <YAxis domain={domain} hide />
        <Tooltip
          contentStyle={{
            background: '#0f2133', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8, padding: '6px 10px', fontSize: 10, color: '#e5e7eb',
          }}
          formatter={(val: any) => [val.toLocaleString('en-IN', { maximumFractionDigits: 2 }), 'Close']}
          labelFormatter={(label) => fmtDate(String(label))}
          cursor={{ stroke: 'rgba(11,28,48,0.15)', strokeWidth: 1 }}
        />
        <Area
          type="monotone"
          dataKey="close"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#${gradId})`}
          dot={false}
          activeDot={{ r: 3, fill: color, stroke: 'white', strokeWidth: 1.5 }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// ── Stock tile heatmap ────────────────────────────────────────────────────────

function StockHeatmap({ tiles, label }: { tiles: StockTile[]; label: string }) {
  return (
    <div className="mt-4 pt-3" style={{ borderTop: '1px solid var(--artha-surface-low)' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="artha-label">{label} Constituents</span>
        <span className="text-[9px]" style={{ color: 'var(--artha-text-faint)' }}>
          {tiles.filter(t => t.changePct > 0).length}↑ · {tiles.filter(t => t.changePct < 0).length}↓
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {tiles.map(t => {
          const up  = t.changePct >= 0
          const big = Math.abs(t.changePct) >= 1.5
          const bg  = up
            ? (big ? 'rgba(0,106,97,0.85)' : 'rgba(0,106,97,0.18)')
            : (big ? 'rgba(192,57,43,0.82)' : 'rgba(192,57,43,0.14)')
          const fg  = up
            ? (big ? '#ffffff' : '#005048')
            : (big ? '#ffffff' : '#a02020')
          return (
            <div key={t.sym}
              className="rounded px-1.5 py-1 text-center"
              style={{ background: bg, minWidth: 52 }}>
              <div className="font-mono font-bold text-[8px]" style={{ color: fg }}>{t.sym}</div>
              <div className="font-mono text-[9px]" style={{ color: fg }}>
                {t.changePct >= 0 ? '+' : ''}{t.changePct.toFixed(1)}%
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Index detail panel ────────────────────────────────────────────────────────

function IndexDetailPanel({
  name, flag, changePct, kiteToken, yahooSymbol,
  heatmapTiles, heatmapLabel,
  onClose,
}: {
  name: string
  flag?: string
  changePct: number
  kiteToken?: number | null      // for Indian indices → Kite historical API
  yahooSymbol?: string | null    // for global indices → Yahoo Finance
  heatmapTiles?: StockTile[] | null
  heatmapLabel?: string
  onClose: () => void
}) {
  const [closes, setCloses]         = useState<{ date: string; close: number }[]>([])
  const [loading, setLoading]       = useState(true)
  const [chartError, setChartError] = useState(false)

  const hasChart = !!(kiteToken || yahooSymbol)

  useEffect(() => {
    if (!hasChart) { setLoading(false); return }
    setLoading(true)
    setCloses([])
    setChartError(false)
    const url = kiteToken
      ? `/api/index-chart?token=${kiteToken}`
      : `/api/index-chart?symbol=${encodeURIComponent(yahooSymbol!)}`
    fetch(url)
      .then(r => r.json())
      .then(d => {
        if (d.closes?.length) setCloses(d.closes)
        else setChartError(true)
      })
      .catch(() => setChartError(true))
      .finally(() => setLoading(false))
  }, [kiteToken, yahooSymbol, hasChart])

  const rsi = calcRSI(closes.map(c => c.close))
  const up  = changePct >= 0

  return (
    <div
      className="artha-card mt-3 overflow-hidden"
      style={{
        padding: 0,
        borderTop: `3px solid ${up ? '#006a61' : '#c0392b'}`,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3"
        style={{ borderBottom: '1px solid var(--artha-surface-low)' }}>
        <div className="flex items-center gap-2">
          {flag && <span className="text-lg">{flag}</span>}
          <span className="font-display font-bold text-sm" style={{ color: 'var(--artha-text)' }}>{name}</span>
          <span
            className="font-mono font-bold text-xs px-2 py-0.5 rounded-full"
            style={{
              background: up ? '#e6f4f2' : '#fef2f2',
              color: up ? '#006a61' : '#c0392b',
            }}
          >
            {up ? '+' : ''}{changePct.toFixed(2)}%
          </span>
          {hasChart && (
            <span className="text-[9px] font-mono" style={{ color: 'var(--artha-text-faint)' }}>3M</span>
          )}
        </div>
        <button onClick={onClose}
          className="text-xs px-2 py-0.5 rounded"
          style={{ color: 'var(--artha-text-faint)', background: 'var(--artha-surface-low)' }}>
          ✕
        </button>
      </div>

      {/* Chart + RSI */}
      <div className="px-4 py-4">
        {loading ? (
          <div className="h-36 rounded animate-pulse" style={{ background: 'var(--artha-surface-low)' }} />
        ) : chartError || !hasChart ? (
          <div className="h-36 flex items-center justify-center text-sm"
            style={{ color: 'var(--artha-text-faint)' }}>
            {!hasChart ? 'No chart available for this index' : 'Chart unavailable'}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-start">
            {/* Chart — 3/4 width on desktop */}
            <div className="sm:col-span-3" style={{ height: 160 }}>
              <MiniChart closes={closes} changePct={changePct} />
            </div>

            {/* RSI — 1/4 width */}
            <div className="sm:col-span-1 flex flex-col justify-center sm:pt-2">
              {rsi != null ? (
                <RSIDisplay rsi={rsi} />
              ) : (
                <div className="text-xs" style={{ color: 'var(--artha-text-faint)' }}>
                  RSI needs 15+ data points
                </div>
              )}
            </div>
          </div>
        )}

        {/* Constituent heatmap (Nifty50 + BankNifty only) */}
        {heatmapTiles && heatmapTiles.length > 0 && heatmapLabel && (
          <StockHeatmap tiles={heatmapTiles} label={heatmapLabel} />
        )}
      </div>
    </div>
  )
}

// ── Clickable quote card ──────────────────────────────────────────────────────

function QuoteCard({
  name, price, change, changePct, currency, symbol, flag,
  selected, onClick,
}: GlobalQuote & { selected: boolean; onClick: () => void }) {
  const positive    = changePct >= 0
  const zero        = change === 0
  const accentColor = zero ? 'var(--artha-text-faint)' : positive ? 'var(--artha-teal)' : 'var(--artha-negative)'
  const accentBg    = zero ? 'var(--artha-surface-low)' : positive ? 'var(--artha-teal-subtle)' : 'var(--artha-negative-bg)'

  return (
    <div
      onClick={onClick}
      className="artha-card px-4 py-4 flex flex-col gap-2 overflow-hidden relative cursor-pointer artha-card-hover"
      style={{
        borderTop: `2px solid ${selected ? accentColor : (zero ? 'var(--artha-surface-low)' : accentColor)}`,
        boxShadow: selected ? `0 0 0 2px ${positive ? 'rgba(0,106,97,0.3)' : 'rgba(192,57,43,0.25)'}` : undefined,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {flag && <span className="text-sm leading-none">{flag}</span>}
            <span className="text-xs font-bold truncate" style={{ color: 'var(--artha-text)' }}>{name}</span>
          </div>
        </div>
        <span className="shrink-0 text-[11px] font-bold font-mono px-2 py-0.5 rounded-full"
          style={{ background: accentBg, color: accentColor }}>
          {positive && !zero ? '+' : ''}{changePct.toFixed(2)}%
        </span>
      </div>
      <div className="font-display font-bold text-xl leading-none"
        style={{ color: 'var(--artha-text)', letterSpacing: '-0.02em' }}>
        {fmtPrice(price, currency, symbol)}
      </div>
      <div className="text-xs font-mono" style={{ color: accentColor }}>
        {zero ? '—' : fmtChange(change, currency, symbol)}
      </div>
      {selected && (
        <div className="absolute bottom-1.5 right-2 text-[9px]" style={{ color: 'var(--artha-text-faint)' }}>
          chart ▾
        </div>
      )}
    </div>
  )
}

// ── Kite index card ───────────────────────────────────────────────────────────

function KiteCard({
  label, last, changePct, group, flag,
  selected, onClick,
}: {
  label: string; last: number; changePct: number; group: string; flag?: string
  selected: boolean; onClick: () => void
}) {
  if (group === 'gift' || group === 'vix') {
    // Compact display for GIFT NIFTY and VIX
    const up = changePct >= 0
    return (
      <div onClick={onClick}
        className="artha-card px-4 py-3 cursor-pointer artha-card-hover"
        style={{ borderTop: `2px solid ${up ? '#006a61' : '#c0392b'}` }}>
        <div className="flex items-center justify-between">
          <div className="text-xs font-bold" style={{ color: 'var(--artha-text-muted)' }}>{label}</div>
          <span className="text-[11px] font-mono font-bold px-1.5 py-0.5 rounded-full"
            style={{ background: up ? '#e6f4f2' : '#fef2f2', color: up ? '#006a61' : '#c0392b' }}>
            {up ? '+' : ''}{changePct.toFixed(2)}%
          </span>
        </div>
        <div className="font-display font-bold text-lg mt-1" style={{ color: 'var(--artha-text)', letterSpacing: '-0.02em' }}>
          {fmtKitePrice(last)}
        </div>
      </div>
    )
  }

  const up = changePct >= 0
  return (
    <div onClick={onClick}
      className="artha-card px-4 py-4 flex flex-col gap-2 cursor-pointer artha-card-hover"
      style={{
        borderTop: `2px solid ${up ? '#006a61' : '#c0392b'}`,
        boxShadow: selected ? `0 0 0 2px ${up ? 'rgba(0,106,97,0.3)' : 'rgba(192,57,43,0.25)'}` : undefined,
      }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {flag && <span className="text-sm leading-none">{flag}</span>}
          <span className="text-xs font-bold" style={{ color: 'var(--artha-text)' }}>{label}</span>
        </div>
        <span className="shrink-0 text-[11px] font-bold font-mono px-2 py-0.5 rounded-full"
          style={{ background: up ? '#e6f4f2' : '#fef2f2', color: up ? '#006a61' : '#c0392b' }}>
          {up ? '+' : ''}{changePct.toFixed(2)}%
        </span>
      </div>
      <div className="font-display font-bold text-xl leading-none"
        style={{ color: 'var(--artha-text)', letterSpacing: '-0.02em' }}>
        {fmtKitePrice(last)}
      </div>
      {KITE_TOKENS[label] && (
        <div className="text-[9px]" style={{ color: 'var(--artha-text-faint)' }}>
          {HEATMAP_TYPE[label]
            ? (label === 'NIFTY 50' ? '50 stocks · heatmap · chart' : '12 stocks · heatmap · chart')
            : 'chart · RSI'}
        </div>
      )}
      {selected && (
        <div className="absolute bottom-1.5 right-2 text-[9px]" style={{ color: 'var(--artha-text-faint)' }}>
          chart ▾
        </div>
      )}
    </div>
  )
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({
  title, icon, quotes, selectedSymbol, onSelect,
}: {
  title: string; icon: string; quotes: GlobalQuote[]
  selectedSymbol: string | null; onSelect: (sym: string) => void
}) {
  if (!quotes.length) return null
  const sel = quotes.find(q => q.symbol === selectedSymbol) ?? null

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">{icon}</span>
        <h2 className="text-xs font-bold uppercase tracking-widest"
          style={{ color: 'var(--artha-text-muted)' }}>{title}</h2>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {quotes.map(q => (
          <QuoteCard key={q.symbol} {...q}
            selected={q.symbol === selectedSymbol}
            onClick={() => onSelect(q.symbol === selectedSymbol ? '' : q.symbol)}
          />
        ))}
      </div>
      {sel && (
        <IndexDetailPanel
          name={sel.name}
          flag={sel.flag}
          changePct={sel.changePct}
          yahooSymbol={sel.symbol}
          onClose={() => onSelect('')}
        />
      )}
    </section>
  )
}

// ── Indian Indices section ────────────────────────────────────────────────────

const KITE_FLAGS: Record<string, string> = {
  'NIFTY 50':    '🇮🇳',
  'SENSEX':      '🇮🇳',
  'BANK NIFTY':  '🏦',
  'NIFTY 500':   '🇮🇳',
  'MIDCAP 100':  '📈',
  'SMALLCAP 100':'📊',
}

const BROAD_LABELS  = ['NIFTY 50', 'SENSEX', 'BANK NIFTY', 'NIFTY 500', 'MIDCAP 100', 'SMALLCAP 100']
const SECTOR_LABELS = ['IT', 'PHARMA', 'AUTO', 'FMCG', 'METAL']

const SECTOR_ICONS: Record<string, string> = {
  'IT':     '💻',
  'PHARMA': '💊',
  'AUTO':   '🚗',
  'FMCG':   '🛒',
  'METAL':  '🔩',
}

function IndianSection({
  indices, tiles, bankTiles, selectedId, onSelect,
}: {
  indices: IndexQuote[]
  tiles: StockTile[]
  bankTiles: StockTile[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const broad   = indices.filter(i => BROAD_LABELS.includes(i.name))
  const sectors = indices.filter(i => SECTOR_LABELS.includes(i.name))
  const gift    = indices.find(i => i.group === 'gift')
  const vix     = indices.find(i => i.group === 'vix')

  // Selected index — broad or sector (same logic, just scoped to what we can show a panel for)
  const selIndex = [...broad, ...sectors].find(i => i.name === selectedId) ?? null

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">🇮🇳</span>
        <h2 className="text-xs font-bold uppercase tracking-widest"
          style={{ color: 'var(--artha-text-muted)' }}>Indian Markets</h2>
      </div>

      {/* Broad indices grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 mb-3">
        {broad.map(idx => (
          <KiteCard key={idx.name}
            label={idx.name} last={idx.last} changePct={idx.changePct} group={idx.group}
            flag={KITE_FLAGS[idx.name]}
            selected={idx.name === selectedId}
            onClick={() => onSelect(idx.name === selectedId ? '' : idx.name)}
          />
        ))}
        {/* GIFT NIFTY + VIX compact */}
        {gift && (
          <KiteCard label={gift.name} last={gift.last} changePct={gift.changePct} group={gift.group}
            selected={gift.name === selectedId}
            onClick={() => onSelect(gift.name === selectedId ? '' : gift.name)} />
        )}
        {vix && (
          <KiteCard label={vix.name} last={vix.last} changePct={vix.changePct} group={vix.group}
            selected={vix.name === selectedId}
            onClick={() => onSelect(vix.name === selectedId ? '' : vix.name)} />
        )}
      </div>

      {/* Sector indices — clickable pills */}
      {sectors.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {sectors.map(idx => {
            const up       = idx.changePct >= 0
            const sel      = idx.name === selectedId
            const color    = up ? '#006a61' : '#c0392b'
            const bgNormal = up ? 'rgba(0,106,97,0.12)' : 'rgba(192,57,43,0.10)'
            const bgSel    = up ? 'rgba(0,106,97,0.28)' : 'rgba(192,57,43,0.24)'
            return (
              <button
                key={idx.name}
                onClick={() => onSelect(idx.name === selectedId ? '' : idx.name)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={{
                  background: sel ? bgSel : bgNormal,
                  color,
                  outline: sel ? `2px solid ${color}` : 'none',
                  outlineOffset: '1px',
                  cursor: 'pointer',
                }}
              >
                {SECTOR_ICONS[idx.name] && <span>{SECTOR_ICONS[idx.name]}</span>}
                {idx.name}
                <span className="font-mono font-bold">
                  {up ? '+' : ''}{idx.changePct.toFixed(2)}%
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Detail panel — shared for broad + sector */}
      {selIndex && (
        <IndexDetailPanel
          name={selIndex.name}
          flag={KITE_FLAGS[selIndex.name] ?? SECTOR_ICONS[selIndex.name]}
          changePct={selIndex.changePct}
          kiteToken={KITE_TOKENS[selIndex.name] ?? null}
          heatmapTiles={
            HEATMAP_TYPE[selIndex.name] === 'nifty50' ? tiles :
            HEATMAP_TYPE[selIndex.name] === 'banknifty' ? bankTiles : null
          }
          heatmapLabel={selIndex.name}
          onClose={() => onSelect('')}
        />
      )}
    </section>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function GlobalMarketsClient() {
  const [globalQuotes, setGlobalQuotes] = useState<GlobalQuote[]>([])
  const [kiteIndices, setKiteIndices]   = useState<IndexQuote[]>([])
  const [kiteTiles, setKiteTiles]       = useState<StockTile[]>([])
  const [bankTiles, setBankTiles]       = useState<StockTile[]>([])
  const [lastTs, setLastTs]             = useState<number | null>(null)
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState<string | null>(null)
  const [selectedId, setSelectedId]     = useState<string | null>(null)
  const [tick, setTick]                 = useState(0)

  const fetchGlobal = useCallback(async () => {
    try {
      const res  = await fetch('/api/global-markets')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setGlobalQuotes(json.quotes ?? [])
      setLastTs(json.ts ?? Date.now())
      setError(null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchKite = useCallback(async () => {
    try {
      const res  = await fetch('/api/market-indices')
      if (!res.ok) return
      const json = await res.json()
      if (json.indices) setKiteIndices(json.indices)
      if (json.tiles)   setKiteTiles(json.tiles)
      if (json.bankTiles) setBankTiles(json.bankTiles)
    } catch {}
  }, [])

  useEffect(() => {
    fetchGlobal()
    fetchKite()
    const g = setInterval(fetchGlobal, REFRESH_GLOBAL)
    const k = setInterval(fetchKite,   REFRESH_KITE)
    return () => { clearInterval(g); clearInterval(k) }
  }, [fetchGlobal, fetchKite])

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 10000)
    return () => clearInterval(id)
  }, [])

  // Close panel when clicking same card (toggle)
  const handleSelect = (id: string) => setSelectedId(id || null)

  if (loading) return (
    <div className="space-y-8">
      {[...Array(3)].map((_, i) => (
        <div key={i}>
          <div className="h-3 w-28 rounded mb-4" style={{ background: 'var(--artha-surface-low)' }} />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {[...Array(5)].map((_, j) => (
              <div key={j} className="artha-card px-4 py-4 h-24 animate-pulse"
                style={{ background: 'var(--artha-surface-low)' }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )

  const currency    = globalQuotes.filter(q => q.group === 'currency')
  const indices     = globalQuotes.filter(q => q.group === 'indices')
  const commodities = globalQuotes.filter(q => q.group === 'commodities')

  const usdinr = globalQuotes.find(q => q.symbol === 'USDINR=X')
  const brent  = globalQuotes.find(q => q.symbol === 'BZ=F')
  const sp500  = globalQuotes.find(q => q.symbol === '^GSPC')

  return (
    <div className="space-y-8">

      {/* Context bar */}
      {(usdinr || brent || sp500) && (
        <div className="artha-card px-5 py-4 flex flex-wrap gap-6 items-center"
          style={{ background: 'linear-gradient(135deg, rgba(0,61,155,0.04), rgba(0,106,97,0.05))' }}>
          <div className="text-[10px] font-bold uppercase tracking-widest shrink-0"
            style={{ color: 'var(--artha-text-faint)' }}>
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
                  <span className="text-[11px] font-bold font-mono"
                    style={{ color: q.changePct >= 0 ? 'var(--artha-teal)' : 'var(--artha-negative)' }}>
                    {q.changePct >= 0 ? '+' : ''}{q.changePct.toFixed(2)}%
                  </span>
                </div>
              </div>
            </div>
          ))}
          <div className="ml-auto text-[10px] font-mono flex items-center gap-1.5"
            style={{ color: 'var(--artha-text-faint)' }}>
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

      {/* Indian indices */}
      {kiteIndices.length > 0 && (
        <IndianSection
          indices={kiteIndices}
          tiles={kiteTiles}
          bankTiles={bankTiles}
          selectedId={selectedId}
          onSelect={handleSelect}
        />
      )}

      <Section title="Global Indices" icon="🌐" quotes={indices}
        selectedSymbol={selectedId} onSelect={handleSelect} />
      <Section title="Currency & FX"  icon="💱" quotes={currency}
        selectedSymbol={selectedId} onSelect={handleSelect} />
      <Section title="Commodities"    icon="⚡" quotes={commodities}
        selectedSymbol={selectedId} onSelect={handleSelect} />

    </div>
  )
}
