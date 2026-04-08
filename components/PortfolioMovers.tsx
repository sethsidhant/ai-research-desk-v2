// PortfolioMovers — Market Turning Points timeline.
// Shows significant Nifty50 moves (≥1.5%) in the last 30 days,
// correlated with macro news from that date. User's sectors are highlighted.

import Link from 'next/link'

export type TurningPoint = {
  date: string
  pct: number
  close: number
  news: { summary: string; channel: string; affected_sectors: string[] | null }[]
}

function fmtDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short',
  })
}

const CHANNEL_LABEL: Record<string, string> = {
  trump_ts_posts:   '🇺🇸 Trump',
  trumptruthposts:  '🇺🇸 Trump',
  et_markets:       '📰 Macro',
}

const SHORT_SECTOR: Record<string, string> = {
  'Financial Services': 'Financials',
  'Information Technology': 'IT',
  'Oil, Gas & Consumable Fuels': 'Oil & Gas',
  'Automobile and Auto Components': 'Auto',
  'Fast Moving Consumer Goods': 'FMCG',
  'Capital Goods': 'Cap Goods',
  'Consumer Services': 'Consumer Svcs',
  'Metals & Mining': 'Metals',
  'Telecommunication': 'Telecom',
  'Healthcare': 'Healthcare',
  'Chemicals': 'Chemicals',
  'Power': 'Power',
  'Realty': 'Realty',
}

export default function PortfolioMovers({
  turningPoints,
  userSectors,
}: {
  turningPoints: TurningPoint[]
  userSectors: string[]
}) {
  if (turningPoints.length === 0) {
    return (
      <div className="artha-card px-5 py-4">
        <div className="artha-label mb-2">Market Turning Points</div>
        <p className="text-sm" style={{ color: 'var(--artha-text-muted)' }}>
          No major Nifty moves (≥1.5%) in the last 30 days — market has been stable.
        </p>
      </div>
    )
  }

  const userSectorSet = new Set(userSectors)

  return (
    <div className="artha-card px-5 py-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="artha-label">Market Turning Points</div>
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--artha-text-muted)' }}>
            Nifty moves ≥1.5% · linked to macro news
          </div>
        </div>
        <Link
          href="/market-pulse"
          className="text-[10px] font-semibold px-2 py-0.5 rounded"
          style={{ background: 'var(--artha-surface-low)', color: 'var(--artha-text-muted)' }}
        >
          Market Pulse →
        </Link>
      </div>

      <div className="space-y-0">
        {turningPoints.map((tp, idx) => {
          const up = tp.pct >= 0
          const accentColor = up ? '#006a61' : '#c0392b'
          const accentBg    = up ? '#e6f4f2' : '#fef2f2'
          const isLast      = idx === turningPoints.length - 1

          // Collect all sectors from news items, mark user's sectors
          const allSectors = [...new Set(
            tp.news.flatMap(n => n.affected_sectors ?? [])
          )]
          const mySectors   = allSectors.filter(s => userSectorSet.has(s))
          const otherSectors = allSectors.filter(s => !userSectorSet.has(s)).slice(0, 3)

          return (
            <div key={tp.date} className="flex gap-3">
              {/* Timeline spine */}
              <div className="flex flex-col items-center" style={{ width: '28px', flexShrink: 0 }}>
                {/* Dot */}
                <div
                  className="flex items-center justify-center rounded-full font-bold shrink-0"
                  style={{
                    width: '28px', height: '28px',
                    background: accentBg,
                    border: `2px solid ${accentColor}`,
                    fontSize: '10px',
                    color: accentColor,
                    marginTop: '2px',
                  }}
                >
                  {up ? '▲' : '▼'}
                </div>
                {/* Connector line */}
                {!isLast && (
                  <div className="flex-1 w-px mt-1 mb-1" style={{ background: 'rgba(11,28,48,0.08)', minHeight: '12px' }} />
                )}
              </div>

              {/* Content */}
              <div className={`flex-1 pb-4 ${isLast ? '' : ''}`}>
                {/* Header: date + % badge */}
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-semibold" style={{ color: 'var(--artha-text-secondary)' }}>
                    {fmtDate(tp.date)}
                  </span>
                  <span
                    className="font-display font-bold text-xs px-2 py-0.5 rounded-md"
                    style={{ background: accentBg, color: accentColor }}
                  >
                    {up ? '+' : ''}{tp.pct.toFixed(2)}% Nifty
                  </span>
                  <span className="text-[10px]" style={{ color: 'var(--artha-text-faint)' }}>
                    {tp.close.toLocaleString('en-IN')}
                  </span>
                </div>

                {/* News items */}
                {tp.news.length > 0 ? (
                  <div className="space-y-1.5 mb-2">
                    {tp.news.slice(0, 2).map((n, ni) => (
                      <div key={ni} className="flex gap-1.5 items-start">
                        <span className="text-[9px] font-semibold shrink-0 mt-px"
                          style={{ color: 'var(--artha-text-faint)' }}>
                          {CHANNEL_LABEL[n.channel] ?? n.channel}
                        </span>
                        <p className="text-[11px] leading-snug line-clamp-2"
                          style={{ color: 'var(--artha-text-secondary)' }}>
                          {n.summary}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] mb-2 italic" style={{ color: 'var(--artha-text-faint)' }}>
                    No news captured for this date
                  </p>
                )}

                {/* Sector impact */}
                {(mySectors.length > 0 || otherSectors.length > 0) && (
                  <div className="flex flex-wrap gap-1">
                    {mySectors.map(s => (
                      <span key={s}
                        className="text-[9px] font-semibold px-1.5 py-0.5 rounded"
                        style={{
                          background: up ? 'rgba(0,106,97,0.12)' : 'rgba(192,57,43,0.1)',
                          color: accentColor,
                          border: `1px solid ${up ? 'rgba(0,106,97,0.25)' : 'rgba(192,57,43,0.2)'}`,
                        }}>
                        ★ {SHORT_SECTOR[s] ?? s}
                      </span>
                    ))}
                    {otherSectors.map(s => (
                      <span key={s}
                        className="text-[9px] px-1.5 py-0.5 rounded"
                        style={{
                          background: 'var(--artha-surface)',
                          color: 'var(--artha-text-muted)',
                          border: '1px solid var(--artha-surface-mid)',
                        }}>
                        {SHORT_SECTOR[s] ?? s}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
