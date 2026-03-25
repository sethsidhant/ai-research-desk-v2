'use client'

import { useState } from 'react'

type Status = 'idle' | 'loading' | 'ok' | 'error'

function useAction(url: string, method = 'POST') {
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState<string | null>(null)

  async function run(body?: Record<string, string>) {
    setStatus('loading')
    setMessage(null)
    try {
      const res  = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      const json = await res.json()
      if (!res.ok) {
        setStatus('error')
        setMessage(json.error ?? `Error ${res.status}`)
      } else {
        setStatus('ok')
        setMessage(json.message ?? null)
      }
    } catch (e: unknown) {
      setStatus('error')
      setMessage(e instanceof Error ? e.message : 'Network error')
    }
  }

  return { status, message, run }
}

function ActionButton({
  label,
  description,
  status,
  onRun,
  confirmText,
}: {
  label: string
  description: string
  status: Status
  onRun: () => void
  confirmText?: string
}) {
  function handleClick() {
    if (confirmText && !window.confirm(confirmText)) return
    onRun()
  }

  const btnColor =
    status === 'ok'      ? 'bg-emerald-600 text-white' :
    status === 'error'   ? 'bg-red-600 text-white' :
    status === 'loading' ? 'bg-gray-400 text-white cursor-not-allowed' :
    'bg-gray-900 text-white hover:bg-gray-700'

  return (
    <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 shadow-sm flex items-center justify-between gap-4">
      <div>
        <div className="text-sm font-semibold text-gray-900">{label}</div>
        <div className="text-xs text-gray-400 mt-0.5">{description}</div>
        {status === 'ok' && (
          <div className="text-xs text-emerald-600 mt-1 font-medium">Triggered successfully</div>
        )}
        {status === 'error' && (
          <div className="text-xs text-red-600 mt-1">{status === 'error' ? 'Failed' : ''}</div>
        )}
      </div>
      <button
        onClick={handleClick}
        disabled={status === 'loading'}
        className={`shrink-0 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${btnColor}`}
      >
        {status === 'loading' ? 'Running…' : status === 'ok' ? 'Done' : label}
      </button>
    </div>
  )
}

export default function AdminActions() {
  const pipeline = useAction('/api/admin/trigger-pipeline')
  const railway  = useAction('/api/admin/restart-railway')
  const rescore  = useAction('') // URL set dynamically per ticker

  const [ticker, setTicker]         = useState('')
  const [rescoreStatus, setRescoreStatus] = useState<Status>('idle')
  const [rescoreMsg, setRescoreMsg] = useState<string | null>(null)

  async function handleRescore() {
    const t = ticker.trim().toUpperCase()
    if (!t) return
    setRescoreStatus('loading')
    setRescoreMsg(null)
    try {
      const res  = await fetch(`/api/run-stock/${t}`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        setRescoreStatus('error')
        setRescoreMsg(json.error ?? `Error ${res.status}`)
      } else if (json.status === 'already_scored') {
        setRescoreStatus('ok')
        setRescoreMsg(`${t} already scored today`)
      } else {
        setRescoreStatus('ok')
        setRescoreMsg(`${t} re-scoring started — takes ~2 min`)
      }
    } catch (e: unknown) {
      setRescoreStatus('error')
      setRescoreMsg(e instanceof Error ? e.message : 'Network error')
    }
  }

  return (
    <div className="space-y-3">
      <ActionButton
        label="Re-run Daily Pipeline"
        description="Triggers GitHub Actions — engine, FII, news, summary agents. Takes ~5 min."
        status={pipeline.status}
        onRun={() => pipeline.run()}
        confirmText="This will re-run the full daily pipeline on GitHub Actions. Continue?"
      />

      <ActionButton
        label="Restart Railway Listener"
        description="Redeploys the Railway service — watchers + onboarding listener restart in ~30s."
        status={railway.status}
        onRun={() => railway.run()}
        confirmText="This will restart the Railway listener. All in-flight watchers will reconnect. Continue?"
      />

      {/* Re-score a single stock */}
      <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 shadow-sm">
        <div className="text-sm font-semibold text-gray-900">Re-score a Stock</div>
        <div className="text-xs text-gray-400 mt-0.5 mb-3">
          Re-runs onboarding for one ticker — fetches fresh Screener + Kite data.
        </div>
        <div className="flex gap-2 items-center">
          <input
            value={ticker}
            onChange={e => { setTicker(e.target.value.toUpperCase()); setRescoreStatus('idle'); setRescoreMsg(null) }}
            placeholder="e.g. NMDC"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono w-36 focus:outline-none focus:ring-2 focus:ring-gray-300"
            onKeyDown={e => e.key === 'Enter' && handleRescore()}
          />
          <button
            onClick={handleRescore}
            disabled={rescoreStatus === 'loading' || !ticker.trim()}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              rescoreStatus === 'loading' || !ticker.trim()
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : rescoreStatus === 'ok'
                ? 'bg-emerald-600 text-white'
                : rescoreStatus === 'error'
                ? 'bg-red-600 text-white'
                : 'bg-gray-900 text-white hover:bg-gray-700'
            }`}
          >
            {rescoreStatus === 'loading' ? 'Running…' : 'Re-score'}
          </button>
          {rescoreMsg && (
            <span className={`text-xs ${rescoreStatus === 'error' ? 'text-red-600' : 'text-emerald-600'}`}>
              {rescoreMsg}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
