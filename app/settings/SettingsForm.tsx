'use client'

import { useState } from 'react'
import { saveAlertPreferences, saveApiKey } from './actions'
import { createClient } from '@/lib/supabase/client'

type Prefs = {
  rsi_oversold_threshold:   number
  rsi_overbought_threshold: number
  dma_cross_alert:          boolean
  pct_from_high_threshold:  number
  new_filing_alert:         boolean
  digest_time:              string
  pl_alert_daily:           boolean
  pl_alert_weekly:          boolean
  pl_alert_monthly:         boolean
  trump_alerts:             boolean
  telegram_chat_id:         string | null
}

function TelegramConnect({ linked }: { linked: boolean }) {
  const [code, setCode]         = useState<string | null>(null)
  const [botUser, setBotUser]   = useState('')
  const [expiresAt, setExpires] = useState<Date | null>(null)
  const [loading, setLoading]   = useState(false)
  const [copied, setCopied]     = useState(false)

  async function generate() {
    setLoading(true)
    try {
      const res  = await fetch('/api/telegram-link')
      const json = await res.json()
      setCode(json.code)
      setBotUser(json.botUsername)
      setExpires(new Date(json.expiresAt))
    } finally {
      setLoading(false)
    }
  }

  function copy() {
    if (!code) return
    navigator.clipboard.writeText(`/link ${code}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (linked) {
    return <div className="text-xs text-emerald-600 mt-0.5">✓ Connected — you'll receive alerts in Telegram</div>
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-500">Not connected — generate a code and send it to the bot to link your account.</div>
      {!code ? (
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-400 text-white text-sm font-medium disabled:opacity-50 transition-colors"
        >
          {loading ? 'Generating...' : 'Generate Code'}
        </button>
      ) : (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-2">
          <div className="text-xs text-gray-500">Send this command to the bot:</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-sm font-mono bg-white border border-gray-200 rounded px-3 py-1.5 text-gray-900">
              /link {code}
            </code>
            <button
              type="button"
              onClick={copy}
              className="px-3 py-1.5 rounded bg-gray-100 hover:bg-gray-200 text-xs text-gray-700 transition-colors"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          {botUser && (
            <a
              href={`https://t.me/${botUser}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-xs text-blue-600 hover:underline"
            >
              Open @{botUser} in Telegram →
            </a>
          )}
          {expiresAt && (
            <div className="text-xs text-gray-400">
              Expires at {expiresAt.toLocaleTimeString()} — refresh page after linking
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function SettingsForm({ prefs, apiKeySet }: { prefs: Prefs; apiKeySet: boolean }) {
  const [status, setStatus]   = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

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
    <div className="space-y-10">

      {/* AI Key */}
      <BYOKSection apiKeySet={apiKeySet} />

    <form onSubmit={handleSubmit} className="space-y-8">

      {/* Notifications */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Notifications</h2>
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-5">

          {/* Telegram connect */}
          <div className="rounded-lg border border-gray-200 p-4 bg-gray-50">
            <div className="text-sm font-medium text-gray-700 mb-2">Telegram</div>
            <TelegramConnect linked={!!prefs.telegram_chat_id} />
          </div>

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

      {/* Macro Market Alerts */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Macro Market Alerts</h2>
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-4">
          <p className="text-xs text-gray-400">
            Get real-time alerts for macro market-moving events — Trump posts on tariffs/trade/Fed, global macro news, and key policy developments.
            Delivered via a dedicated Telegram channel, separate from your personal alerts.
          </p>
          <a
            href="https://t.me/noesis.macro.news"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors"
            style={{ background: '#229ED9' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248-1.97 9.289c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.48 14.013 4.53 13.1c-.657-.204-.67-.657.136-.975l10.862-4.187c.548-.196 1.027.12.848.97l-.814-.66z"/>
            </svg>
            Join Noesis Macro News on Telegram
          </a>
          <p className="text-[11px] text-gray-400">Tap to join — no approval needed, instant access.</p>
        </div>
      </section>

      {/* P&L Alerts */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Interested Amount P&amp;L Alerts</h2>
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-4">
          <p className="text-xs text-gray-400">Receive a summary of how your interested stocks are performing vs your entry price, via your selected alert channel.</p>
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
    </div>
  )
}

function BYOKSection({ apiKeySet }: { apiKeySet: boolean }) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [showInput, setShowInput] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus('saving')
    const result = await saveApiKey(new FormData(e.currentTarget))
    if (result.error) {
      setErrorMsg(result.error)
      setStatus('error')
    } else {
      setStatus('saved')
      setShowInput(false)
      setTimeout(() => setStatus('idle'), 3000)
    }
  }

  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">AI Assistant</h2>
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3">
        <div>
          <div className="text-sm font-medium text-gray-700 mb-0.5">Anthropic API Key (BYOK)</div>
          <div className="text-xs text-gray-400 leading-relaxed">
            Bring your own key — AI briefs will use your key instead of the app&apos;s. Your key is stored encrypted and never exposed to the browser.
          </div>
        </div>

        {!showInput ? (
          <div className="flex items-center gap-3">
            {apiKeySet ? (
              <span className="text-xs text-emerald-600 font-medium">✓ API key saved — your briefs use your key</span>
            ) : (
              <span className="text-xs text-gray-400">Not set — using app&apos;s shared key</span>
            )}
            <button
              type="button"
              onClick={() => setShowInput(true)}
              className="text-xs text-blue-600 hover:text-blue-500 font-medium"
            >
              {apiKeySet ? 'Update key' : 'Add key'}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="password"
              name="anthropic_api_key"
              placeholder="sk-ant-api03-..."
              autoComplete="off"
              className="w-full px-4 py-2.5 rounded-lg bg-white text-gray-900 border border-gray-300 focus:outline-none focus:border-blue-500 text-sm font-mono"
            />
            <div className="text-xs text-gray-400">Leave blank to remove your key and revert to the app&apos;s default.</div>
            {status === 'error' && <p className="text-xs text-red-500">{errorMsg}</p>}
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={status === 'saving'}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {status === 'saving' ? 'Saving...' : 'Save key'}
              </button>
              <button
                type="button"
                onClick={() => { setShowInput(false); setStatus('idle') }}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-600 text-sm hover:border-gray-400 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
        {status === 'saved' && <span className="text-xs text-emerald-600">✓ Key saved</span>}
      </div>
    </section>
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
