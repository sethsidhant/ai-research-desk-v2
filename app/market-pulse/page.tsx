import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AppShell from '@/components/AppShell'
import MarketPulseTabs from './MarketPulseTabs'

export default async function MarketPulsePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: watchlistRaw } = await supabase
    .from('user_stocks')
    .select('stocks(ticker, stock_name, industry)')
    .eq('user_id', user.id)

  const userStocks = (watchlistRaw ?? []).map((w: any) => {
    const s = Array.isArray(w.stocks) ? w.stocks[0] : w.stocks
    return { ticker: s?.ticker ?? '', stock_name: s?.stock_name ?? '', industry: s?.industry ?? null }
  }).filter(s => s.ticker)

  const [fiiFlowRes, fiiDiiRes, sectorsRes, mfRes, forexRes] = await Promise.all([
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
    supabase
      .from('forex_reserves')
      .select('date, total_usd_mn, fca_usd_mn, gold_usd_mn, sdrs_usd_mn, imf_usd_mn, wow_change_usd_mn, yoy_change_usd_mn')
      .order('date', { ascending: true }),
  ])

  const fiiFlow   = fiiFlowRes.data  ?? []
  const fiiDii    = fiiDiiRes.data   ?? []
  const sectors   = sectorsRes.data  ?? []
  const mfData    = mfRes.data       ?? []
  const forexData = forexRes.data    ?? []

  const lastUpdated = fiiDii[fiiDii.length - 1]?.date ?? null

  const isAdmin = user.email === process.env.ADMIN_EMAIL

  return (
    <AppShell userEmail={user.email!} isAdmin={isAdmin}>
      <div className="px-6 py-5 max-w-screen-xl mx-auto">

        <div className="mb-5">
          <h1 className="font-display font-bold text-2xl" style={{ color: 'var(--artha-text)', letterSpacing: '-0.03em' }}>
            Market Pulse
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--artha-text-muted)' }}>
            FII · DII · MF flows · Forex Reserves{lastUpdated ? ` · Flows updated ${new Date(lastUpdated).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}
          </p>
        </div>

        <MarketPulseTabs
          fiiFlow={fiiFlow}
          fiiDii={fiiDii}
          sectors={sectors}
          mfData={mfData}
          forexData={forexData}
          userStocks={userStocks}
          lastUpdated={lastUpdated}
        />
      </div>
    </AppShell>
  )
}
