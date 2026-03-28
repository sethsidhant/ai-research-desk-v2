'use client'

import { useEffect, useState } from 'react'

type Status = 'open' | 'warning' | 'preopen' | 'closed'

function getISTparts(): { h: number; m: number; day: number } {
  const now = new Date()
  const ist  = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric', minute: 'numeric', weekday: 'short',
    hour12: false,
  }).formatToParts(now)
  const h    = parseInt(ist.find(p => p.type === 'hour')!.value)
  const m    = parseInt(ist.find(p => p.type === 'minute')!.value)
  const wday = ist.find(p => p.type === 'weekday')!.value // Mon Tue …
  // 0=Sun … 6=Sat
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return { h, m, day: dayMap[wday] ?? 0 }
}

function computeStatus(): { status: Status; label: string; sub: string } {
  const { h, m, day } = getISTparts()
  const isWeekend = day === 0 || day === 6
  const totalMin  = h * 60 + m

  const PREOPEN_START = 9 * 60           // 9:00
  const OPEN_START    = 9 * 60 + 15      // 9:15
  const WARN_START    = 15 * 60          // 15:00 — 30 min before close
  const CLOSE         = 15 * 60 + 30     // 15:30

  if (isWeekend) {
    return { status: 'closed', label: 'Market Closed', sub: 'Opens Monday 9:15 AM' }
  }

  if (totalMin >= OPEN_START && totalMin < WARN_START) {
    const minsLeft = CLOSE - totalMin
    const hLeft    = Math.floor(minsLeft / 60)
    const mLeft    = minsLeft % 60
    const timeStr  = hLeft > 0 ? `${hLeft}h ${mLeft}m left` : `${mLeft}m left`
    return { status: 'open', label: 'Market Open', sub: timeStr }
  }

  if (totalMin >= WARN_START && totalMin < CLOSE) {
    const minsLeft = CLOSE - totalMin
    return { status: 'warning', label: 'Closing Soon', sub: `${minsLeft}m to close` }
  }

  if (totalMin >= PREOPEN_START && totalMin < OPEN_START) {
    const minsLeft = OPEN_START - totalMin
    return { status: 'preopen', label: 'Pre-Open', sub: `Opens in ${minsLeft}m` }
  }

  // Closed — compute next open
  if (totalMin < PREOPEN_START) {
    const minsToOpen = PREOPEN_START - totalMin
    const hLeft = Math.floor(minsToOpen / 60)
    const mLeft = minsToOpen % 60
    return { status: 'closed', label: 'Market Closed', sub: hLeft > 0 ? `Opens in ${hLeft}h ${mLeft}m` : `Opens in ${mLeft}m` }
  }

  // After close
  return { status: 'closed', label: 'Market Closed', sub: 'Opens 9:15 AM' }
}

const CONFIG: Record<Status, { dot: string; pill: string; label: string; ring: string }> = {
  open:    { dot: '#22c55e', pill: 'rgba(34,197,94,0.1)',   label: '#15803d', ring: 'rgba(34,197,94,0.3)' },
  warning: { dot: '#f59e0b', pill: 'rgba(245,158,11,0.1)',  label: '#b45309', ring: 'rgba(245,158,11,0.3)' },
  preopen: { dot: '#60a5fa', pill: 'rgba(96,165,250,0.1)',  label: '#1d4ed8', ring: 'rgba(96,165,250,0.3)' },
  closed:  { dot: '#9ca3af', pill: 'rgba(156,163,175,0.1)', label: '#6b7280', ring: 'transparent'          },
}

export default function MarketStatusLight() {
  const [state, setState] = useState(computeStatus)

  useEffect(() => {
    const tick = () => setState(computeStatus())
    tick()
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [])

  const cfg   = CONFIG[state.status]
  const pulse = state.status !== 'closed'

  return (
    <div
      className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full"
      style={{ background: cfg.pill, border: `1px solid ${cfg.ring}` }}
    >
      {/* Traffic light dot */}
      <span className="relative flex items-center justify-center" style={{ width: 8, height: 8 }}>
        {pulse && (
          <span
            className="absolute inset-0 rounded-full animate-ping"
            style={{ background: cfg.dot, opacity: 0.5 }}
          />
        )}
        <span className="relative rounded-full" style={{ width: 7, height: 7, background: cfg.dot }} />
      </span>

      <span className="text-[11px] font-semibold" style={{ color: cfg.label }}>
        {state.label}
      </span>
      <span className="text-[10px]" style={{ color: cfg.label, opacity: 0.7 }}>
        {state.sub}
      </span>
    </div>
  )
}
