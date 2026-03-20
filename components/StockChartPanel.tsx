'use client'

import { useState, useEffect } from 'react'
import {
  ComposedChart, Line, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts'

type Period = '1m' | '3m' | '6m' | '1y'
type Candle = { date: string; open: number; high: number; low: number; close: number; volume: number }

export default function StockChartPanel({
  ticker,
  stockName,
  onClose,
}: {
  ticker: string | null
  stockName?: string
  onClose: () => void
}) {
  const [period, setPeriod]   = useState<Period>('3m')
  const [candles, setCandles] = useState<Candle[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(false)

  useEffect(() => {
    if (!ticker) return
    setLoading(true)
    setError(false)
    setCandles([])
    fetch(`/api/stock-chart?ticker=${ticker}&period=${period}`)
      .then(r => r.json())
      .then(d => { if (d.candles) setCandles(d.candles); else setError(true) })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [ticker, period])

  if (!ticker) return null

  const firstClose = candles[0]?.close ?? null
  const lastClose  = candles[candles.length - 1]?.close ?? null
  const isUp       = lastClose != null && firstClose != null ? lastClose >= firstClose : true
  const pctChange  = firstClose && lastClose ? ((lastClose - firstClose) / firstClose * 100) : null
  const lineColor  = isUp ? '#10b981' : '#ef4444'

  const chartData = candles.map(c => ({
    date:   c.date.slice(5),
    close:  c.close,
    volume: c.volume,
  }))

  const minClose = candles.length ? Math.min(...candles.map(c => c.close)) : 0
  const maxClose = candles.length ? Math.max(...candles.map(c => c.close)) : 0

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full sm:w-[480px] bg-white shadow-2xl z-50 flex flex-col">

        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <div className="font-bold text-gray-900 text-base">{stockName ?? ticker}</div>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-xs text-gray-400 font-mono">{ticker}</span>
              {lastClose != null && (
                <span className="text-sm font-semibold font-mono text-gray-900">
                  ₹{lastClose.toLocaleString('en-IN')}
                </span>
              )}
              {pctChange != null && (
                <span className={`text-xs font-semibold ${isUp ? 'text-emerald-600' : 'text-red-600'}`}>
                  {pctChange > 0 ? '+' : ''}{pctChange.toFixed(2)}% ({period})
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none mt-0.5">✕</button>
        </div>

        {/* Period selector */}
        <div className="flex gap-2 px-5 py-3 border-b border-gray-100">
          {(['1m', '3m', '6m', '1y'] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold uppercase transition-colors ${
                period === p ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        {/* Chart */}
        <div className="flex-1 px-4 py-4 flex flex-col gap-4 overflow-y-auto">
          {loading && (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Loading chart...</div>
          )}
          {error && (
            <div className="flex-1 flex items-center justify-center text-red-400 text-sm">Could not load chart data</div>
          )}

          {!loading && !error && chartData.length > 0 && (
            <>
              {/* Price */}
              <div>
                <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Price (₹)</div>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
                    <YAxis
                      domain={[minClose * 0.98, maxClose * 1.02]}
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={v => `₹${v.toLocaleString('en-IN')}`}
                      width={70}
                    />
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                      formatter={(v: any) => [`₹${Number(v).toLocaleString('en-IN')}`, 'Close']}
                    />
                    <Line type="monotone" dataKey="close" stroke={lineColor} dot={false} strokeWidth={2} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Volume */}
              <div>
                <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Volume</div>
                <ResponsiveContainer width="100%" height={100}>
                  <ComposedChart data={chartData} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
                    <YAxis hide />
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                      formatter={(v: any) => [(Number(v) / 100000).toFixed(1) + 'L', 'Volume']}
                    />
                    <Bar dataKey="volume" fill="#94a3b8" radius={[2, 2, 0, 0]} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
