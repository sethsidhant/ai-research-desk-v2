'use client'

import { useState } from 'react'

export default function BudgetForm({ current }: { current: number | null }) {
  const [val, setVal]       = useState(current?.toString() ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)

  async function save() {
    setSaving(true)
    await fetch('/api/admin/set-budget', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ budget: val }),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="flex items-center gap-2 mt-3">
      <span className="text-xs text-gray-400">Set credit balance:</span>
      <span className="text-xs text-gray-400">$</span>
      <input
        type="number"
        min="0"
        step="0.01"
        value={val}
        onChange={e => setVal(e.target.value)}
        className="w-24 text-xs border border-gray-200 rounded-lg px-2 py-1.5 font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
        placeholder="9.65"
      />
      <button
        onClick={save}
        disabled={saving}
        className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50"
      >
        {saved ? 'Saved ✓' : saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}
