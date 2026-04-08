import Link from 'next/link'

type Props = {
  above200:    number
  below200:    number
  totalScored: number
  totalStocks: number
  oversold:    number
  overbought:  number
}

export default function MarketBreadthCard({ above200, below200, totalScored, totalStocks, oversold, overbought }: Props) {
  const neutral = Math.max(0, totalScored - oversold - overbought)
  const abovePct  = totalScored > 0 ? Math.round((above200 / totalScored) * 100) : 0
  const belowPct  = totalScored > 0 ? Math.round((below200 / totalScored) * 100) : 0

  // Health score 0-100: weight 200DMA (60%) + RSI distribution (40%)
  const dmaScore = abovePct
  const rsiScore = totalScored > 0
    ? Math.round(((neutral * 1.0 + oversold * 1.0 - overbought * 0.5) / totalScored) * 100)
    : 50
  const healthScore = Math.max(0, Math.min(100, Math.round(dmaScore * 0.6 + rsiScore * 0.4)))

  const healthColor  = abovePct >= 60 ? '#006a61' : abovePct >= 40 ? '#b45309' : '#c0392b'
  const healthBg     = abovePct >= 60 ? '#e6f4f2' : abovePct >= 40 ? '#fffbeb' : '#fef2f2'
  const healthLabel  = abovePct >= 70 ? 'Strong' : abovePct >= 50 ? 'Moderate' : abovePct >= 30 ? 'Weak' : 'Bearish'

  // RSI bar widths
  const rsOversold   = totalScored > 0 ? (oversold  / totalScored) * 100 : 0
  const rsNeutral    = totalScored > 0 ? (neutral   / totalScored) * 100 : 0
  const rsOverbought = totalScored > 0 ? (overbought / totalScored) * 100 : 0

  // Arc gauge — two 90° arcs to avoid SVG 180° ambiguity.
  // cx=40, cy=40, r=32. Left=(8,40) Top=(40,8) Right=(72,40).
  // viewBox "3 3 74 42" → x:3→77, y:3→45. All strokes ≥3px inside.
  const cx = 40, cy = 40, r = 32
  const totalLen = Math.PI * r  // ≈ 100.5
  const t = totalScored > 0 ? above200 / totalScored : 0
  const filled  = t * totalLen
  const arcPath = `M ${cx - r} ${cy} A ${r} ${r} 0 0 0 ${cx} ${cy - r} A ${r} ${r} 0 0 0 ${cx + r} ${cy}`
  const angle   = (1 - t) * Math.PI
  const nr      = r - 9
  const nx      = cx + nr * Math.cos(angle)
  const ny      = cy - nr * Math.sin(angle)
  const tickDots = [0, 0.5, 1].map(tv => {
    const ta = (1 - tv) * Math.PI
    const tr = r - 5
    return { x: cx + tr * Math.cos(ta), y: cy - tr * Math.sin(ta) }
  })

  return (
    <Link href="/watchlist" className="artha-card artha-card-hover block overflow-hidden" style={{ padding: 0 }}>
      <div className="h-1 w-full" style={{ background: healthColor }} />
      <div className="px-5 py-4">
        <div className="flex items-center justify-between mb-3">
          <span className="artha-label">Market Breadth</span>
          <span
            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{ background: healthBg, color: healthColor }}
          >
            {healthLabel}
          </span>
        </div>

        {totalScored === 0 ? (
          <div className="text-sm py-2" style={{ color: 'var(--artha-text-muted)' }}>No score data yet</div>
        ) : (
          <>
            {/* Gauge + stats side by side */}
            <div className="flex items-center justify-between gap-2 mb-1">
              <div>
                <div className="font-display font-bold text-3xl leading-none" style={{ color: healthColor, letterSpacing: '-0.03em' }}>
                  {above200}<span className="text-lg font-semibold" style={{ color: 'var(--artha-text-muted)' }}>/{totalScored}</span>
                </div>
                <div className="text-xs mt-1.5" style={{ color: 'var(--artha-text-muted)' }}>above 200 DMA</div>
                <div className="text-[11px] mt-0.5" style={{ color: 'var(--artha-text-faint)' }}>
                  {below200} below · {totalStocks - totalScored > 0 ? `${totalStocks - totalScored} unscored` : `${totalStocks} tracked`}
                </div>
              </div>

              {/* Mini arc gauge */}
              <svg width="80" height="46" viewBox="3 3 74 42" style={{ flexShrink: 0 }}>
                {/* Track */}
                <path d={arcPath} fill="none" stroke="#9ca3af" strokeWidth="6" strokeLinecap="round" />
                {/* Fill */}
                <path d={arcPath} fill="none" stroke={healthColor} strokeWidth="6" strokeLinecap="round"
                  strokeDasharray={`${filled} ${totalLen}`} />
                {/* Tick dots */}
                {tickDots.map((d, i) => (
                  <circle key={i} cx={d.x} cy={d.y} r="1.8" fill="white" opacity="0.85" />
                ))}
                {/* Needle */}
                <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={healthColor} strokeWidth="2" strokeLinecap="round" />
                {/* Pivot */}
                <circle cx={cx} cy={cy} r="3.5" fill={healthColor} />
                <circle cx={cx} cy={cy} r="1.4" fill="white" />
              </svg>
            </div>

            {/* RSI distribution bar */}
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
          </>
        )}
      </div>
    </Link>
  )
}
