'use client'

import Sidebar from './Sidebar'

interface AppShellProps {
  children:  React.ReactNode
  userEmail: string
  isAdmin:   boolean
}

export default function AppShell({ children, userEmail, isAdmin }: AppShellProps) {
  return (
    <div className="flex min-h-screen" style={{ background: 'var(--artha-surface)' }}>
      <Sidebar userEmail={userEmail} isAdmin={isAdmin} />
      <main
        className="flex-1 min-h-screen overflow-x-hidden"
        style={{ marginLeft: '240px' }}
      >
        {children}
      </main>
    </div>
  )
}
