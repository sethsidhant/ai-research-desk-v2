'use client'

import { useState } from 'react'
import { saveAlertPreferences } from './actions'
import { createClient } from '@/lib/supabase/client'

type Prefs = {
  rsi_oversold_threshold:   number
  rsi_overbought_threshold: number
  dma_cross_alert:          boolean
  pct_from_high_threshold:  number
  new_filing_alert:         boolean
  digest_time:              string
  whatsapp_number:          string | null
  alert_channel:            string | null
  pl_alert_daily:           boolean
  pl_alert_weekly:          boolean
  pl_alert_monthly:         boolean
}

export default function SettingsForm({ prefs }: { prefs: Prefs }) {
  const [status, setStatus]   = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [channel, setChannel] = useState(prefs.alert_channel ?? 'whatsapp')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus('saving')
    const formData = new FormData(e.currentTarget)
    const result = await saveAlertPreferences(formData)
    if (result.error) {
      setErrorMsg(result.error)
      setStatus('error')
    } else {
      setStatus('saved')
      setTimeout(() => setStatus('idle'), 3000)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">

      {/* Notifications */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Notifications</h2>
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-5">

          {/* Channel selector */}
          <div>
            <label className="block text-sm text-gray-600 mb-3">Alert channel</label>
            <input type="hidden" name="alert_channel" value={channel} />
            <div className="flex gap-3">
              {(['email', 'whatsapp', 'both'] as const).map(opt => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setChannel(opt)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors capitalize ${
                    channel === opt
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
                  }`}
                >
                  {opt === 'both' ? 'Both' : opt.charAt(0).toUpperCase() + opt.slice(1)}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-2">
              {channel === 'email' && 'Alerts sent to your login email address.'}
              {channel === 'whatsapp' && 'Alerts sent via WhatsApp. Enter your number below.'}
              {channel === 'both' && 'Alerts sent to both email and WhatsApp.'}
            </p>
          </div>

          {/* WhatsApp number — shown only when whatsapp or both */}
          {(channel === 'whatsapp' || channel === 'both') && (
            <div>
              <label className="block text-sm text-gray-600 mb-1">WhatsApp number</label>
              <input
                type="text"
                name="whatsapp_number"
                defaultValue={prefs.whatsapp_number ?? ''}
                placeholder="+919876543210"
                className="w-full px-4 py-2.5 rounded-lg bg-white text-gray-900 border border-gray-300 focus:outline-none focus:border-blue-500 text-sm"
              />
              <p className="text-xs text-gray-400 mt-1">Include country code. E.g. +919876543210</p>
            </div>
          )}

          {/* Digest time */}
          <div>
            <label className="block text-sm text-gray-600 mb-1">Daily digest time</label>
            <input
              type="time"
              name="digest_time"
              defaultValue={prefs.digest_time ?? '19:00'}
              className="px-4 py-2.5 rounded-lg bg-white text-gray-900 border border-gray-300 focus:outline-none focus:border-blue-500 text-sm"
            />
          </div>
        </div>
      </section>

      {/* RSI Thresholds */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">RSI Thresholds</h2>
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Oversold below</label>
            <input
              type="number"
              name="rsi_oversold_threshold"
              defaultValue={prefs.rsi_oversold_threshold}
              min={1} max={50}
              className="w-full px-4 py-2.5 rounded-lg bg-white text-gray-900 border border-gray-300 focus:outline-none focus:border-blue-500 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Overbought above</label>
            <input
              type="number"
              name="rsi_overbought_threshold"
              defaultValue={prefs.rsi_overbought_threshold}
              min={50} max={99}
              className="w-full px-4 py-2.5 rounded-lg bg-white text-gray-900 border border-gray-300 focus:outline-none focus:border-blue-500 text-sm"
            />
          </div>
        </div>
      </section>

      {/* Price Alert */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Price Alert</h2>
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <label className="block text-sm text-gray-600 mb-1">Alert when stock is this % below 52W high</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              name="pct_from_high_threshold"
              defaultValue={prefs.pct_from_high_threshold}
              min={-80} max={0}
              className="w-32 px-4 py-2.5 rounded-lg bg-white text-gray-900 border border-gray-300 focus:outline-none focus:border-blue-500 text-sm"
            />
            <span className="text-gray-400 text-sm">% (e.g. -20 means 20% below high)</span>
          </div>
        </div>
      </section>

      {/* Toggle Alerts */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Alert Toggles</h2>
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-4">
          <Toggle
            name="dma_cross_alert"
            label="DMA crossover alert"
            description="Alert when stock crosses above/below 50D or 200D moving average"
            defaultChecked={prefs.dma_cross_alert}
          />
          <Toggle
            name="new_filing_alert"
            label="New BSE filing alert"
            description="Alert when a new corporate announcement is filed on BSE"
            defaultChecked={prefs.new_filing_alert}
          />
        </div>
      </section>

      {/* P&L Alerts */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Interested Amount P&amp;L Alerts</h2>
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-4">
          <p className="text-xs text-gray-400">Receive a WhatsApp summary of how your interested stocks are performing vs your entry price.</p>
          <Toggle
            name="pl_alert_daily"
            label="Daily P&L digest"
            description="Sent every morning with today's P&L for all your interested stocks"
            defaultChecked={prefs.pl_alert_daily}
          />
          <Toggle
            name="pl_alert_weekly"
            label="Weekly P&L digest"
            description="Sent every Monday with week's performance"
            defaultChecked={prefs.pl_alert_weekly}
          />
          <Toggle
            name="pl_alert_monthly"
            label="Monthly P&L digest"
            description="Sent on the 1st of each month with month's performance"
            defaultChecked={prefs.pl_alert_monthly}
          />
        </div>
      </section>

      {/* Change Password */}
      <ChangePassword />

      {/* Save button */}
      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={status === 'saving'}
          className="px-6 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-50 transition-colors"
        >
          {status === 'saving' ? 'Saving...' : 'Save preferences'}
        </button>
        {status === 'saved' && (
          <span className="text-emerald-400 text-sm">✓ Saved</span>
        )}
        {status === 'error' && (
          <span className="text-red-400 text-sm">Error: {errorMsg}</span>
        )}
      </div>
    </form>
  )
}

function ChangePassword() {
  const [open, setOpen]         = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [status, setStatus]     = useState<'idle' | 'saving' | 'done' | 'error'>('idle')
  const [error, setError]       = useState('')
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8)  { setError('Must be at least 8 characters'); return }
    setStatus('saving')
    setError('')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) { setError(error.message); setStatus('error') }
    else { setStatus('done'); setPassword(''); setConfirm('') }
  }

  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Security</h2>
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        {!open ? (
          <button type="button" onClick={() => setOpen(true)}
            className="text-sm text-blue-600 hover:text-blue-500 font-medium">
            Change password
          </button>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3 max-w-sm">
            <input type="password" required placeholder="New password" value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg bg-white text-gray-900 border border-gray-300 focus:outline-none focus:border-blue-500 text-sm" />
            <input type="password" required placeholder="Confirm password" value={confirm}
              onChange={e => setConfirm(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg bg-white text-gray-900 border border-gray-300 focus:outline-none focus:border-blue-500 text-sm" />
            {error && <p className="text-red-500 text-xs">{error}</p>}
            {status === 'done' && <p className="text-emerald-600 text-xs">✓ Password updated</p>}
            <div className="flex gap-3">
              <button type="submit" disabled={status === 'saving'}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-50 transition-colors">
                {status === 'saving' ? 'Saving...' : 'Update password'}
              </button>
              <button type="button" onClick={() => { setOpen(false); setError(''); setStatus('idle') }}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-600 text-sm hover:border-gray-400 transition-colors">
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  )
}

function Toggle({
  name,
  label,
  description,
  defaultChecked,
}: {
  name: string
  label: string
  description: string
  defaultChecked: boolean
}) {
  const [checked, setChecked] = useState(defaultChecked)

  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-sm text-white">{label}</div>
        <div className="text-xs text-gray-500 mt-0.5">{description}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => setChecked(!checked)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none ${
          checked ? 'bg-blue-600' : 'bg-gray-700'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
        <input type="hidden" name={name} value={checked ? 'on' : 'off'} />
      </button>
    </div>
  )
}
