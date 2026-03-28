import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import MarketIndicesBar from '@/components/MarketIndicesBar'
import MarketStatusLight from '@/components/MarketStatusLight'
import AppShell from '@/components/AppShell'
import { INDUSTRY_TO_FII_SECTOR } from '@/lib/fiiSectorMap'
import { WatchlistTodayGain, PortfolioTodayGain } from '@/components/DashboardTodayGain'
import AiBriefButton from '@/components/AiBriefButton'

// ─── helpers ────────────────────────────────────────────────────────────────

function parseFirstHeadline(text: string | null): { source: string; headline: string; url: string | null } | null {
  if (!text) return null
  const sourceMatch   = text.match(/━━\s*(.+?)\s*━━/)
  const headlineMatch = text.match(/📌\s*(.+)/)
  const urlMatch      = text.match(/🔗\s*(https?:\/\/\S+)/)
  if (!headlineMatch) return null
  return {
    source:   sourceMatch?.[1]?.trim() ?? 'News',
    headline: headlineMatch[1].trim(),
    url:      urlMatch?.[1]?.trim() ?? null,
  }
}

function fmtCr(n: number) {
  const abs = Math.abs(n)
  if (abs >= 100000) return `₹${(n / 100000).toFixed(1)}L Cr`
  if (abs >= 1000)   return `₹${(n / 1000).toFixed(1)}k Cr`
  return `₹${n.toLocaleString('en-IN')} Cr`
}

function decodeSector(s: string) { return s.replace(/&amp;/g, '&') }

const SHORT_SECTOR: Record<string, string> = {
  'Financial Services':                'Financials',
  'Information Technology':            'IT',
  'Oil, Gas & Consumable Fuels':       'Oil & Gas',
  'Automobile and Auto Components':    'Auto',
  'Fast Moving Consumer Goods':        'FMCG',
  'Capital Goods':                     'Cap Goods',
  'Consumer Services':                 'Consumer Svcs',
  'Metals & Mining':                   'Metals',
  'Telecommunication':                 'Telecom',
  'Realty':                            'Realty',
  'Power':                             'Power',
  'Construction':                      'Construction',
  'Chemicals':                         'Chemicals',
  'Healthcare':                        'Healthcare',
  'Media Entertainment & Publication': 'Media',
}


// ─── page ───────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const supabase = await createClient()
  const admin    = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Full watchlist with industry + price data
  const { data: watchlist } = await supabase
    .from('user_stocks')
    .select('stock_id, invested_amount, entry_price, stocks(ticker, industry, current_price, high_52w, low_52w, last_news_update, latest_headlines)')
    .eq('user_id', user.id)

  const today_date = new Date().toISOString().slice(0, 10)

  const allRows = (watchlist ?? []).map((w: any) => {
    const stock = Array.isArray(w.stocks) ? w.stocks[0] : w.stocks
    return { ...w, stock }
  })

  // ── Watchlist P&L ────────────────────────────────────────────────────────
  const portfolioRows = allRows.filter(w => w.invested_amount && w.entry_price && w.stock?.current_price)
  const totalInvested = portfolioRows.reduce((s: number, w: any) => s + w.invested_amount, 0)
  const totalCurrent  = portfolioRows.reduce((s: number, w: any) =>
    s + (w.stock.current_price / w.entry_price) * w.invested_amount, 0)
  const totalPnl    = totalCurrent - totalInvested
  const totalPnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0

  // ── Portfolio holdings (real) ─────────────────────────────────────────────
  const { data: portfolioHoldings } = await admin
    .from('portfolio_holdings')
    .select('stock_id, quantity, avg_price, stocks(ticker, current_price, industry, last_news_update, latest_headlines)')
    .eq('user_id', user.id)

  const portRowsAll = (portfolioHoldings ?? []).map((h: any) => {
    const stock = Array.isArray(h.stocks) ? h.stocks[0] : h.stocks
    return { ...h, stock }
  }).filter((h: any) => h.stock)

  const portRows = portRowsAll.filter((h: any) => h.stock?.current_price)

  const portInvested = portRows.reduce((s: number, h: any) => s + h.quantity * h.avg_price, 0)
  const portCurrent  = portRows.reduce((s: number, h: any) => s + h.quantity * h.stock.current_price, 0)
  const portPnl      = portCurrent - portInvested
  const portPnlPct   = portInvested > 0 ? (portPnl / portInvested) * 100 : 0

  const topHoldings = portRows
    .map((h: any) => ({
      ticker: h.stock.ticker,
      pct: h.avg_price > 0 ? ((h.stock.current_price - h.avg_price) / h.avg_price) * 100 : 0,
      alloc: portInvested > 0 ? (h.quantity * h.avg_price / portInvested) * 100 : 0,
    }))
    .sort((a: any, b: any) => b.alloc - a.alloc)
    .slice(0, 4)

  // ── Signals: latest score per stock (watchlist + portfolio combined) ────
  const watchStockIds = allRows.map((w: any) => w.stock_id).filter(Boolean)
  const portStockIds  = portRowsAll.map((h: any) => h.stock_id).filter(Boolean)
  const allStockIds   = [...new Set([...watchStockIds, ...portStockIds])]

  // stock_id → ticker map across both sources
  const stockTickerMap: Record<string, string> = {}
  for (const w of allRows)     stockTickerMap[w.stock_id]  = w.stock?.ticker ?? ''
  for (const h of portRowsAll) stockTickerMap[h.stock_id]  = h.stock?.ticker ?? ''

  // Legacy alias so existing code below doesn't break
  const stockIds = watchStockIds

  const { data: scores } = allStockIds.length > 0
    ? await supabase
        .from('daily_scores')
        .select('stock_id, rsi, above_200_dma, above_50_dma')
        .in('stock_id', allStockIds)
        .order('date', { ascending: false })
    : { data: [] }

  const latestScore: Record<string, any> = {}
  for (const s of (scores ?? [])) {
    if (!latestScore[s.stock_id]) latestScore[s.stock_id] = s
  }

  // Watchlist signals
  const filingTickers: string[] = allRows
    .filter((w: any) => w.stock?.last_news_update === today_date)
    .map((w: any) => w.stock.ticker)

  const oversoldTickers: string[] = allRows
    .filter((w: any) => (latestScore[w.stock_id]?.rsi ?? 999) < 30)
    .map((w: any) => w.stock?.ticker).filter(Boolean)

  const overboughtTickers: string[] = allRows
    .filter((w: any) => (latestScore[w.stock_id]?.rsi ?? 0) > 70)
    .map((w: any) => w.stock?.ticker).filter(Boolean)

  const below200Tickers: string[] = allRows
    .filter((w: any) => latestScore[w.stock_id]?.above_200_dma === false)
    .map((w: any) => w.stock?.ticker).filter(Boolean)

  const below50Tickers: string[] = allRows
    .filter((w: any) => latestScore[w.stock_id]?.above_50_dma === false)
    .map((w: any) => w.stock?.ticker).filter(Boolean)

  const near52wHighTickers: string[] = allRows
    .filter((w: any) => {
      const price = w.stock?.current_price
      const high  = w.stock?.high_52w
      if (!price || !high) return false
      return (price / high) >= 0.95   // within 5% of 52W high
    })
    .map((w: any) => w.stock?.ticker).filter(Boolean)

  const near52wLowTickers: string[] = allRows
    .filter((w: any) => {
      const price = w.stock?.current_price
      const high  = w.stock?.high_52w
      if (!price || !high) return false
      return (price / high) <= 0.60   // 40%+ below 52W high
    })
    .map((w: any) => w.stock?.ticker).filter(Boolean)

  // Portfolio signals
  const portOversold: string[] = portRowsAll
    .filter((h: any) => (latestScore[h.stock_id]?.rsi ?? 999) < 30)
    .map((h: any) => h.stock?.ticker).filter(Boolean)

  const portOverbought: string[] = portRowsAll
    .filter((h: any) => (latestScore[h.stock_id]?.rsi ?? 0) > 70)
    .map((h: any) => h.stock?.ticker).filter(Boolean)

  const portBelow200: string[] = portRowsAll
    .filter((h: any) => latestScore[h.stock_id]?.above_200_dma === false)
    .map((h: any) => h.stock?.ticker).filter(Boolean)

  const portHasSignals = portOversold.length > 0 || portOverbought.length > 0 || portBelow200.length > 0

  // Portfolio sector exposure vs FII
  const portSectorMap: Record<string, { count: number; invested: number }> = {}
  for (const h of portRowsAll) {
    const ind = h.stock?.industry
    const fiiSectorName = ind ? (INDUSTRY_TO_FII_SECTOR[ind] ?? ind) : null
    if (!fiiSectorName) continue
    if (!portSectorMap[fiiSectorName]) portSectorMap[fiiSectorName] = { count: 0, invested: 0 }
    portSectorMap[fiiSectorName].count++
    portSectorMap[fiiSectorName].invested += h.quantity * h.avg_price
  }
  const portTotalInvested = portRows.reduce((s: number, h: any) => s + h.quantity * h.avg_price, 0)
  const portSectorExposure = Object.entries(portSectorMap)
    .sort(([, a], [, b]) => b.invested - a.invested)
    .slice(0, 5)
    .map(([industry, { count, invested }]) => ({
      industry,
      count,
      invested,
      pct: portTotalInvested > 0 ? Math.round((invested / portTotalInvested) * 100) : 0,
    }))

  // ── Portfolio 5-day closing price (for 5d gain in KPI card) ────────────
  const price5dMap: Record<string, number> = {}
  if (portStockIds.length > 0) {
    const cutoff5d = new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10)
    const { data: hist5d } = await supabase
      .from('daily_history')
      .select('stock_id, date, closing_price')
      .in('stock_id', portStockIds)
      .not('closing_price', 'is', null)
      .gte('date', cutoff5d)
      .order('date', { ascending: true })
    // Take the oldest price in the 8-day window as the 5-day-ago proxy
    const seen5d = new Set<string>()
    for (const r of (hist5d ?? [])) {
      if (!seen5d.has(r.stock_id)) {
        price5dMap[r.stock_id] = r.closing_price
        seen5d.add(r.stock_id)
      }
    }
  }

  // ── Volume breakouts (DB-based, yesterday EOD vs 20-day avg) ────────────
  type VolumeBreakout = { ticker: string; ratio: number; vol: number; avgVol: number; isPortfolio: boolean }
  let volumeBreakouts: VolumeBreakout[] = []

  if (allStockIds.length > 0) {
    const cutoff = new Date(Date.now() - 22 * 86400000).toISOString().slice(0, 10)
    const { data: volRows } = await supabase
      .from('daily_history')
      .select('stock_id, date, volume')
      .in('stock_id', allStockIds)
      .not('volume', 'is', null)
      .gt('volume', 0)
      .gte('date', cutoff)
      .order('date', { ascending: false })

    // Group by stock_id
    const volByStock: Record<string, { date: string; volume: number }[]> = {}
    for (const r of (volRows ?? [])) {
      if (!volByStock[r.stock_id]) volByStock[r.stock_id] = []
      volByStock[r.stock_id].push({ date: r.date, volume: r.volume })
    }

    const portStockIdSet = new Set(portStockIds)
    for (const [stockId, rows] of Object.entries(volByStock)) {
      if (rows.length < 6) continue           // need at least 6 days of data
      const [latest, ...rest] = rows           // latest = most recent trading day
      const window = rest.slice(0, 20)         // up to 20 prior days for avg
      if (!window.length) continue
      const avgVol = window.reduce((s, r) => s + r.volume, 0) / window.length
      if (!avgVol) continue
      const ratio  = latest.volume / avgVol
      if (ratio < 1.5) continue               // threshold: 1.5x avg
      const ticker = stockTickerMap[stockId]
      if (!ticker) continue
      volumeBreakouts.push({
        ticker,
        ratio,
        vol:    latest.volume,
        avgVol: Math.round(avgVol),
        isPortfolio: portStockIdSet.has(stockId),
      })
    }
    volumeBreakouts.sort((a, b) => b.ratio - a.ratio)
  }

  // Volume alerts for activity board (>=2x avg — dedicated section now)
  const volumeAlerts = volumeBreakouts.filter(v => v.ratio >= 2)

  // Watchlist movers (virtual P&L, by entry price)
  const watchlistMovers = allRows
    .filter((w: any) => w.entry_price && w.stock?.current_price)
    .map((w: any) => ({
      ticker:    w.stock.ticker as string,
      returnPct: ((w.stock.current_price - w.entry_price) / w.entry_price) * 100,
    }))
    .sort((a: any, b: any) => b.returnPct - a.returnPct)
  const watchGainers = watchlistMovers.slice(0, 2)
  const watchLosers  = [...watchlistMovers].reverse().slice(0, 2).filter((h: any) => h.returnPct < 0)

  // Activity board — news items (last 2 days, watchlist + portfolio, deduplicated)
  const yesterday_date = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  type NewsItem = { ticker: string; source: string; headline: string; url: string | null; isPortfolio: boolean; lastUpdate: string }
  const newsItems: NewsItem[] = []
  const newsTickerSet = new Set<string>()

  for (const w of allRows) {
    const t = w.stock?.ticker
    if (!t || newsTickerSet.has(t)) continue
    if ((w.stock?.last_news_update ?? '') >= yesterday_date) {
      const parsed = parseFirstHeadline(w.stock?.latest_headlines)
      if (parsed) { newsItems.push({ ticker: t, ...parsed, isPortfolio: false, lastUpdate: w.stock?.last_news_update ?? '' }); newsTickerSet.add(t) }
    }
  }
  for (const h of portRowsAll) {
    const t = h.stock?.ticker
    if (!t || newsTickerSet.has(t)) continue
    if ((h.stock?.last_news_update ?? '') >= yesterday_date) {
      const parsed = parseFirstHeadline(h.stock?.latest_headlines)
      if (parsed) { newsItems.push({ ticker: t, ...parsed, isPortfolio: true, lastUpdate: h.stock?.last_news_update ?? '' }); newsTickerSet.add(t) }
    }
  }
  // Sort by most recent update first so today's filings always appear at top
  newsItems.sort((a, b) => (b.lastUpdate ?? '').localeCompare(a.lastUpdate ?? ''))

  // Activity board — combined technical alerts
  const actOversold  = [...new Set([...oversoldTickers,  ...portOversold])]
  const actOverbought= [...new Set([...overboughtTickers, ...portOverbought])]
  const actBelow200  = [...new Set([...below200Tickers,   ...portBelow200])]

  // Activity board — portfolio movers
  const portMovers = portRows
    .map((h: any) => ({
      ticker:    h.stock.ticker,
      returnPct: h.avg_price > 0 ? ((h.stock.current_price - h.avg_price) / h.avg_price) * 100 : 0,
      alloc:     portTotalInvested > 0 ? (h.quantity * h.avg_price / portTotalInvested) * 100 : 0,
    }))
    .sort((a: any, b: any) => b.returnPct - a.returnPct)

  const portGainers = portMovers.slice(0, 2)
  const portLosers  = [...portMovers].reverse().slice(0, 2).filter((h: any) => h.returnPct < 0)

  // ── Sector exposure (watchlist + portfolio combined, deduplicated by ticker) ──
  const sectorMap: Record<string, { count: number; invested: number; tickers: string[] }> = {}
  const seenSectorTickers = new Set<string>()

  for (const w of allRows) {
    const ticker = w.stock?.ticker
    if (!ticker || seenSectorTickers.has(ticker)) continue
    seenSectorTickers.add(ticker)
    const ind = w.stock?.industry
    const fiiSectorName = ind ? (INDUSTRY_TO_FII_SECTOR[ind] ?? ind) : null
    if (!fiiSectorName) continue
    if (!sectorMap[fiiSectorName]) sectorMap[fiiSectorName] = { count: 0, invested: 0, tickers: [] }
    sectorMap[fiiSectorName].count++
    sectorMap[fiiSectorName].invested += w.invested_amount ?? 0
    sectorMap[fiiSectorName].tickers.push(ticker)
  }
  for (const h of portRowsAll) {
    const ticker = h.stock?.ticker
    if (!ticker || seenSectorTickers.has(ticker)) continue
    seenSectorTickers.add(ticker)
    const ind = h.stock?.industry
    const fiiSectorName = ind ? (INDUSTRY_TO_FII_SECTOR[ind] ?? ind) : null
    if (!fiiSectorName) continue
    if (!sectorMap[fiiSectorName]) sectorMap[fiiSectorName] = { count: 0, invested: 0, tickers: [] }
    sectorMap[fiiSectorName].count++
    sectorMap[fiiSectorName].invested += h.quantity * h.avg_price
    sectorMap[fiiSectorName].tickers.push(ticker)
  }

  const totalSectorInvested = Object.values(sectorMap).reduce((s, v) => s + v.invested, 0)
  const totalSectorWeight   = totalSectorInvested > 0 ? totalSectorInvested : seenSectorTickers.size

  const sectorExposure = Object.entries(sectorMap)
    .sort(([, a], [, b]) => (b.invested !== a.invested ? b.invested - a.invested : b.count - a.count))
    .slice(0, 5)
    .map(([industry, { count, invested, tickers }]) => ({
      industry,
      count,
      invested,
      tickers,
      pct: totalSectorWeight > 0
        ? Math.round((totalSectorInvested > 0 ? invested : count) / totalSectorWeight * 100)
        : 0,
    }))

  // ── FII data ─────────────────────────────────────────────────────────────
  const cutoff24h = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const [{ data: fiiSectors }, { data: fiiDiiRows }, { data: mfRows }, { data: trumpAlertRows }, { data: marketAlertRows }] = await Promise.all([
    supabase.from('fii_sector').select('sector, fortnight_flow'),
    supabase.from('fii_dii_daily')
      .select('date, fii_net, dii_net')
      .order('date', { ascending: false })
      .limit(7),
    supabase.from('mf_sebi_daily')
      .select('date, eq_net, dbt_net')
      .order('date', { ascending: false })
      .limit(2),
    admin.from('macro_alerts')
      .select('channel, summary, created_at')
      .in('channel', ['trump_ts_posts', 'trumptruthposts'])
      .gte('created_at', cutoff24h)
      .order('created_at', { ascending: false })
      .limit(4),
    admin.from('macro_alerts')
      .select('channel, summary, created_at')
      .eq('channel', 'et_markets')
      .gte('created_at', cutoff24h)
      .order('created_at', { ascending: false })
      .limit(4),
  ])

  const mfRow  = mfRows?.[0] ?? null
  const mfYest = mfRows?.[1] ?? null

  // Skip rows with null fii_net/dii_net (can happen when scraper inserts partial row)
  const fiiDiiRow  = (fiiDiiRows ?? []).find(r => r.fii_net != null && r.dii_net != null) ?? null
  const fiiDiiYest = (fiiDiiRows ?? []).filter(r => r.fii_net != null && r.dii_net != null)[1] ?? null

  // 5-day rolling net (guard against null values)
  const fii5d = (fiiDiiRows ?? []).slice(0, 5).reduce((s, r) => s + (r.fii_net ?? 0), 0)
  const dii5d = (fiiDiiRows ?? []).slice(0, 5).reduce((s, r) => s + (r.dii_net ?? 0), 0)

  // Consecutive FII streak (buying or selling)
  let fiiStreak = 0
  let fiiStreakDir: 'buying' | 'selling' | null = null
  for (const r of (fiiDiiRows ?? [])) {
    const dir = r.fii_net >= 0 ? 'buying' : 'selling'
    if (fiiStreakDir === null) { fiiStreakDir = dir; fiiStreak = 1 }
    else if (dir === fiiStreakDir) fiiStreak++
    else break
  }

  // Build FII sector name → flow map (decoded)
  const fiiFlowMap: Record<string, number> = {}
  for (const s of (fiiSectors ?? [])) {
    fiiFlowMap[decodeSector(s.sector)] = s.fortnight_flow ?? 0
  }

  const validSectors = Object.entries(fiiFlowMap)
    .map(([name, flow]) => ({ name, flow }))
    .filter(s => s.flow !== 0)
    .sort((a, b) => b.flow - a.flow)

  const top3 = validSectors.slice(0, 4)
  const bot3 = validSectors.slice(-4).reverse()
  const sectorBuyCount  = validSectors.filter(s => s.flow > 0).length
  const sectorSellCount = validSectors.filter(s => s.flow < 0).length

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  })

  const watchlistCount = allRows.length
  const hasSignals = filingTickers.length > 0 || oversoldTickers.length > 0 ||
                     overboughtTickers.length > 0 || below200Tickers.length > 0

  const isAdmin = user.email === process.env.ADMIN_EMAIL

  return (
    <AppShell userEmail={user.email!} isAdmin={isAdmin}>
      <div className="px-6 py-5 max-w-screen-xl mx-auto">

        {/* ── Page header ─────────────────────────────────────────────── */}
        <div className="mb-5">
          <div className="flex items-center gap-3 mb-2">
            <p className="text-xs" style={{ color: 'var(--artha-text-muted)' }}>{today}</p>
            <MarketStatusLight />
          </div>
          <MarketIndicesBar />
        </div>

        {/* ── KPI row ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">

          {/* Watchlist Return */}
          {(() => {
            const positive = totalPnl >= 0
            const accentColor = positive ? 'var(--artha-teal)' : 'var(--artha-negative)'
            const accentBg    = positive ? 'var(--artha-teal-subtle)' : 'var(--artha-negative-bg)'
            return (
              <Link href="/watchlist" className="artha-card artha-card-hover block overflow-hidden" style={{ padding: 0 }}>
                {/* Coloured top accent */}
                <div className="h-1 w-full" style={{ background: totalInvested > 0 ? accentColor : 'var(--artha-surface-low)' }} />
                <div className="px-5 py-4">
                  {/* Header row */}
                  <div className="flex items-center justify-between mb-3">
                    <span className="artha-label">Watchlist Return</span>
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: 'var(--artha-surface-low)', color: 'var(--artha-text-muted)' }}>
                      {watchlistCount} stocks
                    </span>
                  </div>
                  {totalInvested > 0 ? (
                    <>
                      {/* Main return */}
                      <div className="flex items-end justify-between gap-3 mb-3">
                        <div>
                          <div className="font-display font-bold text-3xl leading-none" style={{ color: accentColor, letterSpacing: '-0.03em' }}>
                            {positive ? '+' : ''}{totalPnlPct.toFixed(2)}%
                          </div>
                          <div className="text-xs mt-1.5 font-mono" style={{ color: 'var(--artha-text-muted)' }}>
                            {positive ? '+' : '−'}₹{Math.abs(totalPnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })} total P&amp;L
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[11px]" style={{ color: 'var(--artha-text-faint)' }}>Invested</div>
                          <div className="text-xs font-mono font-semibold" style={{ color: 'var(--artha-text-secondary)' }}>
                            ₹{totalInvested.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                          </div>
                        </div>
                      </div>
                      {/* Today's gain row */}
                      <WatchlistTodayGain rows={portfolioRows
                        .filter((w: any) => w.invested_amount && w.entry_price && w.stock?.current_price)
                        .map((w: any) => ({ ticker: w.stock.ticker, invested: w.invested_amount, entryPrice: w.entry_price, currentPrice: w.stock.current_price }))} />
                    </>
                  ) : (
                    <div className="text-sm py-2" style={{ color: 'var(--artha-text-muted)' }}>
                      {watchlistCount} stocks tracked · set entry prices to see P&amp;L
                    </div>
                  )}
                </div>
              </Link>
            )
          })()}

          {/* Portfolio Return */}
          {(() => {
            const positive = portPnl >= 0
            const accentColor = portRows.length > 0 ? (positive ? 'var(--artha-teal)' : 'var(--artha-negative)') : 'var(--artha-text-faint)'
            return (
              <Link href="/portfolio" className="artha-card artha-card-hover block overflow-hidden" style={{ padding: 0 }}>
                <div className="h-1 w-full" style={{ background: portRows.length > 0 ? accentColor : 'var(--artha-surface-low)' }} />
                <div className="px-5 py-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="artha-label">Portfolio Return</span>
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: 'var(--artha-surface-low)', color: 'var(--artha-text-muted)' }}>
                      {portRows.length} holdings
                    </span>
                  </div>
                  {portRows.length > 0 ? (
                    <>
                      <div className="flex items-end justify-between gap-3 mb-3">
                        <div>
                          <div className="font-display font-bold text-3xl leading-none" style={{ color: accentColor, letterSpacing: '-0.03em' }}>
                            {positive ? '+' : ''}{portPnlPct.toFixed(2)}%
                          </div>
                          <div className="text-xs mt-1.5 font-mono" style={{ color: 'var(--artha-text-muted)' }}>
                            {positive ? '+' : '−'}₹{Math.abs(portPnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })} total P&amp;L
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[11px]" style={{ color: 'var(--artha-text-faint)' }}>Invested</div>
                          <div className="text-xs font-mono font-semibold" style={{ color: 'var(--artha-text-secondary)' }}>
                            ₹{portInvested.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                          </div>
                        </div>
                      </div>
                      <PortfolioTodayGain rows={portRows.map((h: any) => ({ ticker: h.stock.ticker, quantity: h.quantity, currentPrice: h.stock.current_price, price5dAgo: price5dMap[h.stock_id] ?? null }))} />
                    </>
                  ) : (
                    <div className="text-sm py-2" style={{ color: 'var(--artha-text-muted)' }}>No holdings yet</div>
                  )}
                </div>
              </Link>
            )
          })()}

        </div>

        {/* ── Main grid ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

          {/* ── Left: Activity feed (2/3 width) ───────────────────────── */}
          <div className="xl:col-span-2 space-y-5">

            {/* News feed */}
            <div className="artha-card px-5 py-5">
              <div className="flex items-center justify-between mb-4">
                <div className="artha-label">Recent BSE Filings</div>
                <div className="text-xs" style={{ color: 'var(--artha-text-faint)' }}>Last 48 hours</div>
              </div>
              {newsItems.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--artha-text-muted)' }}>No news in the last 48 hours.</p>
              ) : (
                <div className="space-y-4">
                  {newsItems.slice(0, 8).map((item, i) => (
                    <div key={i} className="flex gap-3 items-start">
                      <div className="shrink-0 w-16 pt-0.5">
                        <span
                          className="block w-full text-center font-mono font-bold text-xs px-1 py-0.5 rounded-md truncate"
                          style={{
                            background: item.isPortfolio ? 'var(--artha-surface-low)' : 'var(--artha-surface)',
                            color: item.isPortfolio ? 'var(--artha-primary)' : 'var(--artha-text-secondary)',
                            border: `1px solid ${item.isPortfolio ? 'rgba(0,61,155,0.15)' : 'rgba(11,28,48,0.08)'}`,
                          }}
                        >
                          {item.ticker}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="artha-label mb-0.5">{item.source}</div>
                        {item.url ? (
                          <a href={item.url} target="_blank" rel="noopener noreferrer"
                            className="text-sm leading-snug line-clamp-2 hover:underline"
                            style={{ color: 'var(--artha-text-secondary)' }}>
                            {item.headline}
                          </a>
                        ) : (
                          <p className="text-sm leading-snug line-clamp-2" style={{ color: 'var(--artha-text-secondary)' }}>
                            {item.headline}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Activity: signals + volume alerts */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">

              {/* Technical signals */}
              <div className="artha-card px-5 py-5">
                <div className="artha-label mb-4">Technical Signals</div>
                {(actOversold.length + actOverbought.length + actBelow200.length + below50Tickers.length + near52wHighTickers.length + near52wLowTickers.length) === 0 ? (
                  <p className="text-sm" style={{ color: 'var(--artha-text-muted)' }}>No signals right now.</p>
                ) : (
                  <div className="space-y-3">
                    {actOversold.length > 0 && <SignalChip label="Oversold (RSI<30)" tickers={actOversold} color="blue" />}
                    {actOverbought.length > 0 && <SignalChip label="Overbought (RSI>70)" tickers={actOverbought} color="orange" />}
                    {actBelow200.length > 0 && <SignalChip label="Below 200 DMA" tickers={actBelow200} color="red" />}
                    {below50Tickers.length > 0 && <SignalChip label="Below 50 DMA" tickers={below50Tickers} color="orange" />}
                    {near52wHighTickers.length > 0 && <SignalChip label="Near 52W High (≤5%)" tickers={near52wHighTickers} color="teal" />}
                    {near52wLowTickers.length > 0 && <SignalChip label="Near 52W Low (≥40% off)" tickers={near52wLowTickers} color="red" />}
                  </div>
                )}
              </div>

              {/* Volume alerts */}
              <div className="artha-card px-5 py-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="artha-label">Volume Breakouts</div>
                  <div className="text-xs" style={{ color: 'var(--artha-text-faint)' }}>vs 20d avg</div>
                </div>
                {volumeAlerts.length === 0 ? (
                  <p className="text-sm" style={{ color: 'var(--artha-text-muted)' }}>No unusual volume yesterday.</p>
                ) : (
                  <div className="space-y-2.5">
                    {volumeAlerts.slice(0, 6).map(v => (
                      <div key={v.ticker} className="flex items-center justify-between">
                        <span
                          className="font-mono font-bold text-xs px-2 py-0.5 rounded"
                          style={{
                            background: v.isPortfolio ? 'var(--artha-surface-low)' : 'var(--artha-surface)',
                            color: v.isPortfolio ? 'var(--artha-primary)' : 'var(--artha-text)',
                          }}
                        >
                          {v.ticker}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs" style={{ color: 'var(--artha-text-muted)' }}>
                            {v.vol >= 1000000 ? `${(v.vol / 1000000).toFixed(1)}M` : `${(v.vol / 1000).toFixed(0)}K`}
                          </span>
                          <span
                            className="font-mono font-bold text-xs"
                            style={{ color: v.ratio >= 3 ? 'var(--artha-negative)' : v.ratio >= 2 ? '#ea580c' : '#d97706' }}
                          >
                            {v.ratio.toFixed(1)}×
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Macro alerts: Trump + Markets */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="artha-card px-5 py-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="artha-label">🇺🇸 Trump Watch</div>
                  {(trumpAlertRows ?? []).length > 0 && (
                    <AiBriefButton items={trumpAlertRows ?? []} type="trump" title="Trump Watch" />
                  )}
                </div>
                {(trumpAlertRows ?? []).length === 0 ? (
                  <p className="text-sm" style={{ color: 'var(--artha-text-muted)' }}>No market-relevant posts this week.</p>
                ) : (
                  <div className="space-y-3">
                    {(trumpAlertRows ?? []).map((alert, i) => {
                      const mins = Math.round((Date.now() - new Date(alert.created_at).getTime()) / 60000)
                      const ago  = mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.floor(mins / 60)}h ago` : `${Math.floor(mins / 1440)}d ago`
                      return (
                        <div key={i}>
                          <div className="text-xs mb-0.5" style={{ color: 'var(--artha-text-faint)' }}>{ago}</div>
                          <p className="text-sm leading-snug" style={{ color: 'var(--artha-text-secondary)' }}>{alert.summary}</p>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="artha-card px-5 py-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="artha-label">📰 Macro News</div>
                  {(marketAlertRows ?? []).length > 0 && (
                    <AiBriefButton items={marketAlertRows ?? []} type="macro" title="Macro News" />
                  )}
                </div>
                {(marketAlertRows ?? []).length === 0 ? (
                  <p className="text-sm" style={{ color: 'var(--artha-text-muted)' }}>No macro news this week.</p>
                ) : (
                  <div className="space-y-3">
                    {(marketAlertRows ?? []).map((alert, i) => {
                      const mins = Math.round((Date.now() - new Date(alert.created_at).getTime()) / 60000)
                      const ago  = mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.floor(mins / 60)}h ago` : `${Math.floor(mins / 1440)}d ago`
                      return (
                        <div key={i}>
                          <div className="text-xs mb-0.5" style={{ color: 'var(--artha-text-faint)' }}>{ago}</div>
                          <p className="text-sm leading-snug" style={{ color: 'var(--artha-text-secondary)' }}>{alert.summary}</p>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Right: Data sidebar (1/3 width) ───────────────────────── */}
          <div className="space-y-4">

            {/* FII / DII detail */}
            {fiiDiiRow && (
              <div className="artha-card px-4 py-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="artha-label">FII · DII Flows</div>
                  <div className="text-xs" style={{ color: 'var(--artha-text-faint)' }}>
                    {new Date(fiiDiiRow.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {[
                    { label: 'FII Net', val: fiiDiiRow.fii_net, prev: fiiDiiYest?.fii_net, rolling: fii5d },
                    { label: 'DII Net', val: fiiDiiRow.dii_net, prev: fiiDiiYest?.dii_net, rolling: dii5d },
                  ].map(({ label, val, prev, rolling }) => (
                    <div
                      key={label}
                      className="rounded-xl px-3 py-2.5"
                      style={{ background: val >= 0 ? 'var(--artha-teal-subtle)' : 'var(--artha-negative-bg)' }}
                    >
                      <div className="artha-label mb-1">{label}</div>
                      <div className="font-display font-bold text-sm" style={{ color: val >= 0 ? 'var(--artha-teal)' : 'var(--artha-negative)' }}>
                        {val >= 0 ? '+' : ''}{fmtCr(val)}
                      </div>
                      {prev != null && (
                        <div className="text-xs mt-0.5" style={{ color: 'var(--artha-text-muted)' }}>
                          5d: <span style={{ color: rolling >= 0 ? 'var(--artha-teal)' : 'var(--artha-negative)' }}>
                            {rolling >= 0 ? '+' : ''}{fmtCr(rolling)}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {fiiStreakDir && fiiStreak >= 2 && (
                  <div
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg"
                    style={{
                      background: fiiStreakDir === 'buying' ? 'var(--artha-teal-subtle)' : 'var(--artha-negative-bg)',
                      color: fiiStreakDir === 'buying' ? 'var(--artha-teal)' : 'var(--artha-negative)',
                    }}
                  >
                    FII {fiiStreakDir} for {fiiStreak} consecutive days
                  </div>
                )}
              </div>
            )}

            {/* MF SEBI */}
            {mfRow && (
              <div className="artha-card px-4 py-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="artha-label">MF · SEBI Flows</div>
                  <div className="text-xs" style={{ color: 'var(--artha-text-faint)' }}>
                    {new Date(mfRow.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Equity', val: mfRow.eq_net ?? 0 },
                    { label: 'Debt',   val: mfRow.dbt_net ?? 0 },
                  ].map(({ label, val }) => (
                    <div key={label} className="rounded-xl px-3 py-2.5" style={{ background: val >= 0 ? 'var(--artha-teal-subtle)' : 'var(--artha-negative-bg)' }}>
                      <div className="artha-label mb-1">{label}</div>
                      <div className="font-display font-bold text-sm" style={{ color: val >= 0 ? 'var(--artha-teal)' : 'var(--artha-negative)' }}>
                        {val >= 0 ? '+' : ''}{fmtCr(val)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sector Exposure vs FII */}
            {sectorExposure.length > 0 && (
              <div className="artha-card px-4 py-4">
                <div className="flex items-center justify-between mb-1">
                  <div className="artha-label">Your Sectors vs FII</div>
                </div>
                <p className="text-[11px] mb-3" style={{ color: 'var(--artha-text-muted)' }}>
                  Portfolio allocation · FII fortnight flow
                </p>
                <div className="space-y-2">
                  {sectorExposure.map(({ industry, count, pct, tickers }) => {
                    const fiiFlow = fiiFlowMap[industry] ?? null
                    const short   = SHORT_SECTOR[industry] ?? industry
                    const buying  = fiiFlow != null && fiiFlow > 1000
                    const selling = fiiFlow != null && fiiFlow < -1000
                    const neutral = fiiFlow != null && !buying && !selling
                    const noData  = fiiFlow == null

                    const rowBg    = buying  ? 'rgba(0,106,97,0.06)'  : selling ? 'rgba(192,57,43,0.06)' : 'var(--artha-surface)'
                    const barColor = buying  ? 'var(--artha-teal)'    : selling ? 'var(--artha-negative)' : 'var(--artha-text-faint)'
                    const fiiColor = buying  ? 'var(--artha-teal)'    : selling ? 'var(--artha-negative)' : 'var(--artha-text-muted)'
                    const fiiLabel = buying  ? '↑ FII buying'         : selling ? '↓ FII selling'         : neutral ? 'Neutral' : '—'

                    return (
                      <div
                        key={industry}
                        className="rounded-xl px-3 py-2.5"
                        style={{ background: rowBg }}
                      >
                        {/* Row: sector · stocks pill · [spacer] · % · FII badge */}
                        <div className="flex items-center gap-2 mb-1.5">
                          {/* Sector name — takes all remaining space */}
                          <span className="text-xs font-semibold flex-1 truncate" style={{ color: 'var(--artha-text)' }}>{short}</span>

                          {/* Stock count pill with hover tooltip */}
                          <span
                            className="relative group text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 cursor-default"
                            style={{ background: 'rgba(11,28,48,0.06)', color: 'var(--artha-text-muted)' }}
                          >
                            {count}×
                            <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-10 hidden group-hover:flex flex-col gap-0.5 rounded-lg px-2.5 py-2 shadow-lg whitespace-nowrap"
                              style={{ background: 'var(--artha-navy)' }}>
                              {tickers.map(t => (
                                <span key={t} className="font-mono font-bold text-[11px]" style={{ color: '#fff' }}>{t}</span>
                              ))}
                              <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent" style={{ borderTopColor: 'var(--artha-navy)' }} />
                            </span>
                          </span>

                          {/* Allocation % — fixed width, right-aligned */}
                          <span className="font-mono font-bold text-xs w-8 text-right shrink-0" style={{ color: 'var(--artha-text)' }}>{pct}%</span>

                          {/* FII badge — fixed width, centered */}
                          <span
                            className="text-[10px] font-semibold px-0 py-0.5 rounded text-center shrink-0"
                            style={{
                              width: '76px',
                              background: buying ? 'var(--artha-teal-subtle)' : selling ? 'var(--artha-negative-bg)' : 'rgba(11,28,48,0.06)',
                              color: noData ? 'transparent' : fiiColor,
                            }}
                          >
                            {noData ? '—' : fiiLabel}
                          </span>
                        </div>

                        {/* Progress bar */}
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(11,28,48,0.08)' }}>
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: barColor }} />
                        </div>

                        {/* FII flow amount */}
                        {fiiFlow != null && (
                          <div className="text-[10px] mt-1 text-right" style={{ color: fiiColor }}>
                            {fiiFlow >= 0 ? '+' : ''}{fmtCr(fiiFlow)} fortnight
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* FII sector top movers */}
            {(top3.length > 0 || bot3.length > 0) && (
              <div className="artha-card px-4 py-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="artha-label">FII Sector Flows</div>
                  <div className="text-xs" style={{ color: 'var(--artha-text-faint)' }}>Fortnight</div>
                </div>
                {top3.length > 0 && (
                  <div className="mb-3">
                    <div className="text-xs font-semibold mb-1.5" style={{ color: 'var(--artha-teal)' }}>Top Buying</div>
                    <div className="space-y-1.5">
                      {top3.map(s => (
                        <div key={s.name} className="flex items-center justify-between gap-2">
                          <span className="text-xs truncate" style={{ color: 'var(--artha-text-secondary)' }}>{s.name}</span>
                          <span className="font-mono font-bold text-xs shrink-0" style={{ color: 'var(--artha-teal)' }}>+{fmtCr(s.flow)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {bot3.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold mb-1.5" style={{ color: 'var(--artha-negative)' }}>Top Selling</div>
                    <div className="space-y-1.5">
                      {bot3.map(s => (
                        <div key={s.name} className="flex items-center justify-between gap-2">
                          <span className="text-xs truncate" style={{ color: 'var(--artha-text-secondary)' }}>{s.name}</span>
                          <span className="font-mono font-bold text-xs shrink-0" style={{ color: 'var(--artha-negative)' }}>{fmtCr(s.flow)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  )
}

// ─── helper components ───────────────────────────────────────────────────────

function SignalChip({ label, tickers, color }: {
  label:   string
  tickers: string[]
  color:   'amber' | 'blue' | 'orange' | 'red' | 'teal'
}) {
  const styles = {
    amber:  { bg: '#fef3c7', text: '#92400e' },
    blue:   { bg: 'var(--artha-surface-low)', text: 'var(--artha-primary)' },
    orange: { bg: '#fff7ed', text: '#9a3412' },
    red:    { bg: 'var(--artha-negative-bg)', text: 'var(--artha-negative)' },
    teal:   { bg: 'var(--artha-teal-subtle)', text: 'var(--artha-teal)' },
  }
  const s = styles[color]
  return (
    <div>
      <div className="text-xs font-semibold mb-1.5" style={{ color: s.text }}>{label}</div>
      <div className="flex flex-wrap gap-1">
        {tickers.slice(0, 6).map(t => (
          <span
            key={t}
            className="font-mono font-bold text-xs px-2 py-0.5 rounded-md"
            style={{ background: s.bg, color: s.text }}
          >
            {t}
          </span>
        ))}
        {tickers.length > 6 && (
          <span className="text-xs self-center" style={{ color: 'var(--artha-text-muted)' }}>+{tickers.length - 6}</span>
        )}
      </div>
    </div>
  )
}

// Legacy — keep for any remaining references
function SignalRow({ label, tickers, color }: {
  label:   string
  tickers: string[]
  color:   'amber' | 'blue' | 'orange' | 'red'
}) {
  return <SignalChip label={label} tickers={tickers} color={color} />
}

