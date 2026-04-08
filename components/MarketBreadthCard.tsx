import Link from 'next/link'

export type SignalGroup = {
  shortLabel: string
  type: 'oversold' | 'overbought' | 'below200' | 'below50' | 'high52w' | 'low52w'
  tickers: string[]
}

export type VolumeRow = {
  ticker: string
  ratio: number
  isPortfolio: boolean
}

type Props = {
  above200:        number
  below200:        number
  totalScored:     number
  totalStocks:     number
  oversold:        number
  overbought:      number
  signals:         SignalGroup[]
  volumeBreakouts: VolumeRow[]
}

const SIGNAL_STYLE: Record<SignalGroup['type'], { color: string; bg: string }> = {
  oversold:   { color: '#003d9b', bg: 'rgba(0,61,155,0.08)'  },
  overbought: { color: '#b45309', bg: 'rgba(180,83,9,0.08)'  },
  below200:   { color: '#c0392b', bg: 'rgba(192,57,43,0.08)' },
  below50:    { color: '#ea580c', bg: 'rgba(234,88,12,0.08)' },
  high52w:    { color: '#006a61', bg: 'rgba(0,106,97,0.08)'  },
  low52w:     { color: '#9b1c1c', bg: 'rgba(155,28,28,0.08)' },
}

export default function MarketBreadthCard({
  above200, below200, totalScored, totalStocks,
  oversold, overbought, signals, volumeBreakouts,
}: Props) {
  const neutral   = Math.max(0, totalScored - oversold - overbought)
  const abovePct  = totalScored > 0 ? Math.round((above200 / totalScored) * 100) : 0

  const healthColor  = abovePct >= 60 ? '#006a61' : abovePct >= 40 ? '#b45309' : '#c0392b'
  const healthBg     = abovePct >= 60 ? '#e6f4f2' : abovePct >= 40 ? '#fffbeb' : '#fef2f2'
  const healthLabel  = abovePct >= 70 ? 'Strong' : abovePct >= 50 ? 'Moderate' : abovePct >= 30 ? 'Weak' : 'Bearish'

  const rsOversold   = totalScored > 0 ? (oversold   / totalScored) * 100 : 0
  const rsNeutral    = totalScored > 0 ? (neutral    / totalScored) * 100 : 0
  const rsOverbought = totalScored > 0 ? (overbought / totalScored) * 100 : 0

  // Arc gauge
  const cx = 40, cy = 40, r = 32
  const totalLen = Math.PI * r
  const t        = totalScored > 0 ? above200 / totalScored : 0
  const filled   = t * totalLen
  const arcPath  = `M ${cx - r} ${cy} A ${r} ${r} 0 0 0 ${cx} ${cy - r} A ${r} ${r} 0 0 0 ${cx + r} ${cy}`
  const angle    = (1 - t) * Math.PI
  const nr       = r - 9
  const nx       = cx + nr * Math.cos(angle)
  const ny       = cy - nr * Math.sin(angle)
  const tickDots = [0, 0.5, 1].map(tv => {
    const ta = (1 - tv) * Math.PI
    const tr = r - 5
    return { x: cx + tr * Math.cos(ta), y: cy - tr * Math.sin(ta) }
  })

  // Volume bar max
  const maxRatio = volumeBreakouts.length > 0 ? Math.max(...volumeBreakouts.map(v => v.ratio)) : 1

  return (
    <div className="artha-card overflow-hidden" style={{ padding: 0 }}>
      <div className="h-1 w-full" style={{ background: healthColor }} />
      <div className="px-5 py-4">

        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <span className="artha-label">Market Breadth</span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{ background: healthBg, color: healthColor }}>
              {healthLabel}
            </span>
            <Link href="/watchlist"
              className="text-[10px] font-semibold px-2 py-0.5 rounded"
              style={{ background: 'var(--artha-surface-low)', color: 'var(--artha-text-muted)' }}>
              Watchlist →
            </Link>
          </div>
        </div>

        {totalScored === 0 ? (
          <div className="text-sm py-2" style={{ color: 'var(--artha-text-muted)' }}>No score data yet</div>
        ) : (
          <>
            {/* Gauge + DMA count */}
            <div className="flex items-center justify-between gap-2 mb-1">
              <div>
                <div className="font-display font-bold text-3xl leading-none"
                  style={{ color: healthColor, letterSpacing: '-0.03em' }}>
                  {above200}<span className="text-lg font-semibold"
                    style={{ color: 'var(--artha-text-muted)' }}>/{totalScored}</span>
                </div>
                <div className="text-xs mt-1.5" style={{ color: 'var(--artha-text-muted)' }}>above 200 DMA</div>
                <div className="text-[11px] mt-0.5" style={{ color: 'var(--artha-text-faint)' }}>
                  {below200} below · {totalStocks - totalScored > 0
                    ? `${totalStocks - totalScored} unscored`
                    : `${totalStocks} tracked`}
                </div>
              </div>
              <svg width="80" height="46" viewBox="3 3 74 42" style={{ flexShrink: 0 }}>
                <path d={arcPath} fill="none" stroke="#9ca3af" strokeWidth="6" strokeLinecap="round" />
                <path d={arcPath} fill="none" stroke={healthColor} strokeWidth="6" strokeLinecap="round"
                  strokeDasharray={`${filled} ${totalLen}`} />
                {tickDots.map((d, i) => (
                  <circle key={i} cx={d.x} cy={d.y} r="1.8" fill="white" opacity="0.85" />
                ))}
                <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={healthColor} strokeWidth="2" strokeLinecap="round" />
                <circle cx={cx} cy={cy} r="3.5" fill={healthColor} />
                <circle cx={cx} cy={cy} r="1.4" fill="white" />
              </svg>
            </div>

            {/* RSI distribution */}
            <div className="mt-3 pt-2.5" style={{ borderTop: '1px solid var(--artha-surface-low)' }}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="artha-label">RSI Distribution</span>
                <div className="flex gap-2.5 text-[10px]" style={{ color: 'var(--artha-text-faint)' }}>
                  {oversold   > 0 && <span style={{ color: '#003d9b' }}>{oversold} oversold</span>}
                  {overbought > 0 && <span style={{ color: '#b45309' }}>{overbought} overbought</span>}
                  {oversold === 0 && overbought === 0 && <span>all neutral</span>}
                </div>
              </div>
              <div className="flex h-2 rounded-full overflow-hidden gap-px">
                {rsOversold > 0 && (
                  <div style={{ width: `${rsOversold}%`, background: 'rgba(0,61,155,0.5)', borderRadius: '4px 0 0 4px' }} />
                )}
                {rsNeutral > 0 && (
                  <div style={{
                    width: `${rsNeutral}%`,
                    background: 'rgba(11,28,48,0.12)',
                    borderRadius: rsOversold === 0 ? '4px 0 0 4px' : rsOverbought === 0 ? '0 4px 4px 0' : undefined,
                  }} />
                )}
                {rsOverbought > 0 && (
                  <div style={{ width: `${rsOverbought}%`, background: 'rgba(180,83,9,0.5)', borderRadius: '0 4px 4px 0' }} />
                )}
              </div>
              <div className="flex justify-between text-[9px] mt-1" style={{ color: 'var(--artha-text-faint)' }}>
                <span>Oversold &lt;30</span>
                <span>Neutral</span>
                <span>Overbought &gt;70</span>
              </div>
            </div>

            {/* Technical Signals */}
            {signals.length > 0 && (
              <div className="mt-3 pt-2.5" style={{ borderTop: '1px solid var(--artha-surface-low)' }}>
                <div className="artha-label mb-2">Signals · Your Stocks</div>
                <div className="space-y-1.5">
                  {signals.map(s => {
                    const style = SIGNAL_STYLE[s.type]
                    return (
                      <div key={s.type} className="flex items-center gap-2 min-w-0">
                        <div className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ background: style.color }} />
                        <span className="text-[10px] font-semibold shrink-0 w-[52px]"
                          style={{ color: style.color }}>
                          {s.shortLabel}
                        </span>
                        <div className="flex flex-wrap gap-1 min-w-0">
                          {s.tickers.slice(0, 5).map(t => (
                            <span key={t}
                              className="font-mono font-bold text-[9px] px-1.5 py-px rounded"
                              style={{ background: style.bg, color: style.color }}>
                              {t}
                            </span>
                          ))}
                          {s.tickers.length > 5 && (
                            <span className="text-[9px] self-center"
                              style={{ color: 'var(--artha-text-faint)' }}>
                              +{s.tickers.length - 5}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Volume Breakouts */}
            {volumeBreakouts.length > 0 && (
              <div className="mt-3 pt-2.5" style={{ borderTop: '1px solid var(--artha-surface-low)' }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="artha-label">Volume Breakouts</span>
                  <span className="text-[9px]" style={{ color: 'var(--artha-text-faint)' }}>vs 20d avg</span>
                </div>
                <div className="space-y-2">
                  {volumeBreakouts.map(v => {
                    const barColor = v.ratio >= 3 ? '#c0392b' : v.ratio >= 2.5 ? '#ea580c' : '#d97706'
                    const barPct   = Math.min(100, (v.ratio / maxRatio) * 100)
                    return (
                      <div key={v.ticker} className="flex items-center gap-2">
                        <span
                          className="font-mono font-bold text-[9px] px-1.5 py-px rounded shrink-0 w-[62px] text-center"
                          style={{
                            background: v.isPortfolio ? 'var(--artha-surface-low)' : 'var(--artha-surface)',
                            color: v.isPortfolio ? 'var(--artha-primary)' : 'var(--artha-text-secondary)',
                            border: `1px solid ${v.isPortfolio ? 'rgba(0,61,155,0.15)' : 'rgba(11,28,48,0.08)'}`,
                          }}>
                          {v.ticker}
                        </span>
                        <div className="flex-1 h-1.5 rounded-full overflow-hidden"
                          style={{ background: 'var(--artha-surface)' }}>
                          <div style={{
                            width: `${barPct}%`,
                            height: '100%',
                            background: barColor,
                            borderRadius: '999px',
                            opacity: 0.75,
                          }} />
                        </div>
                        <span className="font-mono font-bold text-[10px] shrink-0 w-8 text-right"
                          style={{ color: barColor }}>
                          {v.ratio.toFixed(1)}×
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
