'use client'

import { useState } from 'react'
import { Menu, TrendingUp } from 'lucide-react'
import Sidebar from './Sidebar'

interface AppShellProps {
  children:  React.ReactNode
  userEmail: string
  isAdmin:   boolean
}

export default function AppShell({ children, userEmail, isAdmin }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--artha-surface)' }}>
      <Sidebar
        userEmail={userEmail}
        isAdmin={isAdmin}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Desktop: always-visible sidebar spacer */}
      <div className="hidden md:block shrink-0" style={{ width: '240px' }} />

      <main className="flex-1 min-w-0 min-h-screen overflow-x-hidden">

        {/* Mobile top bar */}
        <div
          className="md:hidden flex items-center gap-3 px-4 py-3 sticky top-0 z-30"
          style={{
            background: 'var(--artha-surface)',
            borderBottom: '1px solid rgba(11,28,48,0.08)',
          }}
        >
          <button
            onClick={() => setSidebarOpen(true)}
            className="flex items-center justify-center rounded-lg transition-colors"
            style={{ width: '36px', height: '36px', background: 'rgba(11,28,48,0.06)', color: 'var(--artha-text)' }}
          >
            <Menu size={18} />
          </button>
          <div className="flex items-center gap-2">
            <div
              className="flex items-center justify-center rounded-md"
              style={{
                width: '24px', height: '24px',
                background: 'linear-gradient(135deg, #006a61 0%, #00897b 100%)',
              }}
            >
              <TrendingUp size={12} color="white" strokeWidth={2.5} />
            </div>
            <span
              className="font-display font-bold"
              style={{ fontSize: '1rem', color: 'var(--artha-text)', letterSpacing: '-0.03em' }}
            >
              Noesis
            </span>
          </div>
        </div>

        {children}
      </main>
    </div>
  )
}
