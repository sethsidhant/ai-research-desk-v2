'use client'

import { useState } from 'react'

export type NewsItem = {
  ticker: string
  source: string
  headline: string
  url: string | null
  isPortfolio: boolean
}

export type MacroItem = {
  channel: string
  summary: string
  created_at: string
  important: boolean | null
  affected_sectors: string[] | null
}

interface NewsTabsProps {
  newsItems: NewsItem[]
  trumpItems: MacroItem[]
  marketItems: MacroItem[]
  userSectors: string[]
}

function agoLabel(created_at: string): string {
  const mins = Math.round((Date.now() - new Date(created_at).getTime()) / 60000)
  if (mins < 60)   return `${mins}m ago`
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`
  return `${Math.floor(mins / 1440)}d ago`
}

const TABS = ['BSE Filings', '🇺🇸 Trump', '📰 Markets'] as const
type TabId = 0 | 1 | 2

export default function NewsTabs({ newsItems, trumpItems, marketItems, userSectors }: NewsTabsProps) {
  const [activeTab, setActiveTab] = useState<TabId>(0)

  return (
    <div>
      {/* Tab bar */}
      <div
        className="flex items-center gap-1.5 px-5 py-3"
        style={{ borderBottom: '1px solid var(--artha-border)' }}
      >
        {TABS.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => setActiveTab(i as TabId)}
            className="text-xs font-semibold px-3 py-1.5 rounded-full transition-all"
            style={activeTab === i ? {
              background: 'var(--artha-teal)',
              color: '#fff',
            } : {
              background: 'transparent',
              color: 'var(--artha-text-muted)',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="px-5 py-4">
        {/* Tab 0: BSE Filings */}
        {activeTab === 0 && (
          <>
            {newsItems.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--artha-text-muted)' }}>No filings in the last 48 hours.</p>
            ) : (
              <div className="space-y-4">
                {newsItems.slice(0, 8).map((item, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <div className="shrink-0 w-16 pt-0.5">
                      <span
                        className="block w-full text-center font-mono font-bold text-xs px-1 py-0.5 rounded-md truncate"
                        style={{
                          background: item.isPortfolio ? 'var(--artha-surface-low)' : 'var(--artha-surface)',
                          color: item.isPortfolio ? 'var(--artha-primary)' : 'var(--artha-text-secondary)',
                          border: `1px solid ${item.isPortfolio ? 'rgba(0,61,155,0.15)' : 'rgba(11,28,48,0.08)'}`,
                        }}
                      >
                        {item.ticker}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="artha-label mb-0.5">{item.source}</div>
                      {item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm leading-snug line-clamp-2 hover:underline"
                          style={{ color: 'var(--artha-text-secondary)' }}
                        >
                          {item.headline}
                        </a>
                      ) : (
                        <p className="text-sm leading-snug line-clamp-2" style={{ color: 'var(--artha-text-secondary)' }}>
                          {item.headline}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Tab 1 + 2: Macro tabs */}
        {(activeTab === 1 || activeTab === 2) && (
          <MacroList
            items={activeTab === 1 ? trumpItems : marketItems}
            userSectors={userSectors}
          />
        )}
      </div>
    </div>
  )
}

function MacroList({ items, userSectors }: { items: MacroItem[]; userSectors: string[] }) {
  if (items.length === 0) {
    return <p className="text-sm" style={{ color: 'var(--artha-text-muted)' }}>No alerts.</p>
  }

  const userSectorSet = new Set(userSectors)

  return (
    <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
      {items.slice(0, 8).map((item, i) => {
        const hitSectors   = (item.affected_sectors ?? []).filter(s => userSectorSet.has(s))
        const otherSectors = (item.affected_sectors ?? []).filter(s => !userSectorSet.has(s))

        return (
          <div key={i} className="flex gap-2.5 items-start">
            {/* Dot indicator */}
            <div className="shrink-0 mt-1.5">
              {item.important ? (
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ background: '#f59e0b' }}
                  title="Important"
                />
              ) : (
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ background: 'var(--artha-surface-low)', border: '1px solid rgba(11,28,48,0.15)' }}
                />
              )}
            </div>

            <div className="min-w-0 flex-1">
              {/* Summary */}
              <p
                className="text-sm leading-snug line-clamp-2 mb-1"
                style={{
                  color: item.important ? 'var(--artha-text)' : 'var(--artha-text-secondary)',
                  fontWeight: item.important ? 600 : 400,
                }}
              >
                {item.summary}
              </p>

              {/* Channel + time */}
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
                  style={{ background: 'var(--artha-surface)', color: 'var(--artha-text-faint)', border: '1px solid var(--artha-border)' }}
                >
                  {item.channel}
                </span>
                <span className="text-[10px]" style={{ color: 'var(--artha-text-faint)' }}>
                  {agoLabel(item.created_at)}
                </span>

                {/* Sector chips */}
                {hitSectors.map(s => (
                  <span
                    key={s}
                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                    style={{
                      background: 'rgba(220,38,38,0.08)',
                      border: '1px solid rgba(220,38,38,0.25)',
                      color: '#dc2626',
                    }}
                    title="You hold stocks in this sector"
                  >
                    ⚠ {s}
                  </span>
                ))}
                {otherSectors.slice(0, 2).map(s => (
                  <span
                    key={s}
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                    style={{
                      background: 'var(--artha-surface-low)',
                      border: '1px solid rgba(11,28,48,0.1)',
                      color: 'var(--artha-text-faint)',
                    }}
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
