'use client'

import { useState } from 'react'
import { Sparkles, ChevronDown, ChevronUp } from 'lucide-react'

type Item = { summary: string; created_at: string }

export default function AiBriefButton({ items, type }: { items: Item[]; type: 'trump' | 'macro' }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle')
  const [brief, setBrief]   = useState<string | null>(null)
  const [open, setOpen]     = useState(true)

  async function generate() {
    setState('loading')
    try {
      const res  = await fetch('/api/macro-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, items }),
      })
      const json = await res.json()
      setBrief(json.brief ?? 'Could not generate brief.')
      setState('done')
      setOpen(true)
    } catch {
      setBrief('Error generating brief.')
      setState('done')
    }
  }

  return (
    <div>
      {/* Button */}
      {state !== 'done' ? (
        <button
          onClick={generate}
          disabled={state === 'loading' || items.length === 0}
          className="flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-full transition-all disabled:opacity-40"
          style={{
            background: 'linear-gradient(135deg, rgba(0,61,155,0.08), rgba(0,106,97,0.08))',
            border: '1px solid rgba(0,106,97,0.2)',
            color: 'var(--artha-teal)',
          }}
        >
          <Sparkles size={10} strokeWidth={2.5} />
          {state === 'loading' ? 'Briefing…' : 'AI Brief'}
        </button>
      ) : (
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-full transition-all"
          style={{
            background: 'rgba(0,106,97,0.1)',
            border: '1px solid rgba(0,106,97,0.25)',
            color: 'var(--artha-teal)',
          }}
        >
          <Sparkles size={10} strokeWidth={2.5} />
          AI Brief
          {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
        </button>
      )}

      {/* Brief output */}
      {state === 'done' && brief && open && (
        <div
          className="mt-3 rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-line"
          style={{
            background: 'linear-gradient(135deg, rgba(0,61,155,0.04), rgba(0,106,97,0.04))',
            border: '1px solid rgba(0,106,97,0.15)',
            color: 'var(--artha-text-secondary)',
            borderLeft: '3px solid var(--artha-teal)',
          }}
        >
          {brief}
        </div>
      )}
    </div>
  )
}
