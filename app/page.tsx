import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import SignOutButton from '@/components/SignOutButton'
import LivePriceTable from '@/components/LivePriceTable'
import MarketIndicesBar from '@/components/MarketIndicesBar'
import { type ChartPoint } from '@/components/PortfolioChart'

export default async function DashboardPage() {
  const supabase      = await createClient()
  const adminSupabase = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // 1. Fetch user's watchlist with stock details
  const { data: watchlist } = await supabase
    .from('user_stocks')
    .select(`
      stock_id,
      invested_amount,
      entry_price,
      nifty50_entry,
      nifty500_entry,
      notes,
      stocks (
        ticker,
        stock_name,
        industry,
        current_price,
        high_52w,
        low_52w,
        pct_from_52w_high,
        stock_pe,
        industry_pe,
        roe,
        roce,
        eps,
        pb,
        dividend_yield,
        market_cap,
        debt_to_equity,
        promoter_holding,
        current_ratio,
        total_debt,
        revenue_growth_1y,
        revenue_growth_3y,
        revenue_growth_5y,
        profit_growth_1y,
        profit_growth_3y,
        profit_growth_5y,
        reserves,
        borrowings,
        fii_holding,
        dii_holding,
        mc_scid,
        analyst_rating,
        analyst_buy_pct,
        analyst_hold_pct,
        analyst_sell_pct,
        analyst_count,
        target_mean,
        target_high,
        target_low
      )
    `)
    .eq('user_id', user.id)

  const stockIds = (watchlist ?? []).map((w: any) => w.stock_id)

  // 2. Fetch latest daily_score per stock (separate query)
  const { data: scores } = stockIds.length > 0
    ? await supabase
        .from('daily_scores')
        .select('stock_id, pe_deviation, rsi, rsi_signal, dma_50, dma_200, above_50_dma, above_200_dma, composite_score, classification, suggested_action, stock_6m, stock_1y, nifty50_6m, nifty50_1y, nifty500_6m, nifty500_1y, date')
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
      nifty50_entry:     w.nifty50_entry ?? null,
      nifty500_entry:    w.nifty500_entry ?? null,
      roe:               stock?.roe ?? null,
      roce:              stock?.roce ?? null,
      eps:               stock?.eps ?? null,
      pb:                stock?.pb ?? null,
      dividend_yield:    stock?.dividend_yield ?? null,
      market_cap:        stock?.market_cap ?? null,
      debt_to_equity:    stock?.debt_to_equity ?? null,
      promoter_holding:  stock?.promoter_holding ?? null,
      current_ratio:     stock?.current_ratio ?? null,
      total_debt:        stock?.total_debt ?? null,
      revenue_growth_1y: stock?.revenue_growth_1y ?? null,
      revenue_growth_3y: stock?.revenue_growth_3y ?? null,
      revenue_growth_5y: stock?.revenue_growth_5y ?? null,
      profit_growth_1y:  stock?.profit_growth_1y ?? null,
      profit_growth_3y:  stock?.profit_growth_3y ?? null,
      profit_growth_5y:  stock?.profit_growth_5y ?? null,
      reserves:          stock?.reserves ?? null,
      borrowings:        stock?.borrowings ?? null,
      fii_holding:       stock?.fii_holding ?? null,
      dii_holding:       stock?.dii_holding ?? null,
      nifty500_6m:       score?.nifty500_6m ?? null,
      nifty500_1y:       score?.nifty500_1y ?? null,
      notes:             w.notes ?? null,
      mc_scid:           stock?.mc_scid ?? null,
      analyst_rating:    stock?.analyst_rating ?? null,
      analyst_buy_pct:   stock?.analyst_buy_pct ?? null,
      analyst_hold_pct:  stock?.analyst_hold_pct ?? null,
      analyst_sell_pct:  stock?.analyst_sell_pct ?? null,
      analyst_count:     stock?.analyst_count ?? null,
      target_mean:       stock?.target_mean ?? null,
      target_high:       stock?.target_high ?? null,
      target_low:        stock?.target_low ?? null,
      mc_earnings_json:  null,
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

    const [{ data: history }, { data: indexHistory }] = await Promise.all([
      supabase
        .from('daily_history')
        .select('stock_id, date, closing_price')
        .in('stock_id', portfolioRowsWithHistory.map(r => r.stock_id))
        .not('closing_price', 'is', null)
        .gte('date', earliestDate)
        .order('date', { ascending: true }),
      adminSupabase
        .from('index_history')
        .select('date, nifty50_close, nifty500_close')
        .gte('date', earliestDate)
        .order('date', { ascending: true }),
    ])

    // Build date -> index lookup (slice to YYYY-MM-DD to handle any timestamp format)
    const indexByDate: Record<string, { n50: number; n500: number }> = {}
    const sortedIndexDates: string[] = []
    for (const row of indexHistory ?? []) {
      const d = row.date.slice(0, 10)
      indexByDate[d] = { n50: row.nifty50_close, n500: row.nifty500_close }
      sortedIndexDates.push(d)
    }
    sortedIndexDates.sort()

    // Returns nearest available index on or before targetDate (handles days with no close yet)
    function nearestIndex(targetDate: string) {
      let result: { n50: number; n500: number } | undefined
      for (const d of sortedIndexDates) {
        if (d <= targetDate) result = indexByDate[d]
        else break
      }
      return result
    }

    if (history && history.length > 0) {
      // Group closing prices by date, only from each stock's added_at onwards
      const byDate: Record<string, Record<string, number>> = {}
      for (const h of history) {
        const addedAt = addedAtMap[h.stock_id] ?? '2000-01-01'
        if (h.date < addedAt) continue   // skip history before user added this stock
        if (!byDate[h.date]) byDate[h.date] = {}
        byDate[h.date][h.stock_id] = h.closing_price
      }

      const sortedDates = Object.keys(byDate).sort()

      // Anchor Nifty 50 / 500 to the first chart date (simple index % from chart start)
      const firstIdx = nearestIndex(sortedDates[0])

      chartData = sortedDates
        .map((date, i) => {
          const prices = byDate[date]
          let currentVal = 0, investedOnDay = 0
          const idxNow = nearestIndex(date)

          for (const r of portfolioRowsWithHistory) {
            const addedAt = addedAtMap[r.stock_id] ?? '2000-01-01'
            if (date < addedAt) continue    // stock not yet added on this date
            const price = prices[r.stock_id]
            if (!price) continue
            currentVal    += (price / r.entry_price!) * r.invested_amount!
            investedOnDay += r.invested_amount!
          }
          if (investedOnDay === 0) return null

          const returnPct   = ((currentVal - investedOnDay) / investedOnDay) * 100
          // Nifty lines: simple % change from first chart date
          const nifty50Pct  = (firstIdx && idxNow) ? parseFloat(((idxNow.n50  / firstIdx.n50  - 1) * 100).toFixed(2)) : undefined
          const nifty500Pct = (firstIdx && idxNow) ? parseFloat(((idxNow.n500 / firstIdx.n500 - 1) * 100).toFixed(2)) : undefined

          const d = new Date(date)
          const label = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
          return { date: label, returnPct: parseFloat(returnPct.toFixed(2)), nifty50Pct, nifty500Pct }
        })
        .filter(Boolean) as ChartPoint[]
    }
  }

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  })

  const { data: fiiDiiRow } = await supabase
    .from('fii_dii_daily')
    .select('date, fii_net, dii_net')
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()

  const fiiDii = fiiDiiRow ?? null

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
            {fiiDii && (
              <div className="hidden sm:flex items-center gap-2 text-xs font-mono border border-gray-200 rounded-lg px-2.5 py-1.5 bg-gray-50">
                <span className={fiiDii.fii_net >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                  FII {fiiDii.fii_net >= 0 ? '▲' : '▼'} ₹{Math.abs(fiiDii.fii_net).toLocaleString('en-IN', { maximumFractionDigits: 0 })} Cr
                </span>
                <span className="text-gray-300">|</span>
                <span className={fiiDii.dii_net >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                  DII {fiiDii.dii_net >= 0 ? '▲' : '▼'} ₹{Math.abs(fiiDii.dii_net).toLocaleString('en-IN', { maximumFractionDigits: 0 })} Cr
                </span>
              </div>
            )}
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
              href="/market-pulse"
              className="text-xs sm:text-sm text-gray-500 hover:text-gray-900 transition-colors px-2 sm:px-3 py-1.5 rounded-lg hover:bg-gray-100"
            >
              Market Pulse
            </Link>
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
        <LivePriceTable initialRows={rows} chartData={chartData} />
      </main>
    </div>
  )
}

