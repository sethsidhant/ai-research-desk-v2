import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import SignOutButton from '@/components/SignOutButton'
import MarketIndicesBar from '@/components/MarketIndicesBar'
import { INDUSTRY_TO_FII_SECTOR } from '@/lib/fiiSectorMap'

// ─── helpers ────────────────────────────────────────────────────────────────

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
    .select('stock_id, invested_amount, entry_price, stocks(ticker, industry, current_price, last_news_update)')
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
    .select('quantity, avg_price, stocks(ticker, current_price, industry)')
    .eq('user_id', user.id)

  const portRows = (portfolioHoldings ?? []).map((h: any) => {
    const stock = Array.isArray(h.stocks) ? h.stocks[0] : h.stocks
    return { ...h, stock }
  }).filter((h: any) => h.stock?.current_price)

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

  // ── Signals: latest score per stock ─────────────────────────────────────
  const stockIds = allRows.map((w: any) => w.stock_id).filter(Boolean)
  const { data: scores } = stockIds.length > 0
    ? await supabase
        .from('daily_scores')
        .select('stock_id, rsi, above_200_dma')
        .in('stock_id', stockIds)
        .order('date', { ascending: false })
    : { data: [] }

  const latestScore: Record<string, any> = {}
  for (const s of (scores ?? [])) {
    if (!latestScore[s.stock_id]) latestScore[s.stock_id] = s
  }

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

  // ── Sector exposure ──────────────────────────────────────────────────────
  // Group by FII sector name (via shared map), not raw BSE sub-industry
  const sectorMap: Record<string, { count: number; invested: number }> = {}
  for (const w of allRows) {
    const ind = w.stock?.industry
    const fiiSectorName = ind ? (INDUSTRY_TO_FII_SECTOR[ind] ?? ind) : null
    if (!fiiSectorName) continue
    if (!sectorMap[fiiSectorName]) sectorMap[fiiSectorName] = { count: 0, invested: 0 }
    sectorMap[fiiSectorName].count++
    sectorMap[fiiSectorName].invested += w.invested_amount ?? 0
  }

  const totalSectorInvested = Object.values(sectorMap).reduce((s, v) => s + v.invested, 0)
  // fallback: if no invested amounts, weight by stock count
  const totalSectorWeight   = totalSectorInvested > 0 ? totalSectorInvested : allRows.length

  // Sort by invested (fallback to count) descending — top 3
  const sectorExposure = Object.entries(sectorMap)
    .sort(([, a], [, b]) => (b.invested !== a.invested ? b.invested - a.invested : b.count - a.count))
    .slice(0, 5)
    .map(([industry, { count, invested }]) => ({
      industry,
      count,
      invested,
      pct: totalSectorWeight > 0
        ? Math.round((totalSectorInvested > 0 ? invested : count) / totalSectorWeight * 100)
        : 0,
    }))

  // ── FII data ─────────────────────────────────────────────────────────────
  const [{ data: fiiSectors }, { data: fiiDiiRows }, { data: mfRows }] = await Promise.all([
    supabase.from('fii_sector').select('sector, fortnight_flow'),
    supabase.from('fii_dii_daily')
      .select('date, fii_net, dii_net')
      .order('date', { ascending: false })
      .limit(7),
    supabase.from('mf_sebi_daily')
      .select('date, eq_net, dbt_net')
      .order('date', { ascending: false })
      .limit(2),
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
            {user.email === process.env.ADMIN_EMAIL && (
              <Link href="/admin" className="text-xs sm:text-sm text-gray-500 hover:text-gray-900 transition-colors px-2 sm:px-3 py-1.5 rounded-lg hover:bg-gray-100">
                Admin
              </Link>
            )}
            <Link href="/market-pulse" className="text-xs sm:text-sm text-gray-500 hover:text-gray-900 transition-colors px-2 sm:px-3 py-1.5 rounded-lg hover:bg-gray-100">
              Market Pulse
            </Link>
            <Link href="/watchlist" className="text-xs sm:text-sm text-gray-500 hover:text-gray-900 transition-colors px-2 sm:px-3 py-1.5 rounded-lg hover:bg-gray-100">
              Watchlist
            </Link>
            <Link href="/portfolio" className="text-xs sm:text-sm text-gray-500 hover:text-gray-900 transition-colors px-2 sm:px-3 py-1.5 rounded-lg hover:bg-gray-100">
              Portfolio
            </Link>
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

      {/* Main */}
      <main className="px-3 sm:px-6 py-5 sm:py-8 max-w-screen-xl mx-auto">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

          {/* ── Watchlist · Virtual P&L card ──────────────────────────── */}
          <div className="sm:col-span-1">
            <Link href="/watchlist" className="block bg-white border border-gray-200 rounded-xl px-4 py-4 shadow-sm hover:border-gray-300 hover:shadow-md transition-all group h-full">
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-3">Watchlist · Virtual P&amp;L</div>

              {watchlistCount === 0 ? (
                <div className="text-sm text-gray-400">No stocks yet. Add some to your watchlist →</div>
              ) : (
                <div className="space-y-3">

                  {/* P&L */}
                  {totalInvested > 0 ? (
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-gray-500">Invested</span>
                        <span className="text-sm font-mono font-semibold text-gray-800">
                          ₹{totalInvested.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-gray-500">Current</span>
                        <span className="text-sm font-mono font-semibold text-gray-800">
                          ₹{totalCurrent.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </span>
                      </div>
                      <div className="flex justify-between items-center pt-1 border-t border-gray-100">
                        <span className="text-xs text-gray-500">Total Return</span>
                        <div className="text-right">
                          <span className={`text-base font-bold font-mono ${totalPnl >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                            {totalPnl >= 0 ? '+' : ''}{totalPnlPct.toFixed(1)}%
                          </span>
                          <div className={`text-[11px] font-mono ${totalPnl >= 0 ? 'text-emerald-500' : 'text-red-400'}`}>
                            {totalPnl >= 0 ? '+' : ''}₹{Math.abs(totalPnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400">Set entry prices to track P&amp;L.</p>
                  )}

                  {/* Sector exposure vs FII */}
                  {sectorExposure.length > 0 && (
                    <div className="pt-2 border-t border-gray-100">
                      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5">
                        Sector Exposure vs FII
                      </div>
                      <div className="space-y-1.5">
                        {sectorExposure.map(({ industry, count, pct }) => {
                          const fiiFlow  = fiiFlowMap[industry] ?? null
                          const short    = SHORT_SECTOR[industry] ?? industry
                          const buying   = fiiFlow != null && fiiFlow > 1000
                          const selling  = fiiFlow != null && fiiFlow < -1000
                          const mismatch = selling && pct >= 20
                          const barColor = buying ? 'bg-emerald-400' : selling ? 'bg-red-400' : 'bg-gray-300'
                          return (
                            <div key={industry} className="space-y-0.5">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${barColor}`} />
                                  <span className="text-[11px] text-gray-700 truncate">{short}</span>
                                  <span className="text-[10px] text-gray-400">{count} stock{count !== 1 ? 's' : ''}</span>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <span className={`text-[11px] font-bold font-mono ${pct >= 40 ? 'text-orange-500' : 'text-gray-600'}`}>
                                    {pct}%
                                  </span>
                                  {fiiFlow != null ? (
                                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                                      buying  ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' :
                                      selling ? 'bg-red-50 text-red-500 border border-red-100' :
                                                'bg-gray-50 text-gray-400 border border-gray-100'
                                    }`}>
                                      {buying ? '▲ FII in' : selling ? '▼ FII out' : '— neutral'}
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-gray-300">—</span>
                                  )}
                                  {mismatch && <span title="Heavy exposure + FII selling">⚠️</span>}
                                </div>
                              </div>
                              {/* exposure bar */}
                              <div className="h-0.5 w-full bg-gray-100 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full transition-all ${barColor} opacity-60`} style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Signals */}
                  {hasSignals && (
                    <div className="pt-2 border-t border-gray-100 space-y-1.5">
                      {filingTickers.length > 0 && (
                        <SignalRow
                          label={`📋 ${filingTickers.length} filing${filingTickers.length > 1 ? 's' : ''} today`}
                          tickers={filingTickers}
                          color="amber"
                        />
                      )}
                      {oversoldTickers.length > 0 && (
                        <SignalRow
                          label={`📉 ${oversoldTickers.length} oversold`}
                          tickers={oversoldTickers}
                          color="blue"
                        />
                      )}
                      {overboughtTickers.length > 0 && (
                        <SignalRow
                          label={`📈 ${overboughtTickers.length} overbought`}
                          tickers={overboughtTickers}
                          color="orange"
                        />
                      )}
                      {below200Tickers.length > 0 && (
                        <SignalRow
                          label={`📊 ${below200Tickers.length} below 200 DMA`}
                          tickers={below200Tickers}
                          color="red"
                        />
                      )}
                    </div>
                  )}

                  <div className="pt-1 text-xs text-gray-400 group-hover:text-gray-600 transition-colors">
                    {watchlistCount} stock{watchlistCount !== 1 ? 's' : ''} · View watchlist →
                  </div>

                </div>
              )}
            </Link>
          </div>

          {/* ── Real Portfolio card ───────────────────────────────────── */}
          <div className="sm:col-span-1">
            <div className="bg-white border border-gray-200 rounded-xl px-4 py-4 shadow-sm hover:border-gray-300 hover:shadow-md transition-all group h-full">
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-3">
                Real Portfolio{' '}
                <Link href="/portfolio" className="text-blue-400 hover:text-blue-600 transition-colors">→</Link>
              </div>

              {portRows.length === 0 ? (
                <div className="text-sm text-gray-400">
                  No holdings yet.{' '}
                  <Link href="/portfolio" className="text-blue-500 hover:underline">Sync from Zerodha or upload CSV →</Link>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* P&L summary */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-500">Invested</span>
                      <span className="text-sm font-mono font-semibold text-gray-800">
                        ₹{portInvested.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-500">Current</span>
                      <span className="text-sm font-mono font-semibold text-gray-800">
                        ₹{portCurrent.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                    <div className="flex justify-between items-center pt-1 border-t border-gray-100">
                      <span className="text-xs text-gray-500">Total Return</span>
                      <div className="text-right">
                        <span className={`text-base font-bold font-mono ${portPnl >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {portPnl >= 0 ? '+' : ''}{portPnlPct.toFixed(1)}%
                        </span>
                        <div className={`text-[11px] font-mono ${portPnl >= 0 ? 'text-emerald-500' : 'text-red-400'}`}>
                          {portPnl >= 0 ? '+' : ''}₹{Math.abs(portPnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Top holdings */}
                  {topHoldings.length > 0 && (
                    <div className="pt-2 border-t border-gray-100">
                      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5">Top Holdings</div>
                      <div className="space-y-1.5">
                        {topHoldings.map((h: any) => (
                          <div key={h.ticker} className="space-y-0.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] font-mono font-semibold text-gray-700">{h.ticker}</span>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className={`text-[11px] font-mono font-bold ${h.pct >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                  {h.pct >= 0 ? '+' : ''}{h.pct.toFixed(1)}%
                                </span>
                                <span className="text-[10px] text-gray-400 font-mono">{h.alloc.toFixed(1)}%</span>
                              </div>
                            </div>
                            <div className="h-0.5 w-full bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full bg-blue-400 rounded-full" style={{ width: `${Math.min(h.alloc, 100)}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="pt-1 text-xs text-gray-400 group-hover:text-gray-600 transition-colors">
                    <Link href="/portfolio" className="hover:text-gray-800 transition-colors">
                      {portRows.length} holdings · View portfolio →
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── FII/DII + MF card ─────────────────────────────────────── */}
          <div className="sm:col-span-1">
            <div className="bg-white border border-gray-200 rounded-xl px-4 py-4 shadow-sm h-full">

              {/* FII / DII boxes */}
              {fiiDiiRow && (
                <div className="mb-4">
                  <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2">
                    FII / DII · {new Date(fiiDiiRow.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {/* FII */}
                    <div className={`rounded-lg px-3 py-2.5 ${fiiDiiRow.fii_net >= 0 ? 'bg-emerald-50 border border-emerald-100' : 'bg-red-50 border border-red-100'}`}>
                      <div className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 mb-0.5">FII Net</div>
                      <div className={`text-sm font-bold font-mono ${fiiDiiRow.fii_net >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {fiiDiiRow.fii_net >= 0 ? '▲' : '▼'} {fmtCr(Math.abs(fiiDiiRow.fii_net))}
                      </div>
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        {fiiDiiYest && (
                          <span className={`text-[10px] font-mono ${(fiiDiiRow.fii_net - fiiDiiYest.fii_net) >= 0 ? 'text-emerald-500' : 'text-red-400'}`}>
                            {(fiiDiiRow.fii_net - fiiDiiYest.fii_net) >= 0 ? '▲' : '▼'} {fmtCr(Math.abs(fiiDiiRow.fii_net - fiiDiiYest.fii_net))} vs yest
                          </span>
                        )}
                        <span className="text-[10px] text-gray-400 font-mono">
                          5d: <span className={fii5d >= 0 ? 'text-emerald-500' : 'text-red-400'}>{fii5d >= 0 ? '+' : ''}{fmtCr(fii5d)}</span>
                        </span>
                      </div>
                    </div>
                    {/* DII */}
                    <div className={`rounded-lg px-3 py-2.5 ${fiiDiiRow.dii_net >= 0 ? 'bg-emerald-50 border border-emerald-100' : 'bg-red-50 border border-red-100'}`}>
                      <div className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 mb-0.5">DII Net</div>
                      <div className={`text-sm font-bold font-mono ${fiiDiiRow.dii_net >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {fiiDiiRow.dii_net >= 0 ? '▲' : '▼'} {fmtCr(Math.abs(fiiDiiRow.dii_net))}
                      </div>
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        {fiiDiiYest && (
                          <span className={`text-[10px] font-mono ${(fiiDiiRow.dii_net - fiiDiiYest.dii_net) >= 0 ? 'text-emerald-500' : 'text-red-400'}`}>
                            {(fiiDiiRow.dii_net - fiiDiiYest.dii_net) >= 0 ? '▲' : '▼'} {fmtCr(Math.abs(fiiDiiRow.dii_net - fiiDiiYest.dii_net))} vs yest
                          </span>
                        )}
                        <span className="text-[10px] text-gray-400 font-mono">
                          5d: <span className={dii5d >= 0 ? 'text-emerald-500' : 'text-red-400'}>{dii5d >= 0 ? '+' : ''}{fmtCr(dii5d)}</span>
                        </span>
                      </div>
                    </div>
                  </div>
                  {fiiStreakDir && fiiStreak >= 2 && (
                    <div className={`mt-2 text-[10px] font-semibold px-2 py-1 rounded-lg inline-block ${fiiStreakDir === 'buying' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
                      FII {fiiStreakDir} for {fiiStreak} days straight
                    </div>
                  )}

                  {/* MF row */}
                  {mfRow && (
                    <div className="mt-3 pt-2 border-t border-gray-100">
                      <div className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
                        MF · SEBI · {new Date(mfRow.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className={`rounded-lg px-2.5 py-1.5 ${(mfRow.eq_net ?? 0) >= 0 ? 'bg-emerald-50 border border-emerald-100' : 'bg-red-50 border border-red-100'}`}>
                          <div className="text-[9px] text-gray-400 mb-0.5">Equity</div>
                          <div className={`text-xs font-bold font-mono ${(mfRow.eq_net ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                            {(mfRow.eq_net ?? 0) >= 0 ? '▲' : '▼'} {fmtCr(Math.abs(mfRow.eq_net ?? 0))}
                          </div>
                        </div>
                        <div className={`rounded-lg px-2.5 py-1.5 ${(mfRow.dbt_net ?? 0) >= 0 ? 'bg-emerald-50 border border-emerald-100' : 'bg-red-50 border border-red-100'}`}>
                          <div className="text-[9px] text-gray-400 mb-0.5">Debt</div>
                          <div className={`text-xs font-bold font-mono ${(mfRow.dbt_net ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                            {(mfRow.dbt_net ?? 0) >= 0 ? '▲' : '▼'} {fmtCr(Math.abs(mfRow.dbt_net ?? 0))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

            </div>
          </div>

          {/* ── FII Sector Flow — full width row ──────────────────────── */}
          {validSectors.length > 0 && (
            <div className="sm:col-span-3">
              <div className="bg-white border border-gray-200 rounded-xl px-4 py-4 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">FII Sectoral Flow · Fortnight</div>
                  <div className="text-[10px] text-gray-400">
                    <span className="text-emerald-600 font-semibold">{sectorBuyCount}</span> buying ·{' '}
                    <span className="text-red-500 font-semibold">{sectorSellCount}</span> selling
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  {/* Buying column */}
                  <div className="space-y-2">
                    {top3.map(s => (
                      <div key={s.name} className="flex items-center justify-between gap-2 bg-emerald-50 rounded-lg px-2.5 py-1.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                          <span className="text-xs text-gray-700 truncate font-medium">{SHORT_SECTOR[s.name] ?? s.name}</span>
                        </div>
                        <span className="text-xs font-mono font-bold text-emerald-600 shrink-0">{fmtCr(s.flow)}</span>
                      </div>
                    ))}
                  </div>
                  {/* Selling column */}
                  <div className="space-y-2">
                    {bot3.map(s => (
                      <div key={s.name} className="flex items-center justify-between gap-2 bg-red-50 rounded-lg px-2.5 py-1.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                          <span className="text-xs text-gray-700 truncate font-medium">{SHORT_SECTOR[s.name] ?? s.name}</span>
                        </div>
                        <span className="text-xs font-mono font-bold text-red-500 shrink-0">{fmtCr(s.flow)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  )
}

// ─── small helper component ──────────────────────────────────────────────────

function SignalRow({ label, tickers, color }: {
  label:   string
  tickers: string[]
  color:   'amber' | 'blue' | 'orange' | 'red'
}) {
  const styles = {
    amber:  'bg-amber-50 text-amber-600 border-amber-200',
    blue:   'bg-blue-50 text-blue-600 border-blue-200',
    orange: 'bg-orange-50 text-orange-600 border-orange-200',
    red:    'bg-red-50 text-red-500 border-red-200',
  }
  return (
    <div className="flex items-start gap-1.5 flex-wrap">
      <span className={`text-[10px] border px-1.5 py-0.5 rounded font-semibold shrink-0 ${styles[color]}`}>
        {label}
      </span>
      <div className="flex flex-wrap gap-1">
        {tickers.slice(0, 4).map(t => (
          <span key={t} className="text-[10px] font-mono font-semibold text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">
            {t}
          </span>
        ))}
        {tickers.length > 4 && <span className="text-[10px] text-gray-400 self-center">+{tickers.length - 4}</span>}
      </div>
    </div>
  )
}
