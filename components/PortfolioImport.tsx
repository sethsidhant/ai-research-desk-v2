'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type SearchResult = { id: string; ticker: string; stock_name: string; industry: string | null }

function useStockSearch() {
  const [query, setQuery]         = useState('')
  const [results, setResults]     = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const debounce                  = useRef<ReturnType<typeof setTimeout> | null>(null)

  function onQueryChange(q: string) {
    setQuery(q)
    if (debounce.current) clearTimeout(debounce.current)
    if (q.length < 1) { setResults([]); return }
    debounce.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res  = await fetch(`/api/search-stocks?q=${encodeURIComponent(q)}`)
        const data = await res.json()
        setResults(data ?? [])
      } finally {
        setSearching(false)
      }
    }, 250)
  }

  return { query, setQuery, results, setResults, searching, onQueryChange }
}

export default function PortfolioImport({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const router = useRouter()

  // ── Zerodha sync ──────────────────────────────────────────────────────────
  const [syncing, setSyncing]         = useState(false)
  const [syncResult, setSyncResult]   = useState<string | null>(null)
  const [syncError, setSyncError]     = useState<string | null>(null)

  async function handleZerodhaSync() {
    setSyncing(true); setSyncResult(null); setSyncError(null)
    try {
      const res  = await fetch('/api/portfolio/sync-zerodha', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) { setSyncError(json.error ?? 'Sync failed'); return }
      setSyncResult(json.message ?? `Synced ${json.synced} holdings`)
      router.refresh()
    } catch (e: any) {
      setSyncError(e.message)
    } finally {
      setSyncing(false)
    }
  }

  // ── CSV upload ────────────────────────────────────────────────────────────
  const fileRef                         = useRef<HTMLInputElement>(null)
  const [uploading, setUploading]       = useState(false)
  const [uploadResult, setUploadResult] = useState<string | null>(null)
  const [uploadError, setUploadError]   = useState<string | null>(null)

  async function handleCSVUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setUploadResult(null); setUploadError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res  = await fetch('/api/portfolio/import-csv', { method: 'POST', body: form })
      const json = await res.json()
      if (!res.ok) { setUploadError(json.error ?? 'Upload failed'); return }
      setUploadResult(json.message ?? `Imported ${json.synced} holdings`)
      router.refresh()
    } catch (e: any) {
      setUploadError(e.message)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // ── Manual add ────────────────────────────────────────────────────────────
  const search                        = useStockSearch()
  const [selected, setSelected]       = useState<SearchResult | null>(null)
  const [qty, setQty]                         = useState('')
  const [avgPrice, setAvgPrice]               = useState('')
  const [broker, setBroker]                   = useState('')
  const [investmentDate, setInvestmentDate]   = useState('')
  const [adding, setAdding]                   = useState(false)
  const [addResult, setAddResult]     = useState<string | null>(null)
  const [addError, setAddError]       = useState<string | null>(null)
  const [showManual, setShowManual]   = useState(false)

  function selectStock(s: SearchResult) {
    setSelected(s)
    search.setQuery(s.ticker)
    search.setResults([])
  }

  async function handleManualAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!selected) { setAddError('Select a stock first'); return }
    const q = parseFloat(qty)
    const p = parseFloat(avgPrice)
    if (!q || q <= 0 || !p || p <= 0) { setAddError('Enter valid quantity and price'); return }
    setAdding(true); setAddResult(null); setAddError(null)
    try {
      const res  = await fetch('/api/portfolio/holdings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stock_id: selected.id, quantity: q, avg_price: p, broker: broker || 'Manual', investment_date: investmentDate || null }),
      })
      const json = await res.json()
      if (!res.ok) { setAddError(json.error ?? 'Add failed'); return }
      setAddResult(`Added ${q} shares of ${selected.ticker}`)
      setSelected(null); search.setQuery(''); setQty(''); setAvgPrice(''); setBroker(''); setInvestmentDate('')
      router.refresh()
    } catch (e: any) {
      setAddError(e.message)
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Import / Add Holdings</span>
        <span className="text-xs text-gray-400">{open ? '▲ Hide' : '▾ Show'}</span>
      </button>

      {open && <div className="px-4 pb-4">

      <div className="flex flex-wrap items-start gap-3">

        {/* Zerodha sync */}
        <div className="flex flex-col gap-1">
          <button
            onClick={handleZerodhaSync}
            disabled={syncing}
            className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {syncing ? 'Syncing…' : 'Sync Zerodha'}
          </button>
          {syncResult && <p className="text-[10px] text-emerald-600 max-w-[180px]">{syncResult}</p>}
          {syncError  && <p className="text-[10px] text-red-500 max-w-[180px]">{syncError}</p>}
        </div>

        {/* CSV upload */}
        <div className="flex flex-col gap-1">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 text-gray-700 text-xs font-semibold rounded-lg transition-colors border border-gray-200"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            {uploading ? 'Uploading…' : 'Upload CSV'}
          </button>
          <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleCSVUpload} />
          <p className="text-[9px] text-gray-300">Format: Ticker,Qty,AvgPrice,Broker</p>
          {uploadResult && <p className="text-[10px] text-emerald-600 max-w-[180px]">{uploadResult}</p>}
          {uploadError  && <p className="text-[10px] text-red-500 max-w-[180px]">{uploadError}</p>}
        </div>

        {/* Manual add toggle */}
        <button
          onClick={() => setShowManual(v => !v)}
          className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg transition-colors border border-gray-200"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path d="M12 4v16m8-8H4" />
          </svg>
          Add manually
        </button>
      </div>

      {/* Manual add form */}
      {showManual && (
        <form onSubmit={handleManualAdd} className="mt-4 pt-4 border-t border-gray-100">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">

            {/* Stock search */}
            <div className="relative">
              <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1 block">Stock</label>
              <input
                type="text"
                value={search.query}
                onChange={e => { search.onQueryChange(e.target.value); setSelected(null) }}
                placeholder="Search ticker or name…"
                className="w-full text-xs text-gray-900 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-300"
              />
              {search.results.length > 0 && (
                <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {search.results.map(s => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => selectStock(s)}
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors"
                    >
                      <div className="text-xs font-semibold text-gray-900">{s.ticker}</div>
                      <div className="text-[10px] text-gray-400 truncate">{s.stock_name}</div>
                    </button>
                  ))}
                </div>
              )}
              {selected && (
                <div className="text-[10px] text-emerald-600 mt-1">✓ {selected.stock_name}</div>
              )}
            </div>

            {/* Quantity */}
            <div>
              <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1 block">Shares</label>
              <input
                type="number" min="0.01" step="any"
                value={qty} onChange={e => setQty(e.target.value)}
                placeholder="e.g. 100"
                className="w-full text-xs text-gray-900 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-300"
              />
            </div>

            {/* Avg Price */}
            <div>
              <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1 block">Avg Price ₹</label>
              <input
                type="number" min="0.01" step="any"
                value={avgPrice} onChange={e => setAvgPrice(e.target.value)}
                placeholder="e.g. 1650"
                className="w-full text-xs text-gray-900 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-300"
              />
            </div>

            {/* Broker */}
            <div>
              <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1 block">Broker (optional)</label>
              <input
                type="text"
                value={broker} onChange={e => setBroker(e.target.value)}
                placeholder="e.g. HDFC Securities"
                className="w-full text-xs text-gray-900 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-300"
              />
            </div>

            {/* Investment Date */}
            <div>
              <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1 block">Investment Date <span className="text-gray-300">(optional)</span></label>
              <input
                type="date"
                value={investmentDate} onChange={e => setInvestmentDate(e.target.value)}
                className="w-full text-xs text-gray-900 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-300"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 mt-3">
            <button
              type="submit"
              disabled={adding || !selected}
              className="px-4 py-2 bg-gray-900 hover:bg-gray-700 disabled:bg-gray-300 text-white text-xs font-semibold rounded-lg transition-colors"
            >
              {adding ? 'Adding…' : 'Add holding'}
            </button>
            {addResult && <p className="text-[10px] text-emerald-600">{addResult}</p>}
            {addError  && <p className="text-[10px] text-red-500">{addError}</p>}
          </div>
        </form>
      )}
      </div>}
    </div>
  )
}
