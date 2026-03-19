'use client'

import { useEffect, useState } from 'react'

type SummaryData = {
  stock: {
    stock_name: string
    ticker: string
    industry: string | null
    current_price: number | null
    stock_pe: number | null
    ai_summary: string | null
    summary_date: string | null
    latest_headlines: string | null
  }
  score: {
    pe_deviation: number | null
    rsi: number | null
    rsi_signal: string | null
    classification: string | null
    suggested_action: string | null
    composite_score: number | null
    date: string | null
  } | null
}

export default function StockSummaryPanel({
  ticker,
  mode,
  onClose,
}: {
  ticker: string | null
  mode: 'summary' | 'filings'
  onClose: () => void
}) {
  const [data, setData]       = useState<SummaryData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    if (!ticker) return
    setData(null)
    setError(null)
    setLoading(true)

    fetch(`/api/stock-summary/${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then(json => {
        if (json.error) setError(json.error)
        else setData(json)
      })
      .catch(() => setError('Failed to load summary'))
      .finally(() => setLoading(false))
  }, [ticker])

  // Close on Escape key
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
            {data ? (
              <>
                <h2 className="text-base font-bold text-gray-900">{data.stock.stock_name}</h2>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs font-mono text-gray-500">{data.stock.ticker}</span>
                  {data.stock.industry && (
                    <span className="text-xs text-gray-400">· {data.stock.industry}</span>
                  )}
                </div>
              </>
            ) : (
              <h2 className="text-base font-bold text-gray-900">{ticker}</h2>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <span className="w-4 h-4 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
              Loading summary...
            </div>
          )}

          {error && (
            <div className="text-sm text-red-500">{error}</div>
          )}

          {data && !loading && (
            <div className="space-y-5">
              {/* Quick stats — always shown */}
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Price" value={data.stock.current_price != null ? `₹${data.stock.current_price.toLocaleString('en-IN')}` : '—'} />
                <Stat label="Stock PE" value={data.stock.stock_pe != null ? `${data.stock.stock_pe.toFixed(1)}x` : '—'} />
                <Stat label="RSI" value={data.score?.rsi != null ? data.score.rsi.toFixed(0) : '—'} />
                <Stat label="PE Dev%" value={data.score?.pe_deviation != null ? `${data.score.pe_deviation > 0 ? '+' : ''}${data.score.pe_deviation.toFixed(1)}%` : '—'} />
                <Stat label="Signal" value={data.score?.rsi_signal ?? '—'} />
                <Stat label="Score" value={data.score?.composite_score != null ? data.score.composite_score.toFixed(1) : '—'} />
              </div>

              {/* Filings mode */}
              {mode === 'filings' && (
                data.stock.latest_headlines
                  ? <FilingsSection text={data.stock.latest_headlines} />
                  : <div className="text-sm text-gray-400 bg-gray-50 rounded-lg px-4 py-6 text-center">
                      No filings yet. Run <code className="font-mono text-xs bg-gray-100 px-1 rounded">agents/newsAgent.js</code> to fetch them.
                    </div>
              )}

              {/* Summary mode */}
              {mode === 'summary' && (
                data.stock.ai_summary
                  ? <div>
                      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                        AI Research Note
                        {data.stock.summary_date && (
                          <span className="ml-2 font-normal normal-case text-gray-300">· {data.stock.summary_date}</span>
                        )}
                      </div>
                      <SummaryText text={data.stock.ai_summary} />
                    </div>
                  : <div className="text-sm text-gray-400 bg-gray-50 rounded-lg px-4 py-6 text-center">
                      No AI summary yet. Run <code className="font-mono text-xs bg-gray-100 px-1 rounded">agents/summaryAgent.js</code> to generate one.
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
  // Split into BSE and ET sections
  const sections = text.split(/(?=━━)/).filter(s => s.trim())

  return (
    <div>
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
        Recent Filings & News
      </div>
      <div className="space-y-4">
        {sections.map((section, si) => {
          const lines = section.split('\n').map(l => l.trim()).filter(Boolean)
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
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-800 hover:text-blue-600 hover:underline leading-snug"
                      >
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

function SummaryText({ text }: { text: string }) {
  // Split into lines, render section headers in bold
  const lines = text.split('\n')
  const SECTION_EMOJIS = ['📊', '🏭', '📉', '📰', '✅']

  return (
    <div className="text-sm text-gray-700 space-y-1 leading-relaxed">
      {lines.map((line, i) => {
        const isHeader = SECTION_EMOJIS.some(e => line.startsWith(e))
        if (isHeader) {
          return (
            <p key={i} className="font-semibold text-gray-900 mt-4 first:mt-0">{line}</p>
          )
        }
        if (line.trim() === '') return <div key={i} className="h-1" />
        return <p key={i}>{line}</p>
      })}
    </div>
  )
}
