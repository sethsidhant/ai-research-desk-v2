import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import MarketIndicesBar from '@/components/MarketIndicesBar'
import MarketStatusLight from '@/components/MarketStatusLight'
import AppShell from '@/components/AppShell'
import { INDUSTRY_TO_FII_SECTOR } from '@/lib/fiiSectorMap'
import { WatchlistReturnCard, PortfolioReturnCard } from '@/components/DashboardReturnCard'
import MarketBreadthCard, { type SignalGroup } from '@/components/MarketBreadthCard'
import PortfolioMovers, { type TurningPoint } from '@/components/PortfolioMovers'
import CollapsibleSection from '@/components/CollapsibleSection'
import WatchlistMiniSection, { type WatchRow } from '@/components/WatchlistMiniSection'
import PortfolioMiniSection, { type PortRow } from '@/components/PortfolioMiniSection'
import EtfSpotlight, { type EtfMeta } from '@/components/EtfSpotlight'
import GlobalMiniWidget from '@/components/GlobalMiniWidget'
import NewsTabs, { type NewsItem, type MacroItem } from '@/components/NewsTabs'
import MarketPulsePanel from '@/components/MarketPulsePanel'

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


  // ── Signals: latest score per stock (watchlist + portfolio combined) ────
  const watchStockIds = allRows.map((w: any) => w.stock_id).filter(Boolean)
  const portStockIds  = portRowsAll.map((h: any) => h.stock_id).filter(Boolean)
  const allStockIds   = [...new Set([...watchStockIds, ...portStockIds])]

  // stock_id → ticker map across both sources
  const stockTickerMap: Record<string, string> = {}
  for (const w of allRows)     stockTickerMap[w.stock_id]  = w.stock?.ticker ?? ''
  for (const h of portRowsAll) stockTickerMap[h.stock_id]  = h.stock?.ticker ?? ''

  const { data: scores } = allStockIds.length > 0
    ? await supabase
        .from('daily_scores')
        .select('stock_id, rsi, above_200_dma, above_50_dma')
        .in('stock_id', allStockIds)
        .order('date', { ascending: false })
        .limit(allStockIds.length * 10)
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

  // Activity board — news items (last 2 days, watchlist + portfolio, deduplicated)
  const yesterday_date = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  type RawNewsItem = { ticker: string; source: string; headline: string; url: string | null; isPortfolio: boolean; lastUpdate: string }
  const rawNewsItems: RawNewsItem[] = []
  const newsTickerSet = new Set<string>()

  for (const w of allRows) {
    const t = w.stock?.ticker
    if (!t || newsTickerSet.has(t)) continue
    if ((w.stock?.last_news_update ?? '') >= yesterday_date) {
      const parsed = parseFirstHeadline(w.stock?.latest_headlines)
      if (parsed) { rawNewsItems.push({ ticker: t, ...parsed, isPortfolio: false, lastUpdate: w.stock?.last_news_update ?? '' }); newsTickerSet.add(t) }
    }
  }
  for (const h of portRowsAll) {
    const t = h.stock?.ticker
    if (!t || newsTickerSet.has(t)) continue
    if ((h.stock?.last_news_update ?? '') >= yesterday_date) {
      const parsed = parseFirstHeadline(h.stock?.latest_headlines)
      if (parsed) { rawNewsItems.push({ ticker: t, ...parsed, isPortfolio: true, lastUpdate: h.stock?.last_news_update ?? '' }); newsTickerSet.add(t) }
    }
  }
  // Sort by most recent update first so today's filings always appear at top
  rawNewsItems.sort((a, b) => (b.lastUpdate ?? '').localeCompare(a.lastUpdate ?? ''))

  const newsItems: NewsItem[] = rawNewsItems.map(({ lastUpdate, ...rest }) => rest)

  // Activity board — combined technical alerts
  const actOversold  = [...new Set([...oversoldTickers,  ...portOversold])]
  const actOverbought= [...new Set([...overboughtTickers, ...portOverbought])]
  const actBelow200  = [...new Set([...below200Tickers,   ...portBelow200])]

  // Market breadth — DMA + RSI distribution across all tracked stocks
  const stocksWithScores = allStockIds.filter(id => latestScore[id] !== undefined)
  const breadthAbove200  = stocksWithScores.filter(id => latestScore[id]?.above_200_dma === true).length
  const breadthBelow200  = actBelow200.length
  const breadthOversold  = actOversold.length
  const breadthOverbought = actOverbought.length

  // Signals for MarketBreadthCard
  const breadthSignals: SignalGroup[] = (
    [
      { shortLabel: 'RSI <30',  type: 'oversold'   as const, tickers: actOversold },
      { shortLabel: 'RSI >70',  type: 'overbought' as const, tickers: actOverbought },
      { shortLabel: '< 200D',   type: 'below200'   as const, tickers: actBelow200 },
      { shortLabel: '< 50D',    type: 'below50'    as const, tickers: below50Tickers },
      { shortLabel: '52W High', type: 'high52w'    as const, tickers: near52wHighTickers },
      { shortLabel: '52W Low',  type: 'low52w'     as const, tickers: near52wLowTickers },
    ] satisfies SignalGroup[]
  ).filter(s => s.tickers.length > 0)

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
      .limit(30),
    supabase.from('mf_sebi_daily')
      .select('date, eq_net, dbt_net')
      .order('date', { ascending: false })
      .limit(90),
    admin.from('macro_alerts')
      .select('channel, summary, created_at, important, affected_sectors')
      .in('channel', ['trump', 'trump_ts_posts', 'trumptruthposts'])
      .gte('created_at', cutoff24h)
      .order('created_at', { ascending: false })
      .limit(100),
    admin.from('macro_alerts')
      .select('channel, summary, created_at, important, affected_sectors')
      .in('channel', ['moneycontrol', 'et_markets'])
      .gte('created_at', cutoff24h)
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  // ── ETF Spotlight ─────────────────────────────────────────────────────────
  const { data: etfSpotlight } = await admin
    .from('etfs')
    .select('ticker,name,category,aum_cr,expense_ratio')
    .not('aum_cr', 'is', null)
    .order('aum_cr', { ascending: false })
    .limit(8)

  // ── Nifty turning points (last 30 days, moves ≥ 1.5%) ───────────────────
  const cutoff30d = new Date(Date.now() - 35 * 86400000).toISOString().slice(0, 10)
  const { data: indexHistory } = await supabase
    .from('index_history')
    .select('date, nifty50_close')
    .gte('date', cutoff30d)
    .order('date', { ascending: true })

  const rawTurning: { date: string; pct: number; close: number }[] = []
  const idxRows = indexHistory ?? []
  for (let i = 1; i < idxRows.length; i++) {
    const prev = idxRows[i - 1]
    const curr = idxRows[i]
    if (!prev.nifty50_close || !curr.nifty50_close) continue
    const pct = ((curr.nifty50_close - prev.nifty50_close) / prev.nifty50_close) * 100
    if (Math.abs(pct) >= 1.5) rawTurning.push({ date: curr.date, pct, close: curr.nifty50_close })
  }
  // Most recent 5, newest first
  rawTurning.sort((a, b) => b.date.localeCompare(a.date))
  const topTurning = rawTurning.slice(0, 5)

  let turningPoints: TurningPoint[] = topTurning.map(tp => ({ ...tp, news: [] }))
  if (topTurning.length > 0) {
    const { data: tpNews } = await admin
      .from('macro_alerts')
      .select('channel, summary, created_at, affected_sectors')
      .gte('created_at', cutoff30d + 'T00:00:00')
      .order('created_at', { ascending: false })
      .limit(500)

    type NewsWithDiff = { summary: string; channel: string; affected_sectors: string[] | null; diff: number }
    const newsMap: Record<string, NewsWithDiff[]> = {}
    for (const tp of topTurning) newsMap[tp.date] = []
    for (const n of tpNews ?? []) {
      const alertDate = n.created_at.slice(0, 10)
      let bestDate = ''
      let bestDiff = Infinity
      for (const tp of topTurning) {
        const diff = Math.abs(new Date(alertDate).getTime() - new Date(tp.date).getTime())
        if (diff < bestDiff && diff <= 86400000 * 1.5) { bestDiff = diff; bestDate = tp.date }
      }
      if (bestDate) newsMap[bestDate].push({
        summary: n.summary, channel: n.channel, affected_sectors: n.affected_sectors,
        diff: bestDiff,
      })
    }
    turningPoints = topTurning.map(tp => ({
      ...tp,
      news: (newsMap[tp.date] ?? [])
        .sort((a, b) => a.diff - b.diff)
        .slice(0, 3)
        .map(({ summary, channel, affected_sectors }) => ({ summary, channel, affected_sectors })),
    }))
  }

  const mfAllRows = mfRows ?? []
  const mfRow  = mfAllRows[0] ?? null
  const mfYest = mfAllRows[1] ?? null

  // Month-over-month MF equity comparison
  const mfMonthStr = (d: string) => d.slice(0, 7)
  const mfLatestMonth = mfRow ? mfMonthStr(mfRow.date) : null
  const mfPrevMonthDate = mfLatestMonth ? new Date(mfLatestMonth + '-01') : null
  if (mfPrevMonthDate) mfPrevMonthDate.setMonth(mfPrevMonthDate.getMonth() - 1)
  const mfPrevMonth = mfPrevMonthDate ? mfPrevMonthDate.toISOString().slice(0, 7) : null
  const mfCurrMonthEq = mfAllRows.filter(r => mfMonthStr(r.date) === mfLatestMonth).reduce((s, r) => s + (r.eq_net ?? 0), 0)
  const mfPrevMonthEq = mfAllRows.filter(r => mfMonthStr(r.date) === mfPrevMonth).reduce((s, r) => s + (r.eq_net ?? 0), 0)
  const mfMonthLabel = (ym: string | null) => ym ? new Date(ym + '-15').toLocaleDateString('en-IN', { month: 'short' }) : ''

  // ── User sector exposure (watchlist + portfolio) ──────────────────────────
  const userIndustries = new Set<string>([
    ...allRows.map((w: any) => w.stock?.industry).filter(Boolean),
    ...portRowsAll.map((h: any) => h.stock?.industry).filter(Boolean),
  ])
  const userSectors = [...userIndustries]
    .map(ind => INDUSTRY_TO_FII_SECTOR[ind as string])
    .filter(Boolean) as string[]
  const uniqueUserSectors = [...new Set(userSectors)]

  // Skip rows with null fii_net/dii_net
  const fiiDiiRow  = (fiiDiiRows ?? []).find(r => r.fii_net != null && r.dii_net != null) ?? null
  const fiiDiiYest = (fiiDiiRows ?? []).filter(r => r.fii_net != null && r.dii_net != null)[1] ?? null

  // 5-day rolling net
  const fii5d = (fiiDiiRows ?? []).slice(0, 5).reduce((s, r) => s + (r.fii_net ?? 0), 0)
  const dii5d = (fiiDiiRows ?? []).slice(0, 5).reduce((s, r) => s + (r.dii_net ?? 0), 0)

  // Consecutive FII streak
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

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  })

  const watchlistCount = allRows.length
  const isAdmin = user.email === process.env.ADMIN_EMAIL

  // ── Watchlist mini rows ──────────────────────────────────────────────────
  const watchlistMiniRows: WatchRow[] = allRows.slice(0, 6).map((w: any) => ({
    ticker:      w.stock?.ticker ?? '',
    entryPrice:  w.entry_price ?? null,
    rsi:         latestScore[w.stock_id]?.rsi ?? null,
    above200dma: latestScore[w.stock_id]?.above_200_dma ?? null,
    currentPrice: w.stock?.current_price ?? null,
  })).filter((r: WatchRow) => r.ticker)

  // ── Portfolio mini rows ──────────────────────────────────────────────────
  const portTotalInvestedForAlloc = portRows.reduce((s: number, h: any) => s + h.quantity * h.avg_price, 0)
  const portfolioMiniRows: PortRow[] = portRows.slice(0, 6).map((h: any) => ({
    ticker:   h.stock.ticker,
    quantity: h.quantity,
    avgPrice: h.avg_price,
    alloc:    portTotalInvestedForAlloc > 0
      ? (h.quantity * h.avg_price / portTotalInvestedForAlloc) * 100
      : 0,
  }))

  // Macro items typed for NewsTabs
  const trumpItems: MacroItem[] = (trumpAlertRows ?? []).map((r: any) => ({
    channel: r.channel,
    summary: r.summary,
    created_at: r.created_at,
    important: r.important ?? null,
    affected_sectors: r.affected_sectors ?? null,
  }))
  const marketItems: MacroItem[] = (marketAlertRows ?? []).map((r: any) => ({
    channel: r.channel,
    summary: r.summary,
    created_at: r.created_at,
    important: r.important ?? null,
    affected_sectors: r.affected_sectors ?? null,
  }))

  const topEtfs: EtfMeta[] = (etfSpotlight ?? []).map((e: any) => ({
    ticker: e.ticker,
    name: e.name,
    category: e.category,
    aum_cr: e.aum_cr,
    expense_ratio: e.expense_ratio,
  }))

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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-5">
          <WatchlistReturnCard
            rows={allRows
              .filter((w: any) => w.invested_amount && w.entry_price)
              .map((w: any) => ({ ticker: w.stock.ticker, invested: w.invested_amount, entryPrice: w.entry_price }))}
            watchlistCount={watchlistCount}
          />
          <PortfolioReturnCard
            rows={portRowsAll.map((h: any) => ({
              ticker:     h.stock.ticker,
              quantity:   h.quantity,
              avgPrice:   h.avg_price,
              price5dAgo: price5dMap[h.stock_id] ?? null,
            }))}
          />
          <MarketBreadthCard
            above200={breadthAbove200}
            below200={breadthBelow200}
            totalScored={stocksWithScores.length}
            totalStocks={allStockIds.length}
            oversold={breadthOversold}
            overbought={breadthOverbought}
            signals={breadthSignals}
            volumeBreakouts={volumeAlerts.slice(0, 6).map((v: any) => ({
              ticker: v.ticker,
              ratio: v.ratio,
              isPortfolio: v.isPortfolio,
            }))}
          />
        </div>

        {/* ── Main grid ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

          {/* ── Left: xl:col-span-2 ───────────────────────────────────── */}
          <div className="xl:col-span-2 space-y-4">

            {/* Watchlist mini — collapsible */}
            <div className="artha-card overflow-hidden">
              <CollapsibleSection
                label="My Watchlist"
                badge={`${watchlistCount} stocks`}
                defaultOpen
                linkHref="/watchlist"
                linkLabel="Watchlist"
              >
                <WatchlistMiniSection rows={watchlistMiniRows} />
              </CollapsibleSection>
            </div>

            {/* Portfolio mini — collapsible */}
            <div className="artha-card overflow-hidden">
              <CollapsibleSection
                label="Portfolio"
                badge={`${portfolioMiniRows.length} holdings`}
                defaultOpen
                linkHref="/portfolio"
                linkLabel="Portfolio"
              >
                <PortfolioMiniSection rows={portfolioMiniRows} />
              </CollapsibleSection>
            </div>

            {/* News + Macro — tabs */}
            <div className="artha-card overflow-hidden" style={{ padding: 0 }}>
              <NewsTabs
                newsItems={newsItems}
                trumpItems={trumpItems}
                marketItems={marketItems}
                userSectors={uniqueUserSectors}
              />
            </div>

            {/* Nifty Turning Points */}
            <PortfolioMovers
              turningPoints={turningPoints}
              userSectors={uniqueUserSectors}
              latestIndexDate={idxRows.length > 0 ? idxRows[idxRows.length - 1].date : null}
              allCloses={idxRows.map((r: any) => ({ date: r.date, close: r.nifty50_close }))}
            />
          </div>

          {/* ── Right: xl:col-span-1 ──────────────────────────────────── */}
          <div className="space-y-4">

            {/* Market Pulse — FII/DII/MF collapsible panel */}
            {fiiDiiRow && (
              <MarketPulsePanel
                fiiNet={fiiDiiRow.fii_net}
                diiNet={fiiDiiRow.dii_net}
                fii5d={fii5d}
                dii5d={dii5d}
                fiiStreak={fiiStreak}
                fiiStreakDir={fiiStreakDir}
                mfEqNet={mfRow?.eq_net ?? null}
                mfDate={mfRow?.date ?? null}
                mfCurrMonthEq={mfCurrMonthEq}
                mfPrevMonthEq={mfPrevMonthEq}
                mfLatestMonthLabel={mfMonthLabel(mfLatestMonth)}
                mfPrevMonthLabel={mfMonthLabel(mfPrevMonth)}
              />
            )}

            {/* Indian Markets widget */}
            <div className="artha-card px-4 py-4">
              <div className="artha-label mb-3">Indian Markets</div>
              <GlobalMiniWidget />
            </div>

            {/* ETF Spotlight */}
            <div className="artha-card px-4 py-4">
              <div className="flex items-center justify-between mb-3">
                <div className="artha-label">ETF Spotlight</div>
                <Link
                  href="/etf"
                  className="text-xs transition-colors hover:opacity-70"
                  style={{ color: 'var(--artha-text-faint)' }}
                >
                  All ETFs →
                </Link>
              </div>
              <EtfSpotlight etfs={topEtfs} />
            </div>

            {/* Sectors vs FII — collapsible, closed by default */}
            {sectorExposure.length > 0 && (
              <div className="artha-card overflow-hidden">
                <CollapsibleSection
                  label="Your Sectors vs FII"
                  defaultOpen={false}
                >
                  <div className="px-4 pb-4 pt-3 space-y-2">
                    <p className="text-[11px] mb-3" style={{ color: 'var(--artha-text-muted)' }}>
                      Portfolio allocation · FII fortnight flow
                    </p>
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
                        <div key={industry} className="rounded-xl px-3 py-2.5" style={{ background: rowBg }}>
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="text-xs font-semibold flex-1 truncate" style={{ color: 'var(--artha-text)' }}>{short}</span>
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
                            <span className="font-mono font-bold text-xs w-8 text-right shrink-0" style={{ color: 'var(--artha-text)' }}>{pct}%</span>
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
                          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(11,28,48,0.08)' }}>
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: barColor }} />
                          </div>
                          {fiiFlow != null && (
                            <div className="text-[10px] mt-1 text-right" style={{ color: fiiColor }}>
                              {fiiFlow >= 0 ? '+' : ''}{fmtCr(fiiFlow)} fortnight
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </CollapsibleSection>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  )
}
