'use client'

import React, { useState } from 'react'
import ClassificationBadge, { getValuationBand, peDeviationColor } from './ClassificationBadge'
import StockSummaryPanel from './StockSummaryPanel'
import FundamentalsDrawer from './FundamentalsDrawer'
import StockChartPanel from './StockChartPanel'

export type WatchlistRow = {
  stock_id: string
  ticker: string
  stock_name: string
  industry: string | null
  current_price: number | null
  high_52w: number | null
  low_52w: number | null
  pct_from_52w_high: number | null
  stock_pe: number | null
  industry_pe: number | null
  // from latest daily_scores
  pe_deviation: number | null
  rsi: number | null
  rsi_signal: string | null
  dma_50: number | null
  dma_200: number | null
  above_50_dma: boolean | null
  above_200_dma: boolean | null
  composite_score: number | null
  classification: string | null
  suggested_action: string | null
  stock_6m: number | null
  stock_1y: number | null
  nifty50_6m: number | null
  nifty50_1y: number | null
  score_date: string | null
  invested_amount: number | null
  entry_price: number | null
  // fundamentals
  roe: number | null
  roce: number | null
  eps: number | null
  pb: number | null
  dividend_yield: number | null
  market_cap: number | null
  debt_to_equity: number | null
  promoter_holding: number | null
  current_ratio: number | null
  total_debt: number | null
  reserves: number | null
  borrowings: number | null
  fii_holding: number | null
  dii_holding: number | null
  revenue_growth_1y: number | null
  revenue_growth_3y: number | null
  revenue_growth_5y: number | null
  profit_growth_1y: number | null
  profit_growth_3y: number | null
  profit_growth_5y: number | null
  // nifty 500 comparison
  nifty500_6m: number | null
  nifty500_1y: number | null
}

function fmt(n: number | null, decimals = 1) {
  if (n == null) return '—'
  return n.toFixed(decimals)
}

function fmtReturn(n: number | null) {
  if (n == null) return '—'
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`
}

// Matches V1 % from 52W high color logic
function pctHighColor(n: number | null) {
  if (n == null) return 'text-gray-400'
  if (n <= -20) return 'text-emerald-600'
  if (n <= -10) return 'text-amber-700'
  return 'text-red-600'
}

// Matches V1 rsiColor()
function rsiColor(n: number | null) {
  if (n == null) return 'text-gray-400'
  if (n < 30)   return 'text-emerald-600'
  if (n > 70)   return 'text-red-600'
  return 'text-gray-900'
}

// Matches V1 return comparison color
function returnColor(stock: number | null, bench: number | null) {
  if (stock == null) return 'text-gray-400'
  if (bench == null) return 'text-gray-900'
  return stock >= bench ? 'text-emerald-600' : 'text-red-600'
}

// DMA status dot
function DmaStatus({ above50, above200 }: { above50: boolean | null; above200: boolean | null }) {
  if (above50 == null || above200 == null) return <span className="text-gray-400 text-xs">—</span>
  if (above50 && above200)   return <span className="text-gray-900 text-xs font-medium">↑↑</span>
  if (above50 && !above200)  return <span className="text-gray-900 text-xs font-medium">↑↓</span>
  if (!above50 && above200)  return <span className="text-gray-900 text-xs font-medium">↓↑</span>
  return                            <span className="text-gray-900 text-xs font-medium">↓↓</span>
}

// RSI Signal badge — matches V1 rsiSignalStyle()
function RsiSignalBadge({ signal }: { signal: string | null }) {
  if (!signal) return <span className="text-gray-400">—</span>
  return (
    <span className="px-1.5 py-0.5 rounded text-xs border text-gray-700 bg-gray-50 border-gray-200">{signal}</span>
  )
}

type PriceChange = { change: number; changePct: number }

export default function WatchlistTable({
  rows,
  priceFlashes,
  priceChanges,
}: {
  rows: WatchlistRow[]
  priceFlashes?: Record<string, 'up' | 'down' | null>
  priceChanges?: Record<string, PriceChange>
}) {
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null)
  const [panelMode, setPanelMode] = useState<'summary' | 'filings'>('summary')
  const [fundamentalsRow, setFundamentalsRow] = useState<WatchlistRow | null>(null)
  const [chartRow, setChartRow] = useState<WatchlistRow | null>(null)

  function openPanel(ticker: string, mode: 'summary' | 'filings') {
    setSelectedTicker(ticker)
    setPanelMode(mode)
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="text-5xl mb-4">📈</div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Your watchlist is empty</h2>
        <p className="text-gray-500 text-sm mb-6 max-w-xs">Add stocks you want to track and our AI will research them for you within minutes.</p>
        <a
          href="/watchlist"
          className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-xl transition-colors text-sm"
        >
          Add stocks to watchlist →
        </a>
      </div>
    )
  }

  return (
    <>
    <StockSummaryPanel ticker={selectedTicker} mode={panelMode} onClose={() => setSelectedTicker(null)} />
    <FundamentalsDrawer row={fundamentalsRow} onClose={() => setFundamentalsRow(null)} />
    <StockChartPanel ticker={chartRow?.ticker ?? null} stockName={chartRow?.stock_name} onClose={() => setChartRow(null)} />
    <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50 text-gray-400 text-xs uppercase tracking-widest font-mono">
            <th className="text-left px-4 py-3">Stock</th>
            <th className="text-right px-3 py-3">Price</th>
            <th className="hidden sm:table-cell text-right px-3 py-3">From High</th>
            <th className="hidden sm:table-cell text-right px-3 py-3">Stock PE</th>
            <th className="hidden lg:table-cell text-right px-3 py-3 whitespace-nowrap">52W H/L</th>
            <th className="hidden lg:table-cell text-right px-3 py-3">50 DMA</th>
            <th className="hidden lg:table-cell text-right px-3 py-3">200 DMA</th>
            <th className="hidden sm:table-cell text-center px-3 py-3">DMA</th>
            <th className="hidden sm:table-cell text-right px-3 py-3">RSI</th>
            <th className="hidden sm:table-cell text-center px-3 py-3">Signal</th>
            <th className="px-3 py-3" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const band        = getValuationBand(r.pe_deviation)
            const nameColor   = peDeviationColor(r.pe_deviation)
            const prevIndustry = i > 0 ? rows[i - 1].industry : null
            const showDivider  = i === 0 || r.industry !== prevIndustry

              const isPending = !r.composite_score && !r.rsi && !r.dma_50

            return (
              <React.Fragment key={r.stock_id}>
              {showDivider && (
                <tr className="bg-gray-50 border-t-2 border-gray-200">
                  <td colSpan={14} className="px-4 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-widest">
                    {r.industry ?? 'Other'}
                    {r.industry_pe != null && (
                      <span className="ml-2 normal-case text-gray-500 font-bold">· Ind PE {r.industry_pe.toFixed(1)}x</span>
                    )}
                  </td>
                </tr>
              )}
              {isPending ? (
                <tr className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-gray-400">{r.stock_name}</div>
                    <div className="text-gray-400 text-xs font-mono">{r.ticker}</div>
                  </td>
                  <td colSpan={12} className="px-3 py-3 text-xs text-amber-600 bg-amber-50/50">
                    🤓 Our AI is doing its homework on this one — data coming up in a few minutes!
                  </td>
                </tr>
              ) : (
              <tr
                className={`border-b border-gray-100 hover:bg-blue-50/40 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}
              >
                {/* Stock name — mobile shows compact badges inline */}
                <td className="px-4 py-3">
                  <a
                    href={`https://www.screener.in/company/${r.ticker}/consolidated/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`font-semibold hover:underline ${nameColor}`}
                  >
                    {r.stock_name}
                  </a>
                  <div className="text-gray-500 text-xs font-mono">{r.ticker}</div>
                  {/* Mobile-only compact info row */}
                  <div className="flex items-center gap-1.5 mt-1 sm:hidden flex-wrap">
                    {band && (
                      <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${band.style}`}>{band.label}</span>
                    )}
                    {r.rsi_signal && (
                      <span className="px-1.5 py-0.5 rounded text-xs border text-gray-700 bg-gray-50 border-gray-200">{r.rsi_signal}</span>
                    )}
                    {r.pct_from_52w_high != null && (
                      <span className={`text-xs font-mono ${pctHighColor(r.pct_from_52w_high)}`}>
                        {r.pct_from_52w_high > 0 ? '+' : ''}{fmt(r.pct_from_52w_high)}% from high
                      </span>
                    )}
                  </div>
                </td>

                {/* Price + day change */}
                {(() => {
                  const flash     = priceFlashes?.[r.ticker]
                  const dayChange = priceChanges?.[r.ticker]
                  const up        = dayChange ? dayChange.change >= 0 : null
                  const bgFlash   = flash === 'up'
                    ? 'bg-emerald-200'
                    : flash === 'down'
                    ? 'bg-red-200'
                    : ''
                  return (
                    <td className={`px-3 py-2 text-right font-mono transition-colors duration-500 ${bgFlash}`}>
                      <div className="font-semibold text-gray-900 text-sm">
                        {r.current_price != null ? `₹${r.current_price.toLocaleString('en-IN')}` : '—'}
                      </div>
                      {dayChange != null && (
                        <div className={`text-xs font-medium ${up ? 'text-emerald-600' : 'text-red-600'}`}>
                          {up ? '+' : ''}{dayChange.change.toFixed(2)} ({up ? '+' : ''}{dayChange.changePct.toFixed(2)}%)
                        </div>
                      )}
                      {(() => {
                        const livePrice = r.current_price
                        if (!r.invested_amount || !r.entry_price || !livePrice) return null
                        const currentVal = (livePrice / r.entry_price) * r.invested_amount
                        const pnl        = currentVal - r.invested_amount
                        const pnlPct     = ((livePrice - r.entry_price) / r.entry_price) * 100
                        const gain       = pnl >= 0
                        return (
                          <div className={`text-xs font-mono mt-0.5 ${gain ? 'text-emerald-600' : 'text-red-600'}`}>
                            {gain ? '+' : ''}₹{Math.abs(pnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })} ({gain ? '+' : ''}{pnlPct.toFixed(1)}%)
                          </div>
                        )
                      })()}
                    </td>
                  )
                })()}

                {/* % from 52W high — sm+ */}
                <td className="hidden sm:table-cell px-3 py-3 text-right font-mono text-gray-900">
                  {r.pct_from_52w_high != null ? `${r.pct_from_52w_high > 0 ? '+' : ''}${fmt(r.pct_from_52w_high)}%` : '—'}
                </td>

                {/* Stock PE — sm+ */}
                <td className="hidden sm:table-cell px-3 py-3 text-right font-mono text-gray-900">
                  {r.stock_pe != null ? `${fmt(r.stock_pe)}x` : '—'}
                </td>


                {/* 52W H/L — lg+ */}
                <td className="hidden lg:table-cell px-3 py-3 text-right font-mono text-xs text-gray-900 whitespace-nowrap">
                  <div className="text-emerald-700">{r.high_52w != null ? `₹${r.high_52w.toLocaleString('en-IN')}` : '—'}</div>
                  <div className="text-red-600">{r.low_52w != null ? `₹${r.low_52w.toLocaleString('en-IN')}` : '—'}</div>
                </td>

                {/* 50 DMA — lg+ */}
                <td className="hidden lg:table-cell px-3 py-3 text-right font-mono text-gray-900 whitespace-nowrap">
                  {r.dma_50 != null ? `₹${r.dma_50.toLocaleString('en-IN')}` : '—'}
                </td>

                {/* 200 DMA — lg+ */}
                <td className="hidden lg:table-cell px-3 py-3 text-right font-mono text-gray-900 whitespace-nowrap">
                  {r.dma_200 != null ? `₹${r.dma_200.toLocaleString('en-IN')}` : '—'}
                </td>

                {/* DMA status arrows — sm+ */}
                <td className="hidden sm:table-cell px-3 py-3 text-center">
                  <DmaStatus above50={r.above_50_dma} above200={r.above_200_dma} />
                </td>

                {/* RSI — sm+ */}
                <td className="hidden sm:table-cell px-3 py-3 text-right font-mono text-gray-900">
                  {fmt(r.rsi, 0)}
                </td>

                {/* RSI Signal badge — sm+ */}
                <td className="hidden sm:table-cell px-3 py-3 text-center">
                  <RsiSignalBadge signal={r.rsi_signal} />
                </td>

                {/* Panel triggers */}
                <td className="px-3 py-3 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <button
                      onClick={() => setFundamentalsRow(r)}
                      title="Fundamentals"
                      className="text-base hover:scale-110 transition-transform leading-none"
                    >
                      📊
                    </button>
                    <button
                      onClick={() => setChartRow(r)}
                      title="Price chart"
                      className="text-base hover:scale-110 transition-transform leading-none"
                    >
                      📈
                    </button>
                    <button
                      onClick={() => openPanel(r.ticker, 'summary')}
                      title="AI research note"
                      className="text-base hover:scale-110 transition-transform leading-none"
                    >
                      🤖
                    </button>
                    <button
                      onClick={() => openPanel(r.ticker, 'filings')}
                      title="BSE filings & news"
                      className="text-base hover:scale-110 transition-transform leading-none"
                    >
                      📰
                    </button>
                  </div>
                </td>
              </tr>
              )}
              </React.Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
    </>
  )
}
