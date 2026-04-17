'use client'

import { useState, useRef, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addToWatchlist, type AlertPrefs } from '@/app/watchlist/actions'

type SearchResult = { id: string; ticker: string; stock_name: string; industry: string | null }

const DEFAULT_ALERTS: AlertPrefs = {
  rsi_oversold_threshold:   30,
  rsi_overbought_threshold: 70,
  dma_cross_alert:          true,
  pct_from_high_threshold:  -20,
  new_filing_alert:         true,
}

export default function QuickAddStock() {
  const router = useRouter()
  const [open, setOpen]                 = useState(false)
  const [query, setQuery]               = useState('')
  const [results, setResults]           = useState<SearchResult[]>([])
  const [searching, setSearching]       = useState(false)
  const [selected, setSelected]         = useState<SearchResult | null>(null)
  const [entryPrice, setEntryPrice]     = useState('')
  const [investedAmount, setInvestedAmount] = useState('')
  const [pending, startTransition]      = useTransition()
  const [message, setMessage]           = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchRef   = useRef<HTMLInputElement>(null)

  // Focus search on open
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 60)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') reset() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Debounced search
  useEffect(() => {
    if (selected) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.trim().length < 1) { setResults([]); return }
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res  = await fetch(`/api/search-stocks?q=${encodeURIComponent(query.trim())}`)
        const data = await res.json()
        setResults(data ?? [])
      } finally {
        setSearching(false)
      }
    }, 280)
  }, [query, selected])

  function reset() {
    setOpen(false)
    setQuery('')
    setResults([])
    setSelected(null)
    setEntryPrice('')
    setInvestedAmount('')
    setMessage('')
  }

  async function handleAdd() {
    if (!selected) return
    const ep = entryPrice.trim()     ? parseFloat(entryPrice)     : undefined
    const ia = investedAmount.trim() ? parseFloat(investedAmount) : undefined

    startTransition(async () => {
      try {
        await addToWatchlist(selected.id, DEFAULT_ALERTS, ia, ep)
        setMessage(`✓ ${selected.ticker} added`)
        setTimeout(() => { reset(); router.refresh() }, 900)
      } catch (err: any) {
        setMessage(err.message ?? 'Error adding stock')
      }
    })
  }

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors"
        style={{
          color: 'var(--artha-text-muted)',
          background: 'var(--artha-surface)',
          borderColor: 'var(--artha-border)',
        }}
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path d="M12 4v16m8-8H4" />
        </svg>
        Add Stock
      </button>

      {/* Modal overlay */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={e => { if (e.target === e.currentTarget) reset() }}
        >
          <div
            className="w-full max-w-sm rounded-2xl shadow-2xl p-6"
            style={{ background: 'var(--artha-surface)', border: '1px solid var(--artha-border)' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-display font-bold text-base" style={{ color: 'var(--artha-text)', letterSpacing: '-0.02em' }}>
                Add to Watchlist
              </h2>
              <button
                onClick={reset}
                className="w-7 h-7 flex items-center justify-center rounded-full text-sm transition-colors hover:opacity-70"
                style={{ color: 'var(--artha-text-muted)', background: 'var(--artha-border)' }}
              >
                ✕
              </button>
            </div>

            {/* Stock search / selected */}
            <div className="mb-4">
              <label className="text-[10px] font-bold uppercase tracking-wider mb-1.5 block" style={{ color: 'var(--artha-text-muted)' }}>
                Stock
              </label>

              {!selected ? (
                <div className="relative">
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Search ticker or company name…"
                    className="w-full text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 transition-shadow"
                    style={{
                      background: 'var(--artha-bg)',
                      border: '1px solid var(--artha-border)',
                      color: 'var(--artha-text)',
                    }}
                  />
                  {searching && (
                    <div className="absolute right-3 top-3 w-3.5 h-3.5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                  )}
                  {results.length > 0 && (
                    <div
                      className="absolute top-full mt-1 left-0 right-0 rounded-xl shadow-lg z-50 max-h-56 overflow-y-auto"
                      style={{ background: 'var(--artha-surface)', border: '1px solid var(--artha-border)' }}
                    >
                      {results.map(r => (
                        <button
                          key={r.id}
                          onClick={() => { setSelected(r); setQuery(''); setResults([]) }}
                          className="w-full text-left px-3 py-2.5 hover:opacity-80 flex items-center justify-between gap-2 transition-opacity"
                        >
                          <div>
                            <span className="text-sm font-semibold" style={{ color: 'var(--artha-text)' }}>{r.ticker}</span>
                            <span className="text-xs ml-2" style={{ color: 'var(--artha-text-muted)' }}>{r.stock_name}</span>
                          </div>
                          {r.industry && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                              style={{ color: 'var(--artha-text-muted)', background: 'var(--artha-border)' }}
                            >
                              {r.industry.split(' ')[0]}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div
                  className="flex items-center justify-between px-3 py-2.5 rounded-lg"
                  style={{ background: 'var(--artha-bg)', border: '1px solid var(--artha-border)' }}
                >
                  <div>
                    <span className="text-sm font-bold" style={{ color: 'var(--artha-text)' }}>{selected.ticker}</span>
                    <span className="text-xs ml-2" style={{ color: 'var(--artha-text-muted)' }}>{selected.stock_name}</span>
                  </div>
                  <button
                    onClick={() => setSelected(null)}
                    className="text-xs transition-opacity hover:opacity-60"
                    style={{ color: 'var(--artha-text-muted)' }}
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>

            {/* Entry price + Invested */}
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider mb-1.5 block" style={{ color: 'var(--artha-text-muted)' }}>
                  Entry Price <span className="normal-case font-normal">(optional)</span>
                </label>
                <input
                  type="number"
                  value={entryPrice}
                  onChange={e => setEntryPrice(e.target.value)}
                  placeholder="₹ your buy price"
                  className="w-full text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 transition-shadow"
                  style={{
                    background: 'var(--artha-bg)',
                    border: '1px solid var(--artha-border)',
                    color: 'var(--artha-text)',
                  }}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider mb-1.5 block" style={{ color: 'var(--artha-text-muted)' }}>
                  Invested <span className="normal-case font-normal">(optional)</span>
                </label>
                <input
                  type="number"
                  value={investedAmount}
                  onChange={e => setInvestedAmount(e.target.value)}
                  placeholder="₹ amount"
                  className="w-full text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 transition-shadow"
                  style={{
                    background: 'var(--artha-bg)',
                    border: '1px solid var(--artha-border)',
                    color: 'var(--artha-text)',
                  }}
                />
              </div>
            </div>

            {!entryPrice && !investedAmount && (
              <p className="text-[10px] mb-4 -mt-2" style={{ color: 'var(--artha-text-muted)' }}>
                Defaults to current market price · ₹50,000 invested. Edit anytime via Manage alerts.
              </p>
            )}

            {/* Message */}
            {message && (
              <p className={`text-xs font-semibold mb-3 ${message.startsWith('✓') ? 'text-emerald-500' : 'text-red-500'}`}>
                {message}
              </p>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={reset}
                className="flex-1 text-sm font-semibold py-2.5 rounded-lg border transition-colors hover:opacity-80"
                style={{
                  color: 'var(--artha-text-muted)',
                  borderColor: 'var(--artha-border)',
                  background: 'transparent',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={!selected || pending}
                className="flex-1 text-sm font-semibold py-2.5 rounded-lg transition-all disabled:opacity-40"
                style={{
                  background: selected && !pending ? 'var(--artha-text)' : undefined,
                  color: 'var(--artha-surface)',
                  backgroundColor: !selected || pending ? 'var(--artha-border)' : undefined,
                }}
              >
                {pending ? 'Adding…' : 'Add to Watchlist'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
