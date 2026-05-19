'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'

interface CollapsibleSectionProps {
  label: string
  badge?: string
  defaultOpen?: boolean
  linkHref?: string
  linkLabel?: string
  children: React.ReactNode
}

export default function CollapsibleSection({
  label,
  badge,
  defaultOpen = true,
  linkHref,
  linkLabel,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div>
      {/* Clickable header */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-5 py-3.5 text-left transition-colors hover:bg-black/[0.02]"
        style={{ borderBottom: open ? '1px solid var(--artha-border)' : 'none' }}
      >
        <span className="artha-label flex-1 text-left">{label}</span>

        {badge && (
          <span
            className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0"
            style={{ background: 'var(--artha-surface)', color: 'var(--artha-text-muted)', border: '1px solid var(--artha-border)' }}
          >
            {badge}
          </span>
        )}

        {linkHref && linkLabel && (
          <Link
            href={linkHref}
            onClick={e => e.stopPropagation()}
            className="text-xs shrink-0 transition-colors hover:opacity-80"
            style={{ color: 'var(--artha-teal)' }}
          >
            {linkLabel} →
          </Link>
        )}

        <ChevronDown
          size={14}
          className="shrink-0 transition-transform duration-200"
          style={{
            color: 'var(--artha-text-faint)',
            transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
          }}
        />
      </button>

      {open && <div>{children}</div>}
    </div>
  )
}
