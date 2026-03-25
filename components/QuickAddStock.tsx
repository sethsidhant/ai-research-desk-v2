'use client'

import { useState, useRef, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addToWatchlist, type AlertPrefs } from '@/app/watchlist/actions'

type SearchResult = { id: string; ticker: string; stock_name: string; industry: string | null }

export default function QuickAddStock() {
  const router = useRouter()
  const [open, setOpen]           = useState(false)
  const [query, setQuery]         = useState('')
  const [results, setResults]     = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected]   = useState<SearchResult | null>(null)
  const [entryPrice, setEntryPrice]     = useState('')
  const [investedAmount, setInvestedAmount] = useState('')
  const [pending, startTransition]      = useTransition()
  const [message, setMessage]     = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef    = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])

  useEffect(() => {
    if (selected) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.trim().length < 1) { setResults([]); return }
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res  = await fetch(`/api/search-stocks?q=${encodeURIComponent(query.trim())}`)
        const data = await res.json()
        setResults(data)
      } finally {
        setSearching(false)
      }
    }, 300)
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

  const DEFAULT_ALERTS: AlertPrefs = {
    rsi_oversold_threshold:   30,
    rsi_overbought_threshold: 70,
    dma_cross_alert:          true,
    pct_from_high_threshold:  -20,
    new_filing_alert:         true,
  }

  async function handleAdd() {
    if (!selected) return
    const ep = entryPrice.trim() ? parseFloat(entryPrice)         : undefined
    const ia = investedAmount.trim() ? parseFloat(investedAmount) : undefined

    startTransition(async () => {
      try {
        await addToWatchlist(selected.id, DEFAULT_ALERTS, ia, ep)
        setMessage(`✓ ${selected.ticker} added`)
        setTimeout(() => { reset(); router.refresh() }, 1000)
      } catch (err: any) {
        setMessage(err.message ?? 'Error adding stock')
      }
    })
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-900 bg-gray-50 hover:bg-gray-100 border border-gray-200 hover:border-gray-300 px-3 py-1.5 rounded-lg transition-colors"
      >
        <span className="text-base leading-none">+</span> Add Stock
      </button>
    )
  }

  return (
    <div className="flex items-start gap-2 flex-wrap">
      {!selected ? (
        <div className="relative">
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search ticker or name…"
            className="text-sm text-gray-900 border border-gray-300 rounded-lg px-3 py-1.5 w-56 focus:outline-none focus:ring-2 focus:ring-gray-300"
          />
          {searching && (
            <div className="absolute right-2.5 top-2 w-3 h-3 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
          )}
          {results.length > 0 && (
            <div className="absolute top-full mt-1 left-0 w-72 bg-white border border-gray-200 rounded-xl shadow-lg z-50 max-h-60 overflow-y-auto">
              {results.map(r => (
                <button
                  key={r.id}
                  onClick={() => { setSelected(r); setQuery('') }}
                  className="w-full text-left px-3 py-2.5 hover:bg-gray-50 flex items-center justify-between gap-2"
                >
                  <div>
                    <span className="text-sm font-semibold text-gray-900">{r.ticker}</span>
                    <span className="text-xs text-gray-400 ml-2 truncate">{r.stock_name}</span>
                  </div>
                  {r.industry && (
                    <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded shrink-0">{r.industry}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
            <span className="text-sm font-semibold text-gray-800">{selected.ticker}</span>
            <span className="text-xs text-gray-400">{selected.stock_name}</span>
            <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-xs ml-1">✕</button>
          </div>
          <input
            type="number"
            value={entryPrice}
            onChange={e => setEntryPrice(e.target.value)}
            placeholder="Entry price (opt)"
            className="text-sm text-gray-900 border border-gray-300 rounded-lg px-3 py-1.5 w-36 focus:outline-none focus:ring-2 focus:ring-gray-300"
          />
          <input
            type="number"
            value={investedAmount}
            onChange={e => setInvestedAmount(e.target.value)}
            placeholder="Invested ₹ (opt)"
            className="text-sm text-gray-900 border border-gray-300 rounded-lg px-3 py-1.5 w-36 focus:outline-none focus:ring-2 focus:ring-gray-300"
          />
          <button
            onClick={handleAdd}
            disabled={pending}
            className="text-sm font-semibold bg-gray-900 text-white px-4 py-1.5 rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            {pending ? 'Adding…' : 'Add'}
          </button>
          {(!entryPrice && !investedAmount) && (
            <span className="text-[10px] text-gray-400 self-center">
              Defaults: market price · ₹50,000 invested. Edit anytime via Manage alerts.
            </span>
          )}
        </>
      )}
      {message && (
        <span className={`text-xs font-semibold self-center ${message.startsWith('✓') ? 'text-emerald-600' : 'text-red-500'}`}>
          {message}
        </span>
      )}
      <button onClick={reset} className="text-xs text-gray-400 hover:text-gray-600 self-center">Cancel</button>
    </div>
  )
}
