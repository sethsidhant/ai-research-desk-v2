'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function saveAlertPreferences(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const prefs = {
    user_id:                  user.id,
    rsi_oversold_threshold:   Number(formData.get('rsi_oversold_threshold'))  || 30,
    rsi_overbought_threshold: Number(formData.get('rsi_overbought_threshold')) || 70,
    dma_cross_alert:          formData.get('dma_cross_alert') === 'on',
    pct_from_high_threshold:  Number(formData.get('pct_from_high_threshold')) || -20,
    new_filing_alert:         formData.get('new_filing_alert') === 'on',
    digest_time:              formData.get('digest_time') as string || '19:00',
    pl_alert_daily:           formData.get('pl_alert_daily')   === 'on',
    pl_alert_weekly:          formData.get('pl_alert_weekly')  === 'on',
    pl_alert_monthly:         formData.get('pl_alert_monthly') === 'on',
    trump_alerts:             formData.get('trump_alerts')     === 'on',
  }

  const { error } = await supabase
    .from('user_alert_preferences')
    .upsert(prefs, { onConflict: 'user_id' })

  if (error) return { error: error.message }
  revalidatePath('/settings')
  return { success: true }
}
