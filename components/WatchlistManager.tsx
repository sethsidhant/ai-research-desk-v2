'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import { addToWatchlist, removeFromWatchlist, updateStockAlerts, type AlertPrefs } from '@/app/watchlist/actions'

type Stock = {
  id: string
  ticker: string
  stock_name: string
  industry: string | null
  inWatchlist: boolean
  alerts?: AlertPrefs | null
  entry_price?: number | null
  invested_amount?: number | null
}

type PriceMode = 'manual' | 'market'

type SearchResult = {
  id: string
  ticker: string
  stock_name: string
  industry: string | null
}

const DEFAULT_ALERTS: AlertPrefs = {
  rsi_oversold_threshold:   30,
  rsi_overbought_threshold: 70,
  dma_cross_alert:          true,
  pct_from_high_threshold:  -20,
  new_filing_alert:         true,
}

export default function WatchlistManager({ stocks: initialStocks }: { stocks: Stock[] }) {
  const [stocks, setStocks]             = useState<Stock[]>(initialStocks)
  const [query, setQuery]               = useState('')
  const [results, setResults]           = useState<SearchResult[]>([])
  const [searching, setSearching]       = useState(false)
  const [showResults, setShowResults]   = useState(false)
  const [pending, startTransition]      = useTransition()
  const [message, setMessage]           = useState('')
  const [expandedId, setExpandedId]     = useState<string | null>(null)
  const [alertForms, setAlertForms]     = useState<Record<string, AlertPrefs>>({})
  const [investedAmounts, setInvestedAmounts] = useState<Record<string, string>>({})
  const [entryPrices, setEntryPrices]         = useState<Record<string, string>>({})
  const [priceModes, setPriceModes]           = useState<Record<string, PriceMode>>({})
  const [fetchingPrice, setFetchingPrice]     = useState<Record<string, boolean>>({})
  const debounceRef                     = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.trim().length < 1) { setResults([]); setShowResults(false); return }

    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res  = await fetch(`/api/search-stocks?q=${encodeURIComponent(query.trim())}`)
        const data = await res.json()
        setResults(data)
        setShowResults(true)
      } finally {
        setSearching(false)
      }
    }, 300)
  }, [query])

  async function handlePriceModeChange(stockId: string, mode: PriceMode) {
    setPriceModes(prev => ({ ...prev, [stockId]: mode }))
    if (mode === 'market') {
      setFetchingPrice(prev => ({ ...prev, [stockId]: true }))
      try {
        const res  = await fetch(`/api/stock-price?stockId=${stockId}`)
        const json = await res.json()
        if (json.price) setEntryPrices(prev => ({ ...prev, [stockId]: String(json.price) }))
      } finally {
        setFetchingPrice(prev => ({ ...prev, [stockId]: false }))
      }
    }
  }

  function getAlerts(id: string, existing?: AlertPrefs | null): AlertPrefs {
    return alertForms[id] ?? existing ?? DEFAULT_ALERTS
  }

  function setAlertField(id: string, existing: AlertPrefs | null | undefined, field: keyof AlertPrefs, value: any) {
    setAlertForms(prev => ({
      ...prev,
      [id]: { ...(prev[id] ?? existing ?? DEFAULT_ALERTS), [field]: value },
    }))
  }

  function handleSelectResult(result: SearchResult) {
    setQuery('')
    setShowResults(false)
    const alreadyIn = stocks.find(s => s.id === result.id)
    if (!alreadyIn) {
      // Add to local list as "not in watchlist" so alert panel can open
      setStocks(prev => [...prev, { ...result, inWatchlist: false, alerts: null }])
    }
    setExpandedId(result.id)
  }

  function handleConfirmAdd(stock: Stock) {
    startTransition(async () => {
      const amt   = parseFloat(investedAmounts[stock.id] ?? '')
      const price = parseFloat(entryPrices[stock.id] ?? '')
      const result = await addToWatchlist(stock.id, getAlerts(stock.id, stock.alerts), isNaN(amt) ? undefined : amt, isNaN(price) ? undefined : price)
      if (result.error) {
        setMessage(`Error: ${result.error}`)
      } else {
        setStocks(prev => prev.map(s => s.id === stock.id ? { ...s, inWatchlist: true } : s))
        setMessage(`Added ${stock.ticker} to watchlist`)
        setExpandedId(null)
      }
      setTimeout(() => setMessage(''), 3000)
    })
  }

  function handleRemove(stock: Stock) {
    startTransition(async () => {
      const result = await removeFromWatchlist(stock.id)
      if (result.error) setMessage(`Error: ${result.error}`)
      else {
        setStocks(prev => prev.filter(s => s.id !== stock.id))
        setMessage(`Removed ${stock.ticker} from watchlist`)
      }
      setTimeout(() => setMessage(''), 3000)
    })
  }

  function handleUpdateAlerts(stock: Stock) {
    startTransition(async () => {
      const amt   = parseFloat(investedAmounts[stock.id] ?? '')
      const price = parseFloat(entryPrices[stock.id] ?? '')
      // Fall back to existing DB values if user hasn't changed them
      const finalAmt   = isNaN(amt)   ? (stock.invested_amount ?? undefined) : amt
      const finalPrice = isNaN(price) ? (stock.entry_price     ?? undefined) : price
      const result = await updateStockAlerts(stock.id, getAlerts(stock.id, stock.alerts), finalAmt, finalPrice)
      if (result.error) setMessage(`Error: ${result.error}`)
      else { setMessage(`Alerts updated for ${stock.ticker}`); setExpandedId(null) }
      setTimeout(() => setMessage(''), 3000)
    })
  }

  const watchlisted = stocks.filter(s => s.inWatchlist)
  const pendingAdd  = stocks.filter(s => !s.inWatchlist)

  return (
    <div>
      {/* Search box */}
      <div className="relative mb-6">
        <input
          type="text"
          placeholder="Search any NSE stock by ticker or name..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setShowResults(true)}
          onBlur={() => setTimeout(() => setShowResults(false), 150)}
          className="w-full px-4 py-3 rounded-lg bg-white text-gray-900 border border-gray-300 focus:outline-none focus:border-blue-500 text-sm"
        />
        {searching && (
          <div className="absolute right-3 top-3.5">
            <span className="w-4 h-4 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin inline-block" />
          </div>
        )}

        {/* Dropdown results */}
        {showResults && results.length > 0 && (
          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
            {results.map(r => {
              const inList = stocks.find(s => s.id === r.id)?.inWatchlist
              return (
                <button
                  key={r.id}
                  onMouseDown={() => handleSelectResult(r)}
                  className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-blue-50 text-left transition-colors"
                >
                  <div>
                    <span className="font-mono font-semibold text-sm text-gray-900">{r.ticker}</span>
                    <span className="text-gray-500 text-sm ml-3">{r.stock_name}</span>
                    {r.industry && <span className="text-gray-400 text-xs ml-2">{r.industry}</span>}
                  </div>
                  {inList && <span className="text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">In watchlist</span>}
                </button>
              )
            })}
          </div>
        )}

        {showResults && results.length === 0 && !searching && query.length > 0 && (
          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-sm px-4 py-3 text-sm text-gray-400">
            No stocks found for "{query}"
          </div>
        )}
      </div>

      {message && (
        <div className="mb-4 px-4 py-2 rounded-lg bg-blue-50 text-blue-600 text-sm border border-blue-200">
          {message}
        </div>
      )}

      {/* Pending add (selected from search, not yet added) */}
      {pendingAdd.map(stock => (
        <StockRow
          key={stock.id}
          stock={stock}
          isExpanded={expandedId === stock.id}
          alerts={getAlerts(stock.id, stock.alerts)}
          investedAmount={investedAmounts[stock.id] ?? ''}
          entryPrice={entryPrices[stock.id] ?? ''}
          priceMode={priceModes[stock.id] ?? 'manual'}
          fetchingPrice={fetchingPrice[stock.id] ?? false}
          onPriceModeChange={mode => handlePriceModeChange(stock.id, mode)}
          onInvestedAmountChange={val => setInvestedAmounts(prev => ({ ...prev, [stock.id]: val }))}
          onEntryPriceChange={val => setEntryPrices(prev => ({ ...prev, [stock.id]: val }))}
          pending={pending}
          onToggleExpand={() => setExpandedId(expandedId === stock.id ? null : stock.id)}
          onConfirmAdd={() => handleConfirmAdd(stock)}
          onRemove={() => handleRemove(stock)}
          onUpdateAlerts={() => handleUpdateAlerts(stock)}
          onAlertChange={(field, val) => setAlertField(stock.id, stock.alerts, field, val)}
        />
      ))}

      {/* Watchlisted stocks */}
      {watchlisted.length === 0 && pendingAdd.length === 0 && (
        <p className="text-gray-400 text-sm text-center py-8">
          Search for a stock above to add it to your watchlist.
        </p>
      )}
      {watchlisted.map(stock => (
        <StockRow
          key={stock.id}
          stock={stock}
          isExpanded={expandedId === stock.id}
          alerts={getAlerts(stock.id, stock.alerts)}
          investedAmount={investedAmounts[stock.id] ?? (stock.invested_amount != null ? String(stock.invested_amount) : '')}
          entryPrice={entryPrices[stock.id] ?? (stock.entry_price != null ? String(stock.entry_price) : '')}
          priceMode={priceModes[stock.id] ?? 'manual'}
          fetchingPrice={fetchingPrice[stock.id] ?? false}
          onPriceModeChange={mode => handlePriceModeChange(stock.id, mode)}
          onInvestedAmountChange={val => setInvestedAmounts(prev => ({ ...prev, [stock.id]: val }))}
          onEntryPriceChange={val => setEntryPrices(prev => ({ ...prev, [stock.id]: val }))}
          pending={pending}
          onToggleExpand={() => setExpandedId(expandedId === stock.id ? null : stock.id)}
          onConfirmAdd={() => handleConfirmAdd(stock)}
          onRemove={() => handleRemove(stock)}
          onUpdateAlerts={() => handleUpdateAlerts(stock)}
          onAlertChange={(field, val) => setAlertField(stock.id, stock.alerts, field, val)}
        />
      ))}
    </div>
  )
}

function StockRow({
  stock, isExpanded, alerts, investedAmount, entryPrice, priceMode, fetchingPrice,
  onInvestedAmountChange, onEntryPriceChange, onPriceModeChange, pending,
  onToggleExpand, onConfirmAdd, onRemove, onUpdateAlerts, onAlertChange,
}: {
  stock: Stock
  isExpanded: boolean
  alerts: AlertPrefs
  investedAmount: string
  entryPrice: string
  priceMode: PriceMode
  fetchingPrice: boolean
  onInvestedAmountChange: (val: string) => void
  onEntryPriceChange: (val: string) => void
  onPriceModeChange: (mode: PriceMode) => void
  pending: boolean
  onToggleExpand: () => void
  onConfirmAdd: () => void
  onRemove: () => void
  onUpdateAlerts: () => void
  onAlertChange: (field: keyof AlertPrefs, value: any) => void
}) {
  return (
    <div className="rounded-xl bg-white border border-gray-200 overflow-hidden shadow-sm mb-2">
      <div className="flex items-center justify-between px-4 py-3">
        <div>
          <span className="font-semibold text-gray-900 font-mono">{stock.ticker}</span>
          <span className="text-gray-500 text-sm ml-3">{stock.stock_name}</span>
          {stock.industry && <span className="text-gray-400 text-xs ml-3">{stock.industry}</span>}
          {stock.inWatchlist && (stock.entry_price != null || stock.invested_amount != null) && (
            <span className="ml-3 text-xs text-gray-400">
              {stock.entry_price != null && <>@ ₹{Number(stock.entry_price).toLocaleString('en-IN')}</>}
              {stock.entry_price != null && stock.invested_amount != null && <span className="mx-1">·</span>}
              {stock.invested_amount != null && <>₹{Number(stock.invested_amount).toLocaleString('en-IN')} invested</>}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {stock.inWatchlist && (
            <button
              onClick={onToggleExpand}
              className="px-3 py-1.5 rounded-lg text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-100 border border-gray-300 transition-colors"
            >
              {isExpanded ? 'Cancel' : 'Edit alerts'}
            </button>
          )}
          {stock.inWatchlist ? (
            <button
              onClick={onRemove}
              disabled={pending}
              className="px-4 py-1.5 rounded-lg text-sm font-medium bg-red-50 text-red-500 hover:bg-red-100 border border-red-200 transition-colors disabled:opacity-50"
            >
              Remove
            </button>
          ) : (
            <button
              onClick={onToggleExpand}
              disabled={pending}
              className="px-4 py-1.5 rounded-lg text-sm font-medium bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 transition-colors disabled:opacity-50"
            >
              {isExpanded ? 'Cancel' : '+ Add'}
            </button>
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-gray-100 px-4 py-4 bg-gray-50">
          <p className="text-xs text-gray-400 mb-4 font-medium uppercase tracking-wide">
            Configure alerts for {stock.ticker}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-gray-500">Entry price (₹)</label>
                <div className="flex rounded-lg overflow-hidden border border-gray-300 text-xs">
                  {(['manual', 'market'] as PriceMode[]).map(mode => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => onPriceModeChange(mode)}
                      className={`px-2 py-0.5 transition-colors ${priceMode === mode ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
                    >
                      {mode === 'manual' ? 'Manual' : 'Market price'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-gray-400 text-sm">₹</span>
                {fetchingPrice ? (
                  <div className="w-full pl-7 pr-4 py-2.5 rounded-lg bg-white border border-gray-300 text-sm text-gray-400 flex items-center gap-2">
                    <span className="w-3 h-3 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin inline-block" />
                    Fetching...
                  </div>
                ) : (
                  <input
                    type="number" min="0" step="0.05" placeholder="e.g. 1250.50"
                    value={entryPrice}
                    readOnly={priceMode === 'market'}
                    onChange={e => onEntryPriceChange(e.target.value)}
                    className={`w-full pl-7 pr-4 py-2.5 rounded-lg border text-sm text-gray-900 focus:outline-none focus:border-blue-500 ${priceMode === 'market' ? 'bg-gray-50 border-gray-200 cursor-default' : 'bg-white border-gray-300'}`}
                  />
                )}
              </div>
              {priceMode === 'market' && !fetchingPrice && entryPrice && (
                <p className="text-xs text-gray-400 mt-0.5">Live price during market hours, last close otherwise</p>
              )}
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Invested amount (₹) <span className="text-gray-400 font-normal">— optional</span></label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-gray-400 text-sm">₹</span>
                <input
                  type="number" min="0" placeholder="e.g. 50000"
                  value={investedAmount}
                  onChange={e => onInvestedAmountChange(e.target.value)}
                  className="w-full pl-7 pr-4 py-2.5 rounded-lg bg-white text-gray-900 border border-gray-300 focus:outline-none focus:border-blue-500 text-sm"
                />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">RSI oversold below</label>
              <input type="number" value={alerts.rsi_oversold_threshold}
                onChange={e => onAlertChange('rsi_oversold_threshold', Number(e.target.value))}
                min={1} max={50}
                className="w-full px-3 py-2.5 rounded-lg bg-white text-gray-900 border border-gray-300 focus:outline-none focus:border-blue-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">RSI overbought above</label>
              <input type="number" value={alerts.rsi_overbought_threshold}
                onChange={e => onAlertChange('rsi_overbought_threshold', Number(e.target.value))}
                min={50} max={99}
                className="w-full px-3 py-2.5 rounded-lg bg-white text-gray-900 border border-gray-300 focus:outline-none focus:border-blue-500 text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">
                Alert when stock is below 52W high (%) <span className="text-gray-400">— enter a negative number e.g. -20</span>
              </label>
              <input type="text" inputMode="numeric"
                value={alerts.pct_from_high_threshold}
                onChange={e => {
                  const val = parseFloat(e.target.value)
                  if (!isNaN(val)) onAlertChange('pct_from_high_threshold', val)
                  else if (e.target.value === '-' || e.target.value === '') onAlertChange('pct_from_high_threshold', e.target.value as any)
                }}
                placeholder="-20"
                className="w-full sm:w-48 px-3 py-2.5 rounded-lg bg-white text-gray-900 border border-gray-300 focus:outline-none focus:border-blue-500 text-sm"
              />
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-6 mb-5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={alerts.dma_cross_alert}
                onChange={e => onAlertChange('dma_cross_alert', e.target.checked)}
                className="w-4 h-4 rounded accent-blue-500 shrink-0"
              />
              <span className="text-sm text-gray-700">DMA crossover alert</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={alerts.new_filing_alert}
                onChange={e => onAlertChange('new_filing_alert', e.target.checked)}
                className="w-4 h-4 rounded accent-blue-500 shrink-0"
              />
              <span className="text-sm text-gray-700">New BSE filing alert</span>
            </label>
          </div>
          <button
            onClick={stock.inWatchlist ? onUpdateAlerts : onConfirmAdd}
            disabled={pending}
            className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {pending ? 'Saving...' : stock.inWatchlist ? 'Save alerts' : 'Add to watchlist'}
          </button>
        </div>
      )}
    </div>
  )
}
