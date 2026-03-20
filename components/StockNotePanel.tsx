'use client'

import { useState, useEffect, useRef } from 'react'

export default function StockNotePanel({
  stockId,
  stockName,
  ticker,
  initialNote,
  onClose,
  onSaved,
}: {
  stockId: string | null
  stockName?: string
  ticker?: string
  initialNote: string
  onClose: () => void
  onSaved: (stockId: string, notes: string) => void
}) {
  const [text, setText]     = useState(initialNote)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const textareaRef         = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (stockId) {
      setText(initialNote)
      setSaved(false)
      setTimeout(() => textareaRef.current?.focus(), 100)
    }
  }, [stockId])

  if (!stockId) return null

  async function save() {
    if (!stockId) return
    setSaving(true)
    await fetch('/api/stock-note', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stock_id: stockId, notes: text.trim() || null }),
    })
    setSaving(false)
    setSaved(true)
    onSaved(stockId, text.trim())
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full sm:w-96 bg-white shadow-2xl z-50 flex flex-col">

        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <div className="font-bold text-gray-900 text-base">{stockName ?? ticker}</div>
            <div className="text-xs text-gray-400 font-mono mt-0.5">{ticker} · My Notes</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none mt-0.5">✕</button>
        </div>

        {/* Note area */}
        <div className="flex-1 flex flex-col px-5 py-4 gap-3">
          <p className="text-xs text-gray-400">Your private research notes — only visible to you.</p>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={e => { setText(e.target.value); setSaved(false) }}
            placeholder="Write your thoughts, entry thesis, risks, price targets…"
            className="flex-1 resize-none border border-gray-200 rounded-xl p-3 text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400 leading-relaxed"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">{text.length > 0 ? `${text.length} chars` : ''}</span>
            <button
              onClick={save}
              disabled={saving}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
