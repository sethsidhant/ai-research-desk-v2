import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import AppShell from '@/components/AppShell'
import EtfDashboard from './EtfDashboard'

export default async function EtfPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()
  const { data: etfs } = await admin
    .from('etfs')
    .select('ticker,name,fund_house,category,underlying_index,expense_ratio,aum_cr,inav_ticker')
    .order('aum_cr', { ascending: false })

  const isAdmin = user.email === process.env.ADMIN_EMAIL

  return (
    <AppShell userEmail={user.email!} isAdmin={isAdmin}>
      <div className="px-6 py-5 max-w-screen-xl mx-auto">
        <div className="mb-5">
          <h1 className="font-display font-bold text-2xl" style={{ color: 'var(--artha-text)', letterSpacing: '-0.03em' }}>
            ETF Tracker
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--artha-text-muted)' }}>
            {etfs?.length ?? 0} Indian ETFs · Live prices + NAV premium/discount via Kite · Refreshes every 15s
          </p>
        </div>
        <EtfDashboard etfs={etfs ?? []} />
      </div>
    </AppShell>
  )
}
