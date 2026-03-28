import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AppShell from '@/components/AppShell'
import FiiFlowChart from './FiiFlowChart'
import DailyFlowChart from './DailyFlowChart'
import MFFlowChart from './MFFlowChart'
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

  const [fiiFlowRes, fiiDiiRes, sectorsRes, mfRes] = await Promise.all([
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
    supabase
      .from('mf_sebi_daily')
      .select('date, eq_net, dbt_net')
      .order('date', { ascending: true }),
  ])

  const fiiFlow   = fiiFlowRes.data  ?? []
  const fiiDii    = fiiDiiRes.data   ?? []
  const sectors   = sectorsRes.data  ?? []
  const mfData    = mfRes.data       ?? []

  const lastUpdated = fiiDii[fiiDii.length - 1]?.date ?? null

  const isAdmin = user.email === process.env.ADMIN_EMAIL

  return (
    <AppShell userEmail={user.email!} isAdmin={isAdmin}>
      <div className="px-6 py-5 max-w-screen-xl mx-auto">

        {/* Page header */}
        <div className="mb-5">
          <h1 className="font-display font-bold text-2xl" style={{ color: 'var(--artha-text)', letterSpacing: '-0.03em' }}>
            Market Pulse
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--artha-text-muted)' }}>
            FII · DII · MF flows{lastUpdated ? ` · Updated ${new Date(lastUpdated).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}
          </p>
        </div>

        <div className="space-y-5">
          {fiiFlow.length === 0 ? (
            <div className="artha-card p-8 text-center text-sm" style={{ color: 'var(--artha-text-muted)' }}>
              No FII flow data yet — run <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">node seedFiiHistory.js</code> to backfill.
            </div>
          ) : (
            <FiiFlowChart data={fiiFlow} dailyNet={fiiDii} />
          )}

          {fiiDii.length > 0 && <DailyFlowChart data={fiiDii} />}
          {mfData.length > 0 && <MFFlowChart data={mfData} />}

          {sectors.length > 0 ? (
            <SectorGrid sectors={sectors} userStocks={userStocks} />
          ) : (
            <div className="artha-card p-8 text-center text-sm" style={{ color: 'var(--artha-text-muted)' }}>
              No sector data yet — will populate after first FII Data Refresh run.
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
