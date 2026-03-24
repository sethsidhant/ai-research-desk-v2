import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import SignOutButton from '@/components/SignOutButton'
import FiiFlowChart from './FiiFlowChart'
import DailyFlowChart from './DailyFlowChart'
import SectorGrid from './SectorGrid'

export default async function MarketPulsePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetch user's watchlist industries for sector correlation
  const { data: watchlistRaw } = await supabase
    .from('user_stocks')
    .select('stocks(ticker, stock_name, industry)')
    .eq('user_id', user.id)

  const userStocks = (watchlistRaw ?? []).map((w: any) => {
    const s = Array.isArray(w.stocks) ? w.stocks[0] : w.stocks
    return { ticker: s?.ticker ?? '', stock_name: s?.stock_name ?? '', industry: s?.industry ?? null }
  }).filter(s => s.ticker)

  const [fiiFlowRes, fiiDiiRes, sectorsRes] = await Promise.all([
    supabase
      .from('fii_flow')
      .select('date, cumulative_net')
      .order('date', { ascending: true }),
    supabase
      .from('fii_dii_daily')
      .select('date, fii_net, dii_net')
      .order('date', { ascending: true }),
    supabase
      .from('fii_sector')
      .select('sector, aum, aum_pct, fortnight_flow, oneyear_flow, sparkline_values, sparkline_labels')
      .order('fortnight_flow', { ascending: true }),
  ])

  const fiiFlow   = fiiFlowRes.data  ?? []
  const fiiDii    = fiiDiiRes.data   ?? []
  const sectors   = sectorsRes.data  ?? []

  const lastUpdated = fiiDii[fiiDii.length - 1]?.date ?? null

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 px-6 py-4 flex items-center justify-between bg-white">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-gray-500 hover:text-gray-900 text-sm transition-colors">
            ← Dashboard
          </Link>
          <h1 className="text-xl font-bold text-gray-900">Market Pulse</h1>
          {lastUpdated && (
            <span className="text-xs text-gray-400">Updated {new Date(lastUpdated).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">{user.email}</span>
          <SignOutButton />
        </div>
      </header>

      <main className="px-4 sm:px-6 py-6 max-w-7xl mx-auto space-y-6">

        {fiiFlow.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400 text-sm">
            No FII flow data yet — run <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">node seedFiiHistory.js</code> to backfill 5 years, then trigger the FII Data Refresh workflow.
          </div>
        ) : (
          <FiiFlowChart data={fiiFlow} />
        )}

        {fiiDii.length > 0 && <DailyFlowChart data={fiiDii} />}

        {sectors.length > 0 ? (
          <SectorGrid sectors={sectors} userStocks={userStocks} />
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400 text-sm">
            No sector data yet — will populate after first FII Data Refresh run.
          </div>
        )}

      </main>
    </div>
  )
}
