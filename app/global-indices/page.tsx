import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AppShell from '@/components/AppShell'
import GlobalMarketsClient from './GlobalMarketsClient'

export default async function GlobalIndicesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const isAdmin = user.email === process.env.ADMIN_EMAIL

  return (
    <AppShell userEmail={user.email!} isAdmin={isAdmin}>
      <div className="px-6 py-5 max-w-screen-xl mx-auto">
        <div className="mb-6">
          <h1 className="font-display font-bold text-2xl" style={{ color: 'var(--artha-text)', letterSpacing: '-0.03em' }}>
            Global Markets
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--artha-text-muted)' }}>
            Live indices, currency &amp; commodities · refreshes every 60s
          </p>
        </div>
        <GlobalMarketsClient />
      </div>
    </AppShell>
  )
}
