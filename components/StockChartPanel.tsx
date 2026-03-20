'use client'

import { useState, useEffect } from 'react'
import {
  ComposedChart, Line, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts'

type Period = '1m' | '3m' | '6m' | '1y'
type Candle = { date: string; open: number; high: number; low: number; close: number; volume: number }

function calcSMA(closes: number[], period: number): (number | null)[] {
  return closes.map((_, i) => {
    if (i < period - 1) return null
    const slice = closes.slice(i - period + 1, i + 1)
    return slice.reduce((a, b) => a + b, 0) / period
  })
}

function calcRSI(closes: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null)
  if (closes.length < period + 1) return result
  let avgGain = 0, avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff > 0) avgGain += diff; else avgLoss -= diff
  }
  avgGain /= period
  avgLoss /= period
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return result
}

export default function StockChartPanel({
  ticker,
  stockName,
  onClose,
}: {
  ticker: string | null
  stockName?: string
  onClose: () => void
}) {
  const [period, setPeriod]       = useState<Period>('3m')
  const [candles, setCandles]     = useState<Candle[]>([])
  const [displayFrom, setDisplayFrom] = useState<string>('')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(false)

  useEffect(() => {
    if (!ticker) return
    setLoading(true)
    setError(false)
    setCandles([])
    fetch(`/api/stock-chart?ticker=${ticker}&period=${period}`)
      .then(r => r.json())
      .then(d => {
        if (d.candles) { setCandles(d.candles); setDisplayFrom(d.displayFrom ?? '') }
        else setError(true)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [ticker, period])

  if (!ticker) return null

  // Compute indicators on full candle set (includes lookback)
  const closes  = candles.map(c => c.close)
  const dma50s  = calcSMA(closes, 50)
  const dma200s = calcSMA(closes, 200)
  const rsis    = calcRSI(closes, 14)

  // Build full dataset then slice to display period
  const allData = candles.map((c, i) => ({
    date:   c.date.slice(5),
    close:  c.close,
    volume: c.volume,
    dma50:  dma50s[i]  != null ? parseFloat(dma50s[i]!.toFixed(2))  : null,
    dma200: dma200s[i] != null ? parseFloat(dma200s[i]!.toFixed(2)) : null,
    rsi:    rsis[i]    != null ? parseFloat(rsis[i]!.toFixed(1))    : null,
  }))
  const chartData = displayFrom
    ? allData.filter((_, i) => candles[i].date >= displayFrom)
    : allData

  const displayCandles = displayFrom
    ? candles.filter(c => c.date >= displayFrom)
    : candles

  const firstClose = displayCandles[0]?.close ?? null
  const lastClose  = displayCandles[displayCandles.length - 1]?.close ?? null
  const isUp       = lastClose != null && firstClose != null ? lastClose >= firstClose : true
  const pctChange  = firstClose && lastClose ? ((lastClose - firstClose) / firstClose * 100) : null
  const lineColor  = isUp ? '#10b981' : '#ef4444'

  const minClose   = displayCandles.length ? Math.min(...displayCandles.map(c => c.close)) : 0
  const maxClose   = displayCandles.length ? Math.max(...displayCandles.map(c => c.close)) : 0

  const latestRsi  = chartData.length ? chartData[chartData.length - 1].rsi : null
  const rsiColor   = latestRsi == null ? 'text-gray-400' : latestRsi > 70 ? 'text-red-500' : latestRsi < 30 ? 'text-emerald-500' : 'text-gray-600'

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full sm:w-[500px] bg-white shadow-2xl z-50 flex flex-col">

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
          {/* DMA legend */}
          {chartData.length > 0 && (
            <div className="ml-auto flex items-center gap-3 text-xs text-gray-400">
              <span className="flex items-center gap-1"><span className="inline-block w-4 border-t-2 border-amber-400" />50D</span>
              <span className="flex items-center gap-1"><span className="inline-block w-4 border-t-2 border-violet-500" />200D</span>
            </div>
          )}
        </div>

        {/* Charts */}
        <div className="flex-1 px-4 py-4 flex flex-col gap-4 overflow-y-auto">
          {loading && (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Loading chart...</div>
          )}
          {error && (
            <div className="flex-1 flex items-center justify-center text-red-400 text-sm">Could not load chart data</div>
          )}

          {!loading && !error && chartData.length > 0 && (
            <>
              {/* Price + DMA */}
              <div>
                <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Price (₹)</div>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
                    <YAxis
                      domain={[minClose * 0.97, maxClose * 1.03]}
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={v => `₹${v.toLocaleString('en-IN')}`}
                      width={70}
                    />
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                      formatter={(v: any, name: any) => {
                        const label = name === 'close' ? 'Close' : name === 'dma50' ? '50 DMA' : '200 DMA'
                        return [`₹${Number(v).toLocaleString('en-IN')}`, label]
                      }}
                    />
                    <Line type="monotone" dataKey="close"  stroke={lineColor}  dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="dma50"  stroke="#f59e0b"    dot={false} strokeWidth={1.5} strokeDasharray="5 3" connectNulls />
                    <Line type="monotone" dataKey="dma200" stroke="#8b5cf6"    dot={false} strokeWidth={1.5} strokeDasharray="5 3" connectNulls />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Volume */}
              <div>
                <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Volume</div>
                <ResponsiveContainer width="100%" height={80}>
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

              {/* RSI */}
              <div>
                <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
                  RSI (14)
                  {latestRsi != null && (
                    <span className={`ml-2 font-bold ${rsiColor}`}>{latestRsi.toFixed(1)}</span>
                  )}
                  <span className="ml-2 text-gray-300">· &gt;70 overbought · &lt;30 oversold</span>
                </div>
                <ResponsiveContainer width="100%" height={90}>
                  <ComposedChart data={chartData} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={28} ticks={[30, 70]} />
                    <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="3 3" strokeWidth={1} />
                    <ReferenceLine y={30} stroke="#10b981" strokeDasharray="3 3" strokeWidth={1} />
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                      formatter={(v: any) => [Number(v).toFixed(1), 'RSI']}
                    />
                    <Line type="monotone" dataKey="rsi" stroke="#6366f1" dot={false} strokeWidth={1.5} connectNulls />
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
