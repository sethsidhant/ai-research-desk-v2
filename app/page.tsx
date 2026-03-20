import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import SignOutButton from '@/components/SignOutButton'
import LivePriceTable from '@/components/LivePriceTable'
import MarketIndicesBar from '@/components/MarketIndicesBar'
import PortfolioChart, { type ChartPoint } from '@/components/PortfolioChart'

export default async function DashboardPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // 1. Fetch user's watchlist with stock details
  const { data: watchlist } = await supabase
    .from('user_stocks')
    .select(`
      stock_id,
      invested_amount,
      entry_price,
      stocks (
        ticker,
        stock_name,
        industry,
        current_price,
        high_52w,
        low_52w,
        pct_from_52w_high,
        stock_pe,
        industry_pe
      )
    `)
    .eq('user_id', user.id)

  const stockIds = (watchlist ?? []).map((w: any) => w.stock_id)

  // 2. Fetch latest daily_score per stock (separate query)
  const { data: scores } = stockIds.length > 0
    ? await supabase
        .from('daily_scores')
        .select('stock_id, pe_deviation, rsi, rsi_signal, dma_50, dma_200, above_50_dma, above_200_dma, composite_score, classification, suggested_action, stock_6m, stock_1y, nifty50_6m, nifty50_1y, date')
        .in('stock_id', stockIds)
        .order('date', { ascending: false })
    : { data: [] }

  // Keep only the latest score per stock
  const latestScore: Record<string, any> = {}
  for (const s of (scores ?? [])) {
    if (!latestScore[s.stock_id]) latestScore[s.stock_id] = s
  }

  const rows = (watchlist ?? []).map((w: any) => {
    const stock = Array.isArray(w.stocks) ? w.stocks[0] : w.stocks
    const score = latestScore[w.stock_id] ?? null
    return {
      stock_id:          w.stock_id,
      ticker:            stock?.ticker ?? '',
      stock_name:        stock?.stock_name ?? '',
      industry:          stock?.industry ?? null,
      current_price:     stock?.current_price ?? null,
      high_52w:          stock?.high_52w ?? null,
      low_52w:           stock?.low_52w ?? null,
      pct_from_52w_high: stock?.pct_from_52w_high ?? null,
      stock_pe:          stock?.stock_pe ?? null,
      industry_pe:       stock?.industry_pe ?? null,
      pe_deviation:      score?.pe_deviation ?? null,
      rsi:               score?.rsi ?? null,
      rsi_signal:        score?.rsi_signal ?? null,
      dma_50:            score?.dma_50 ?? null,
      dma_200:           score?.dma_200 ?? null,
      above_50_dma:      score?.above_50_dma ?? null,
      above_200_dma:     score?.above_200_dma ?? null,
      composite_score:   score?.composite_score ?? null,
      classification:    score?.classification ?? null,
      suggested_action:  score?.suggested_action ?? null,
      stock_6m:          score?.stock_6m ?? null,
      stock_1y:          score?.stock_1y ?? null,
      nifty50_6m:        score?.nifty50_6m ?? null,
      nifty50_1y:        score?.nifty50_1y ?? null,
      score_date:        score?.date ?? null,
      invested_amount:   w.invested_amount ?? null,
      entry_price:       w.entry_price ?? null,
    }
  }).sort((a, b) => {
    // Group by industry, then by stock name within industry
    const ia = a.industry ?? 'zzz'
    const ib = b.industry ?? 'zzz'
    if (ia !== ib) return ia.localeCompare(ib)
    return a.stock_name.localeCompare(b.stock_name)
  })

  // Portfolio P&L calculation
  const portfolioRows = rows.filter(r => r.invested_amount && r.entry_price && r.current_price)
  const totalInvested = portfolioRows.reduce((s, r) => s + r.invested_amount!, 0)
  const totalCurrent  = portfolioRows.reduce((s, r) => s + (r.current_price! / r.entry_price!) * r.invested_amount!, 0)
  const totalPnl      = totalCurrent - totalInvested
  const totalPnlPct   = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0

  // Portfolio chart — % return over time for stocks with invested_amount
  // Only use daily_history from each stock's added_at date onwards
  let chartData: ChartPoint[] = []
  const portfolioRowsWithHistory = rows.filter(r => r.invested_amount && r.entry_price)
  if (portfolioRowsWithHistory.length > 0) {
    // Fetch added_at per stock for this user
    const { data: userStocksMeta } = await supabase
      .from('user_stocks')
      .select('stock_id, added_at')
      .eq('user_id', user.id)
      .in('stock_id', portfolioRowsWithHistory.map(r => r.stock_id))

    const addedAtMap: Record<string, string> = {}
    for (const us of userStocksMeta ?? []) {
      addedAtMap[us.stock_id] = us.added_at?.slice(0, 10) ?? '2000-01-01'
    }

    // Earliest date we care about
    const earliestDate = Object.values(addedAtMap).sort()[0] ?? '2000-01-01'

    const { data: history } = await supabase
      .from('daily_history')
      .select('stock_id, date, closing_price')
      .in('stock_id', portfolioRowsWithHistory.map(r => r.stock_id))
      .not('closing_price', 'is', null)
      .gte('date', earliestDate)
      .order('date', { ascending: true })

    if (history && history.length > 0) {
      // Group closing prices by date, only from each stock's added_at onwards
      const byDate: Record<string, Record<string, number>> = {}
      for (const h of history) {
        const addedAt = addedAtMap[h.stock_id] ?? '2000-01-01'
        if (h.date < addedAt) continue   // skip history before user added this stock
        if (!byDate[h.date]) byDate[h.date] = {}
        byDate[h.date][h.stock_id] = h.closing_price
      }

      // For each date, only include stocks that were already added by that date
      chartData = Object.entries(byDate)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, prices]) => {
          let currentVal = 0, investedOnDay = 0
          for (const r of portfolioRowsWithHistory) {
            const addedAt = addedAtMap[r.stock_id] ?? '2000-01-01'
            if (date < addedAt) continue    // stock not yet added on this date
            const price = prices[r.stock_id]
            if (!price) continue
            currentVal    += (price / r.entry_price!) * r.invested_amount!
            investedOnDay += r.invested_amount!
          }
          if (investedOnDay === 0) return null
          const returnPct = ((currentVal - investedOnDay) / investedOnDay) * 100
          const d = new Date(date)
          const label = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
          return { date: label, returnPct: parseFloat(returnPct.toFixed(2)) }
        })
        .filter(Boolean) as ChartPoint[]
    }
  }

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  })

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-gray-200 px-4 sm:px-6 py-3 sm:py-4 bg-white">
        {/* Top row: title + nav */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-gray-900">AI Research Desk</h1>
            <p className="text-xs text-gray-400 mt-0.5 hidden sm:block">{today}</p>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <span className="text-xs sm:text-sm text-gray-500 hidden sm:block">{user.email}</span>
            {user.email === process.env.ADMIN_EMAIL && (
              <Link
                href="/admin"
                className="text-xs sm:text-sm text-gray-500 hover:text-gray-900 transition-colors px-2 sm:px-3 py-1.5 rounded-lg hover:bg-gray-100"
              >
                Admin
              </Link>
            )}
            <Link
              href="/watchlist"
              className="text-xs sm:text-sm text-gray-500 hover:text-gray-900 transition-colors px-2 sm:px-3 py-1.5 rounded-lg hover:bg-gray-100"
            >
              Watchlist
            </Link>
            <Link
              href="/settings"
              className="text-xs sm:text-sm text-gray-500 hover:text-gray-900 transition-colors px-2 sm:px-3 py-1.5 rounded-lg hover:bg-gray-100"
            >
              Settings
            </Link>
            <SignOutButton />
          </div>
        </div>
        {/* Indices bar — scrollable on mobile */}
        <div className="mt-2 sm:mt-3 overflow-x-auto">
          <MarketIndicesBar />
        </div>
      </header>

      {/* Main content */}
      <main className="px-3 sm:px-6 py-4 sm:py-8 max-w-screen-xl mx-auto">
        {/* Stats bar */}
        <div className="grid grid-cols-2 sm:grid-cols-7 gap-3 mb-8">
          <StatCard label="Tracked"    value={rows.length.toString()} />
          <StatCard label="Cheap"      value={rows.filter(r => r.pe_deviation != null && r.pe_deviation < -30).length.toString()}                                  highlight="green" />
          <StatCard label="Discount"   value={rows.filter(r => r.pe_deviation != null && r.pe_deviation >= -30 && r.pe_deviation < -10).length.toString()}         highlight="green" />
          <StatCard label="Fair"       value={rows.filter(r => r.pe_deviation != null && r.pe_deviation >= -10 && r.pe_deviation <= 10).length.toString()} />
          <StatCard label="Premium"    value={rows.filter(r => r.pe_deviation != null && r.pe_deviation > 10 && r.pe_deviation <= 30).length.toString()}            highlight="amber" />
          <StatCard label="Expensive"  value={rows.filter(r => r.pe_deviation != null && r.pe_deviation > 30).length.toString()}                                    highlight="red" />
          <StatCard label="Oversold"   value={rows.filter(r => r.rsi != null && r.rsi < 30).length.toString()}                                                     highlight="green" />
        </div>

        {chartData.length >= 2 && (
          <div className="bg-white border border-gray-200 rounded-xl px-4 sm:px-6 py-4 shadow-sm mb-8">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Interested Portfolio Return</div>
            <PortfolioChart data={chartData} />
          </div>
        )}

        <LivePriceTable initialRows={rows} />
      </main>
    </div>
  )
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: 'green' | 'red' | 'amber'
}) {
  const valueColor =
    highlight === 'green' ? 'text-emerald-600' :
    highlight === 'red'   ? 'text-red-600' :
    highlight === 'amber' ? 'text-amber-600' :
    'text-gray-900'

  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-4 shadow-sm">
      <div className={`text-2xl font-bold ${valueColor}`}>{value}</div>
      <div className="text-xs text-gray-400 mt-1">{label}</div>
    </div>
  )
}
