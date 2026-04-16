'use client'

import { useState, useEffect } from 'react'
import { Sparkles, X } from 'lucide-react'

export type BriefData = {
  sentiment: 'bull' | 'bear' | 'neutral'
  summary: string
  sections: {
    fundamentals: string
    technicals: string
    macro: string
    outlook: string
  }
}

const SECTION_CONFIG = [
  { key: 'fundamentals' as const, label: 'Fundamentals', icon: '📊' },
  { key: 'technicals'   as const, label: 'Technicals',   icon: '📈' },
  { key: 'macro'        as const, label: 'Macro Context', icon: '🌐' },
  { key: 'outlook'      as const, label: 'Outlook',       icon: '🎯' },
]

const SENTIMENT = {
  bull:    { bg: 'rgba(0,106,97,0.12)',     color: 'var(--artha-teal)',      label: 'Bullish'  },
  bear:    { bg: 'rgba(192,57,43,0.12)',    color: 'var(--artha-negative)',  label: 'Bearish'  },
  neutral: { bg: 'rgba(107,114,128,0.12)', color: 'var(--artha-text-muted)', label: 'Neutral' },
}

export default function StockBriefModal({
  ticker,
  stockName,
  onClose,
}: {
  ticker: string
  stockName: string
  onClose: () => void
}) {
  const [brief,   setBrief]   = useState<BriefData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [cached,  setCached]  = useState(false)

  useEffect(() => {
    const key   = `noesis_brief_${ticker}`
    const today = new Date().toISOString().slice(0, 10)
    try {
      const raw = sessionStorage.getItem(key)
      if (raw) {
        const data = JSON.parse(raw)
        if (data.date === today && data.brief) {
          setBrief(data.brief)
          setCached(true)
          return
        }
        sessionStorage.removeItem(key)
      }
    } catch {}
    fetchBrief()
  }, [ticker]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function fetchBrief() {
    setLoading(true); setError(null)
    try {
      const res  = await fetch('/api/stock-brief', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ticker }),
      })
      const json = await res.json()
      if (json.error) { setError(json.error); return }
      const data: BriefData = typeof json.brief === 'string' ? JSON.parse(json.brief) : json.brief
      setBrief(data)
      setCached(json.cached ?? false)
      try {
        sessionStorage.setItem(key(ticker), JSON.stringify({ brief: data, date: new Date().toISOString().slice(0, 10) }))
      } catch {}
    } catch {
      setError('Failed to generate brief')
    } finally {
      setLoading(false)
    }
  }

  function key(t: string) { return `noesis_brief_${t}` }

  const s = SENTIMENT[brief?.sentiment ?? 'neutral']

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: 'var(--artha-card)', border: '1px solid rgba(0,106,97,0.15)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{
            background:   'linear-gradient(135deg, rgba(0,61,155,0.06), rgba(0,106,97,0.08))',
            borderBottom: '1px solid rgba(0,106,97,0.12)',
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="flex items-center justify-center rounded-xl"
              style={{ width: 32, height: 32, background: 'linear-gradient(135deg, #003d9b, #006a61)' }}
            >
              <Sparkles size={14} color="white" strokeWidth={2.5} />
            </div>
            <div>
              <div className="text-sm font-bold" style={{ color: 'var(--artha-text)', letterSpacing: '-0.01em' }}>{stockName}</div>
              <div className="text-[11px] font-mono" style={{ color: 'var(--artha-text-muted)' }}>{ticker} · AI Brief</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {brief && (
              <span
                className="text-[10px] font-bold px-2.5 py-0.5 rounded-full"
                style={{ background: s.bg, color: s.color }}
              >
                {s.label}
              </span>
            )}
            <button
              onClick={onClose}
              className="flex items-center justify-center rounded-full hover:bg-black/5 transition-colors"
              style={{ width: 28, height: 28, color: 'var(--artha-text-muted)' }}
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm" style={{ color: 'var(--artha-text-muted)' }}>
              <span className="w-4 h-4 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
              Generating brief…
            </div>
          )}

          {error && (
            <div className="text-sm py-6 text-center" style={{ color: 'var(--artha-negative)' }}>{error}</div>
          )}

          {brief && (
            <>
              <div
                className="rounded-xl px-4 py-3"
                style={{ background: 'var(--artha-surface-low)', border: '1px solid rgba(11,28,48,0.06)' }}
              >
                <div className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--artha-teal)' }}>
                  Summary
                </div>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--artha-text-secondary)' }}>
                  {brief.summary}
                </p>
              </div>

              {SECTION_CONFIG.map(({ key: sKey, label, icon }) => brief.sections[sKey] && (
                <div
                  key={sKey}
                  className="flex gap-3 rounded-xl px-4 py-3"
                  style={{ background: 'var(--artha-surface-low)', border: '1px solid rgba(11,28,48,0.06)' }}
                >
                  <div className="shrink-0 text-base leading-snug mt-0.5">{icon}</div>
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--artha-teal)' }}>
                      {label}
                    </div>
                    <div className="text-sm leading-relaxed" style={{ color: 'var(--artha-text-secondary)' }}>
                      {brief.sections[sKey]}
                    </div>
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
