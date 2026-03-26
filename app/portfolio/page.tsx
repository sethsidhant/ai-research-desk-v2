import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import SignOutButton from '@/components/SignOutButton'
import MarketIndicesBar from '@/components/MarketIndicesBar'
import PortfolioChart, { type ChartPoint } from '@/components/PortfolioChart'
import HoldingsTable, { type HoldingRow } from '@/components/HoldingsTable'
import SectorAllocation from '@/components/SectorAllocation'
import PortfolioImport from '@/components/PortfolioImport'
import { buildPortfolioChart } from '@/lib/buildPortfolioChart'

function fmtCurrency(n: number) {
  const abs = Math.abs(n)
  if (abs >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`
  if (abs >= 100000)   return `₹${(n / 100000).toFixed(2)}L`
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

export default async function PortfolioPage() {
  const supabase = await createClient()
  const admin    = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetch all holdings with stock details
  const { data: holdingsRaw } = await supabase
    .from('portfolio_holdings')
    .select(`
      stock_id,
      quantity,
      avg_price,
      broker,
      import_source,
      added_at,
      stocks (
        ticker,
        stock_name,
        industry,
        current_price,
        stock_pe,
        industry_pe
      )
    `)
    .eq('user_id', user.id)

  const holdings = (holdingsRaw ?? []).map((h: any) => {
    const stock = Array.isArray(h.stocks) ? h.stocks[0] : h.stocks
    return { ...h, stock }
  }).filter((h: any) => h.stock)

  const stockIds = holdings.map((h: any) => h.stock_id)

  // Latest daily_score per stock for analysis signals
  const { data: scores } = stockIds.length > 0
    ? await supabase
        .from('daily_scores')
        .select('stock_id, pe_deviation, rsi, rsi_signal, composite_score, classification, suggested_action, above_200_dma, date')
        .in('stock_id', stockIds)
        .order('date', { ascending: false })
    : { data: [] }

  const latestScore: Record<string, any> = {}
  for (const s of (scores ?? [])) {
    if (!latestScore[s.stock_id]) latestScore[s.stock_id] = s
  }

  // Build HoldingRow[] for HoldingsTable
  const rows: HoldingRow[] = holdings.map((h: any) => ({
    stock_id:         h.stock_id,
    ticker:           h.stock?.ticker ?? '',
    stock_name:       h.stock?.stock_name ?? '',
    industry:         h.stock?.industry ?? null,
    current_price:    h.stock?.current_price ?? null,
    avg_price:        h.avg_price,
    quantity:         h.quantity,
    broker:           h.broker ?? null,
    pe_deviation:     latestScore[h.stock_id]?.pe_deviation   ?? null,
    rsi:              latestScore[h.stock_id]?.rsi             ?? null,
    rsi_signal:       latestScore[h.stock_id]?.rsi_signal      ?? null,
    composite_score:  latestScore[h.stock_id]?.composite_score ?? null,
    classification:   latestScore[h.stock_id]?.classification  ?? null,
    suggested_action: latestScore[h.stock_id]?.suggested_action ?? null,
    above_200_dma:    latestScore[h.stock_id]?.above_200_dma   ?? null,
  }))

  // P&L totals (server-side, from DB current_price; client will update live)
  const totalInvested = rows.reduce((s, r) => s + r.quantity * r.avg_price, 0)
  const totalCurrent  = rows.reduce((s, r) => {
    const price = r.current_price ?? r.avg_price
    return s + r.quantity * price
  }, 0)
  const totalPnl    = totalCurrent - totalInvested
  const totalReturn = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0

  // Portfolio chart
  let chartData: ChartPoint[] = []
  if (holdings.length > 0) {
    const earliestDate = (holdingsRaw ?? [])
      .map((h: any) => h.added_at?.slice(0, 10) ?? '2000-01-01')
      .sort()[0] ?? '2000-01-01'

    const [{ data: history }, { data: indexHistory }] = await Promise.all([
      supabase
        .from('daily_history')
        .select('stock_id, date, closing_price')
        .in('stock_id', stockIds)
        .not('closing_price', 'is', null)
        .gte('date', earliestDate)
        .order('date', { ascending: true }),
      admin
        .from('index_history')
        .select('date, nifty50_close, nifty500_close')
        .gte('date', earliestDate)
        .order('date', { ascending: true }),
    ])

    chartData = buildPortfolioChart(
      holdings.map((h: any) => ({
        stock_id:  h.stock_id,
        avg_price: h.avg_price,
        quantity:  h.quantity,
        added_at:  h.added_at ?? '2000-01-01',
      })),
      history ?? [],
      indexHistory ?? [],
    )
  }

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  const isAdmin = user.email === process.env.ADMIN_EMAIL

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-gray-200 px-4 sm:px-6 py-3 sm:py-4 bg-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-gray-900">AI Research Desk</h1>
            <p className="text-xs text-gray-400 mt-0.5 hidden sm:block">{today}</p>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <span className="text-xs sm:text-sm text-gray-500 hidden sm:block">{user.email}</span>
            {isAdmin && (
              <Link href="/admin" className="text-xs sm:text-sm text-gray-500 hover:text-gray-900 transition-colors px-2 sm:px-3 py-1.5 rounded-lg hover:bg-gray-100">
                Admin
              </Link>
            )}
            <Link href="/market-pulse" className="text-xs sm:text-sm text-gray-500 hover:text-gray-900 transition-colors px-2 sm:px-3 py-1.5 rounded-lg hover:bg-gray-100">
              Market Pulse
            </Link>
            <Link href="/" className="text-xs sm:text-sm text-gray-500 hover:text-gray-900 transition-colors px-2 sm:px-3 py-1.5 rounded-lg hover:bg-gray-100">
              Overview
            </Link>
            <Link href="/watchlist" className="text-xs sm:text-sm text-gray-500 hover:text-gray-900 transition-colors px-2 sm:px-3 py-1.5 rounded-lg hover:bg-gray-100">
              Watchlist
            </Link>
            <span className="text-xs sm:text-sm font-semibold text-gray-900 px-2 sm:px-3 py-1.5 rounded-lg bg-gray-100">
              Portfolio
            </span>
            <Link href="/settings" className="text-xs sm:text-sm text-gray-500 hover:text-gray-900 transition-colors px-2 sm:px-3 py-1.5 rounded-lg hover:bg-gray-100">
              Settings
            </Link>
            <SignOutButton />
          </div>
        </div>
        <div className="mt-2 sm:mt-3 overflow-x-auto">
          <MarketIndicesBar />
        </div>
      </header>

      <main className="px-3 sm:px-6 py-4 sm:py-8 max-w-screen-xl mx-auto">

        {/* Page title */}
        <div className="flex items-center gap-3 mb-6">
          <h2 className="text-lg font-bold text-gray-900">Portfolio</h2>
          <span className="text-sm text-gray-400">{rows.length} holdings</span>
        </div>

        {/* P&L summary cards */}
        {totalInvested > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <SummaryCard label="Invested"      value={fmtCurrency(totalInvested)} />
            <SummaryCard label="Current Value" value={fmtCurrency(totalCurrent)} />
            <SummaryCard
              label="Total P&L"
              value={`${totalPnl >= 0 ? '+' : ''}${fmtCurrency(totalPnl)}`}
              highlight={totalPnl >= 0 ? 'green' : 'red'}
            />
            <SummaryCard
              label="Return"
              value={`${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(2)}%`}
              highlight={totalReturn >= 0 ? 'green' : 'red'}
            />
          </div>
        )}

        {/* Import strip */}
        <div className="mb-6">
          <PortfolioImport />
        </div>

        {/* Chart + Sector allocation side by side */}
        {(chartData.length >= 2 || rows.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            {chartData.length >= 2 && (
              <div className="lg:col-span-2 bg-white border border-gray-200 rounded-xl px-4 sm:px-6 py-4 shadow-sm">
                <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Portfolio Return</div>
                <PortfolioChart data={chartData} />
              </div>
            )}
            {rows.length > 0 && (
              <div className={chartData.length >= 2 ? '' : 'lg:col-span-3'}>
                <SectorAllocation
                  holdings={rows.map(r => ({
                    industry:  r.industry,
                    quantity:  r.quantity,
                    avg_price: r.avg_price,
                  }))}
                />
              </div>
            )}
          </div>
        )}

        {/* Holdings table */}
        <HoldingsTable initialRows={rows} totalInvested={totalInvested} />

        {/* Empty state */}
        {rows.length === 0 && (
          <div className="text-center py-20">
            <div className="text-4xl mb-4">📊</div>
            <div className="text-base font-semibold text-gray-700 mb-2">No holdings yet</div>
            <div className="text-sm text-gray-400 mb-6">
              Sync from Zerodha, upload a CSV, or add holdings manually above.
            </div>
            <div className="text-xs text-gray-300">
              CSV format: <code className="bg-gray-50 px-2 py-0.5 rounded border border-gray-200 text-gray-500">Ticker,Quantity,AvgPrice,Broker</code>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function SummaryCard({ label, value, highlight }: { label: string; value: string; highlight?: 'green' | 'red' }) {
  const color = highlight === 'green' ? 'text-emerald-600' : highlight === 'red' ? 'text-red-600' : 'text-gray-900'
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-4 shadow-sm">
      <div className={`text-xl sm:text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-400 mt-1">{label}</div>
    </div>
  )
}
