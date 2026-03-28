import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AppShell from '@/components/AppShell'
import SettingsForm from './SettingsForm'

const DEFAULT_PREFS = {
  rsi_oversold_threshold:   30,
  rsi_overbought_threshold: 70,
  dma_cross_alert:          true,
  pct_from_high_threshold:  -20,
  new_filing_alert:         true,
  digest_time:              '19:00',
  whatsapp_number:          null,
  alert_channel:            'whatsapp',
  pl_alert_daily:           false,
  pl_alert_weekly:          false,
  pl_alert_monthly:         false,
  trump_alerts:             false,
}

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data }, { data: userSettings }] = await Promise.all([
    supabase.from('user_alert_preferences').select('*').eq('user_id', user.id).single(),
    supabase.from('user_settings').select('anthropic_api_key').eq('user_id', user.id).single(),
  ])

  const prefs = data ?? DEFAULT_PREFS

  // Normalize digest_time — Postgres returns 'HH:MM:SS', input needs 'HH:MM'
  if (prefs.digest_time?.length === 8) {
    prefs.digest_time = prefs.digest_time.slice(0, 5)
  }

  const apiKeySet = !!(userSettings?.anthropic_api_key)
  const isAdmin = user.email === process.env.ADMIN_EMAIL

  return (
    <AppShell userEmail={user.email!} isAdmin={isAdmin}>
      <div className="px-6 py-5 max-w-screen-xl mx-auto">
        <div className="mb-5">
          <h1 className="font-display font-bold text-2xl" style={{ color: 'var(--artha-text)', letterSpacing: '-0.03em' }}>
            Settings
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--artha-text-muted)' }}>Alert preferences &amp; account</p>
        </div>
        <div className="max-w-xl">
          <SettingsForm prefs={prefs} apiKeySet={apiKeySet} />
        </div>
      </div>
    </AppShell>
  )
}
