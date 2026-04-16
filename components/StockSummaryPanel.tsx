'use client'

import { useEffect, useState } from 'react'
import { type BriefData } from './StockBriefModal'

const SENTIMENT_COLORS = {
  bull:    { bg: 'rgba(0,106,97,0.1)',     color: 'var(--artha-teal)',      label: 'Bullish'  },
  bear:    { bg: 'rgba(192,57,43,0.1)',    color: 'var(--artha-negative)',  label: 'Bearish'  },
  neutral: { bg: 'rgba(107,114,128,0.1)', color: 'var(--artha-text-muted)', label: 'Neutral' },
}

const SECTION_CONFIG = [
  { key: 'fundamentals' as const, label: 'Fundamentals', icon: '📊' },
  { key: 'technicals'   as const, label: 'Technicals',   icon: '📈' },
  { key: 'macro'        as const, label: 'Macro Context', icon: '🌐' },
  { key: 'outlook'      as const, label: 'Outlook',       icon: '🎯' },
]

type StockData = {
  stock_name:       string
  ticker:           string
  industry:         string | null
  current_price:    number | null
  stock_pe:         number | null
  latest_headlines: string | null
}

type ScoreData = {
  pe_deviation:     number | null
  rsi:              number | null
  rsi_signal:       string | null
  classification:   string | null
  suggested_action: string | null
  composite_score:  number | null
  date:             string | null
} | null

export default function StockSummaryPanel({
  ticker,
  mode,
  onClose,
}: {
  ticker: string | null
  mode:   'summary' | 'filings'
  onClose: () => void
}) {
  const [stock, setStock]     = useState<StockData | null>(null)
  const [score, setScore]     = useState<ScoreData>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  // AI brief state
  const [brief, setBrief]               = useState<BriefData | null>(null)
  const [briefLoading, setBriefLoading] = useState(false)
  const [briefError, setBriefError]     = useState<string | null>(null)

  // Load stock data when ticker changes
  useEffect(() => {
    if (!ticker) return
    setStock(null); setScore(null); setBrief(null)
    setError(null); setBriefError(null)
    setLoading(true)

    fetch(`/api/stock-summary/${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then(json => {
        if (json.error) { setError(json.error); return }
        setStock(json.stock)
        setScore(json.score ?? null)
      })
      .catch(() => setError('Failed to load data'))
      .finally(() => setLoading(false))
  }, [ticker])

  // Escape key
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function requestBrief() {
    if (!ticker) return
    setBriefLoading(true); setBriefError(null); setBrief(null)
    try {
      const res  = await fetch('/api/stock-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker }),
      })
      const json = await res.json()
      if (json.error) { setBriefError(json.error); return }
      const data: BriefData = typeof json.brief === 'string' ? JSON.parse(json.brief) : json.brief
      setBrief(data)
    } catch {
      setBriefError('Failed to generate brief')
    } finally {
      setBriefLoading(false)
    }
  }

  const open = ticker !== null

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/20 z-40 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 h-full w-full max-w-lg bg-white border-l border-gray-200 shadow-xl z-50 flex flex-col transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-gray-200">
          <div>
            {stock ? (
              <>
                <h2 className="text-base font-bold text-gray-900">{stock.stock_name}</h2>
                <div className="flex items-center gap-2 mt-0.5">
                  <a
                    href={`https://www.screener.in/company/${stock.ticker}/consolidated/`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-xs font-mono text-blue-600 hover:underline"
                  >
                    {stock.ticker}
                  </a>
                  {stock.industry && <span className="text-xs text-gray-400">· {stock.industry}</span>}
                </div>
              </>
            ) : (
              <h2 className="text-base font-bold text-gray-900">{ticker}</h2>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded" aria-label="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200">
          {(['summary', 'filings'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => {
                // re-open with same ticker but different mode via parent is complex;
                // just use local activeTab state
              }}
              className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-wide transition-colors ${mode === tab ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-400'}`}
            >
              {tab === 'summary' ? 'AI Brief' : 'News & Filings'}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <span className="w-4 h-4 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
              Loading…
            </div>
          )}

          {error && <div className="text-sm text-red-500">{error}</div>}

          {!loading && stock && (
            <div className="space-y-5">
              {/* Quick stats */}
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Price"    value={stock.current_price != null ? `₹${stock.current_price.toLocaleString('en-IN')}` : '—'} />
                <Stat label="Stock PE" value={stock.stock_pe != null ? `${stock.stock_pe.toFixed(1)}x` : '—'} />
                <Stat label="RSI"      value={score?.rsi != null ? score.rsi.toFixed(0) : '—'} />
                <Stat label="PE Dev"   value={score?.pe_deviation != null ? `${score.pe_deviation > 0 ? '+' : ''}${score.pe_deviation.toFixed(1)}%` : '—'} />
                <Stat label="Signal"   value={score?.rsi_signal ?? '—'} />
                <Stat label="Score"    value={score?.composite_score != null ? `${score.composite_score.toFixed(0)}/100` : '—'} />
              </div>

              {/* Summary mode → on-demand AI brief */}
              {mode === 'summary' && (
                <div>
                  {!brief && !briefLoading && (
                    <div className="bg-gray-50 rounded-xl px-4 py-6 flex flex-col items-center gap-3 text-center">
                      <p className="text-sm text-gray-500 leading-relaxed">
                        Get a concise 4-line brief covering valuation, momentum, FII sector flow, and a verdict — generated on demand.
                      </p>
                      <button
                        onClick={requestBrief}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition-colors"
                      >
                        ✦ Get AI Brief
                      </button>
                    </div>
                  )}

                  {briefLoading && (
                    <div className="bg-gray-50 rounded-xl px-4 py-6 flex items-center justify-center gap-2 text-sm text-gray-400">
                      <span className="w-4 h-4 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
                      Generating brief…
                    </div>
                  )}

                  {briefError && (
                    <div className="text-sm text-red-500 mt-2">{briefError}</div>
                  )}

                  {brief && (() => {
                    const s = SENTIMENT_COLORS[brief.sentiment ?? 'neutral']
                    return (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: s.bg, color: s.color }}>{s.label}</span>
                          <button onClick={() => setBrief(null)} className="text-[10px] text-gray-400 hover:text-gray-600">Refresh ↺</button>
                        </div>
                        <div className="bg-gray-50 rounded-xl px-4 py-3">
                          <p className="text-sm text-gray-700 leading-relaxed">{brief.summary}</p>
                        </div>
                        {SECTION_CONFIG.map(({ key, label, icon }) => brief.sections[key] && (
                          <div key={key} className="flex gap-2 bg-gray-50 rounded-xl px-4 py-3">
                            <span className="shrink-0 text-sm mt-0.5">{icon}</span>
                            <div>
                              <div className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-0.5">{label}</div>
                              <p className="text-xs text-gray-600 leading-relaxed">{brief.sections[key]}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                </div>
              )}

              {/* Filings mode */}
              {mode === 'filings' && (
                stock.latest_headlines
                  ? <FilingsSection text={stock.latest_headlines} />
                  : <div className="text-sm text-gray-400 bg-gray-50 rounded-lg px-4 py-6 text-center">
                      No filings yet — newsAgent runs each morning.
                    </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2.5">
      <div className="text-xs text-gray-400">{label}</div>
      <div className="text-sm font-semibold text-gray-900 mt-0.5">{value}</div>
    </div>
  )
}

function FilingsSection({ text }: { text: string }) {
  const sections = text.split(/(?=━━)/).filter(s => s.trim())
  return (
    <div>
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Recent Filings & News</div>
      <div className="space-y-4">
        {sections.map((section, si) => {
          const lines  = section.split('\n').map(l => l.trim()).filter(Boolean)
          const header = lines[0]?.replace(/━━/g, '').trim()
          const items: { meta: string; subject: string; link: string }[] = []
          let current: Partial<{ meta: string; subject: string; link: string }> = {}
          for (const line of lines.slice(1)) {
            if (/^\[\d+\]/.test(line)) {
              if (current.subject) items.push(current as any)
              current = { meta: line.replace(/^\[\d+\]\s*/, '') }
            } else if (line.startsWith('📅')) {
              current.meta = (current.meta ? current.meta + ' · ' : '') + line.replace('📅', '').trim()
            } else if (line.startsWith('📌')) {
              current.subject = line.replace('📌', '').trim()
            } else if (line.startsWith('🔗')) {
              current.link = line.replace('🔗', '').trim()
            }
          }
          if (current.subject) items.push(current as any)
          return (
            <div key={si}>
              <div className="text-xs font-medium text-gray-500 mb-2">{header}</div>
              <div className="space-y-2">
                {items.map((item, ii) => (
                  <div key={ii} className="bg-gray-50 rounded-lg px-3 py-2.5 text-xs">
                    <div className="text-gray-400 mb-0.5">{item.meta}</div>
                    {item.link ? (
                      <a href={item.link} target="_blank" rel="noopener noreferrer" className="text-gray-800 hover:text-blue-600 hover:underline leading-snug">
                        {item.subject}
                      </a>
                    ) : (
                      <div className="text-gray-800 leading-snug">{item.subject}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
