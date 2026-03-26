import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import SignOutButton from '@/components/SignOutButton'
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

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-gray-200 px-6 py-4 flex items-center justify-between bg-white">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-gray-500 hover:text-gray-900 text-sm transition-colors">
            ← Dashboard
          </Link>
          <h1 className="text-xl font-bold text-gray-900">Settings</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">{user.email}</span>
          <SignOutButton />
        </div>
      </header>

      <main className="px-6 py-8 max-w-xl mx-auto">
        <SettingsForm prefs={prefs} apiKeySet={apiKeySet} />
      </main>
    </div>
  )
}
