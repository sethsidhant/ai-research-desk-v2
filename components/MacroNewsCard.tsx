'use client'
// MacroNewsCard — Trump Watch + Macro News cards.
// Period picker filters both the visible list and the AI brief.
// Important items (important=true in DB) are flagged with a red indicator.

import { useState } from 'react'
import AiBriefButton from './AiBriefButton'

type Alert = { channel: string; summary: string; created_at: string; important?: boolean }
type Period = '24h' | '48h'

function agoLabel(created_at: string) {
  const mins = Math.round((Date.now() - new Date(created_at).getTime()) / 60000)
  if (mins < 60)   return `${mins}m ago`
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`
  return `${Math.floor(mins / 1440)}d ago`
}

function filterByPeriod(items: Alert[], period: Period): Alert[] {
  const cutoffMs = period === '24h' ? 24 * 3600000 : 48 * 3600000
  return items.filter(it => Date.now() - new Date(it.created_at).getTime() < cutoffMs)
}

export default function MacroNewsCard({
  allItems,
  label,
  emptyText,
  briefType,
  briefTitle,
}: {
  allItems: Alert[]
  label: string
  emptyText: string
  briefType: 'trump' | 'macro'
  briefTitle: string
}) {
  const [period, setPeriod] = useState<Period>('24h')
  const visible = filterByPeriod(allItems, period)

  return (
    <div className="artha-card px-5 py-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="artha-label">{label}</div>
          {(['24h', '48h'] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full transition-all"
              style={{
                background: period === p ? 'rgba(0,106,97,0.12)' : 'transparent',
                border: `1px solid ${period === p ? 'rgba(0,106,97,0.3)' : 'rgba(11,28,48,0.1)'}`,
                color: period === p ? 'var(--artha-teal)' : 'var(--artha-text-faint)',
              }}
            >
              {p}
            </button>
          ))}
        </div>
        {visible.length > 0 && (
          <AiBriefButton items={visible} type={briefType} title={briefTitle} period={period} />
        )}
      </div>

      {/* List */}
      {visible.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--artha-text-muted)' }}>
          {allItems.length === 0 ? emptyText : `No items in the last ${period}.`}
        </p>
      ) : (
        <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
          {visible.map((alert, i) => (
            <div key={i} className="flex gap-2.5 items-start">
              {/* Important flag */}
              <div className="shrink-0 mt-0.5 w-4 text-center">
                {alert.important
                  ? <span className="text-[11px]" title="High market impact">🚨</span>
                  : <span className="inline-block w-1.5 h-1.5 rounded-full mt-1.5" style={{ background: 'var(--artha-surface-low)', border: '1px solid rgba(11,28,48,0.12)' }} />
                }
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs mb-0.5" style={{ color: 'var(--artha-text-faint)' }}>{agoLabel(alert.created_at)}</div>
                <p
                  className="text-sm leading-snug"
                  style={{
                    color: alert.important ? 'var(--artha-text)' : 'var(--artha-text-secondary)',
                    fontWeight: alert.important ? 600 : 400,
                  }}
                >
                  {alert.summary}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
