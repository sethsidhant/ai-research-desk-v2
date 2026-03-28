'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Star,
  Briefcase,
  BarChart2,
  Settings,
  ShieldCheck,
  LogOut,
  TrendingUp,
} from 'lucide-react'
import { signOut } from '@/app/actions'

interface NavItem {
  href:    string
  label:   string
  icon:    React.ElementType
  adminOnly?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { href: '/',             label: 'Overview',     icon: LayoutDashboard },
  { href: '/watchlist',    label: 'Watchlist',    icon: Star },
  { href: '/portfolio',    label: 'Portfolio',    icon: Briefcase },
  { href: '/market-pulse', label: 'Market Pulse', icon: BarChart2 },
  { href: '/settings',     label: 'Settings',     icon: Settings },
  { href: '/admin',        label: 'Admin',        icon: ShieldCheck, adminOnly: true },
]

interface SidebarProps {
  userEmail: string
  isAdmin:   boolean
}

function getInitials(email: string): string {
  const name = email.split('@')[0]
  const parts = name.split(/[._-]/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

export default function Sidebar({ userEmail, isAdmin }: SidebarProps) {
  const pathname = usePathname()

  return (
    <aside
      className="fixed inset-y-0 left-0 z-50 flex flex-col"
      style={{
        width: '240px',
        background: 'linear-gradient(180deg, #0f2133 0%, #0b1c2e 60%, #091624 100%)',
        borderRight: '1px solid rgba(255,255,255,0.04)',
      }}
    >
      {/* ── Brand ───────────────────────────────────────────────────────── */}
      <div className="px-5 pt-6 pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-2.5">
          <div
            className="flex items-center justify-center rounded-lg shrink-0"
            style={{
              width: '32px', height: '32px',
              background: 'linear-gradient(135deg, #006a61 0%, #00897b 100%)',
              boxShadow: '0 2px 8px rgba(0, 106, 97, 0.4)',
            }}
          >
            <TrendingUp size={16} color="white" strokeWidth={2.5} />
          </div>
          <div>
            <div
              className="font-display font-bold leading-none"
              style={{ fontSize: '1.15rem', color: '#ffffff', letterSpacing: '-0.03em' }}
            >
              Artha
            </div>
            <div style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: '2px' }}>
              Research Desk
            </div>
          </div>
        </div>
      </div>

      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.filter(item => !item.adminOnly || isAdmin).map(item => {
          const isActive = item.href === '/'
            ? pathname === '/'
            : pathname.startsWith(item.href)
          const Icon = item.icon

          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 group relative"
              style={isActive ? {
                background:  'rgba(0, 106, 97, 0.14)',
                borderLeft:  '2.5px solid #00c4b4',
                paddingLeft: 'calc(0.75rem - 2.5px)',
              } : {
                borderLeft: '2.5px solid transparent',
                paddingLeft: 'calc(0.75rem - 2.5px)',
              }}
            >
              <Icon
                size={17}
                strokeWidth={isActive ? 2.2 : 1.8}
                style={{ color: isActive ? '#4dd9cc' : 'rgba(255,255,255,0.4)', flexShrink: 0, transition: 'color 0.15s' }}
                className="group-hover:!text-[rgba(255,255,255,0.75)]"
              />
              <span
                className="text-sm font-medium transition-colors duration-150 group-hover:text-white"
                style={{ color: isActive ? '#4dd9cc' : 'rgba(255,255,255,0.45)' }}
              >
                {item.label}
              </span>
              {isActive && (
                <span
                  className="ml-auto rounded-full"
                  style={{ width: '5px', height: '5px', background: '#00c4b4', boxShadow: '0 0 6px rgba(0, 196, 180, 0.6)' }}
                />
              )}
            </Link>
          )
        })}
      </nav>

      {/* ── User ────────────────────────────────────────────────────────── */}
      <div
        className="px-3 py-4"
        style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="flex items-center gap-3 px-2 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)' }}>
          {/* Avatar */}
          <div
            className="flex items-center justify-center rounded-full shrink-0 font-display font-bold"
            style={{
              width: '32px', height: '32px',
              background: 'linear-gradient(135deg, #003d9b, #006a61)',
              fontSize: '0.7rem', color: 'white', letterSpacing: '0.02em',
            }}
          >
            {getInitials(userEmail)}
          </div>

          {/* Email */}
          <div className="flex-1 min-w-0">
            <div
              className="truncate font-medium"
              style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.7)', lineHeight: 1.3 }}
            >
              {userEmail.split('@')[0]}
            </div>
            <div style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.3)', lineHeight: 1.3 }}>
              {userEmail.split('@')[1]}
            </div>
          </div>

          {/* Sign out */}
          <form action={signOut}>
            <button
              type="submit"
              title="Sign out"
              className="flex items-center justify-center rounded-md transition-colors hover:bg-white/10"
              style={{ width: '28px', height: '28px', color: 'rgba(255,255,255,0.3)' }}
            >
              <LogOut size={14} />
            </button>
          </form>
        </div>
      </div>
    </aside>
  )
}
