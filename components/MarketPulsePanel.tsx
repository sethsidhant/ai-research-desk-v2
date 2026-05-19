'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

interface MarketPulsePanelProps {
  fiiNet: number
  diiNet: number
  fii5d: number
  dii5d: number
  fiiStreak: number
  fiiStreakDir: 'buying' | 'selling' | null
  mfEqNet: number | null
  mfDate: string | null
  mfCurrMonthEq: number
  mfPrevMonthEq: number
  mfLatestMonthLabel: string
  mfPrevMonthLabel: string
}

function fmtCr(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 100000) return `₹${(n / 100000).toFixed(1)}L Cr`
  if (abs >= 1000)   return `₹${(n / 1000).toFixed(1)}k Cr`
  return `₹${n.toLocaleString('en-IN')} Cr`
}

function TugOfWarBar({ fiiNet, diiNet }: { fiiNet: number; diiNet: number }) {
  const fiiAbs = Math.abs(fiiNet)
  const diiAbs = Math.abs(diiNet)
  const total  = fiiAbs + diiAbs
  if (total === 0) return null
  const fiiPct = Math.round((fiiAbs / total) * 100)
  const diiPct = 100 - fiiPct
  const fiiColor = fiiNet >= 0 ? '#006a61' : '#c0392b'
  const diiColor = diiNet >= 0 ? '#003d9b' : '#9a3412'

  return (
    <div>
      <div className="flex items-center justify-between text-[9px] mb-1.5">
        <span className="font-semibold" style={{ color: fiiColor }}>
          {fiiNet >= 0 ? '▲' : '▼'} FII {fiiPct}%
        </span>
        <span className="uppercase tracking-wider" style={{ color: 'var(--artha-text-faint)' }}>flow weight</span>
        <span className="font-semibold" style={{ color: diiColor }}>
          DII {diiPct}% {diiNet >= 0 ? '▲' : '▼'}
        </span>
      </div>
      <div className="flex h-3 rounded-full overflow-hidden gap-px">
        <div style={{ width: `${fiiPct}%`, background: fiiColor, opacity: 0.85 }} />
        <div style={{ width: '2px', background: 'white', flexShrink: 0 }} />
        <div style={{ width: `${diiPct}%`, background: diiColor, opacity: 0.85 }} />
      </div>
      <div className="flex items-center justify-between text-[9px] mt-1">
        <span style={{ color: 'var(--artha-text-faint)' }}>{fiiNet >= 0 ? 'Buying' : 'Selling'}</span>
        {fiiNet >= 0 !== diiNet >= 0 ? (
          <span className="font-semibold" style={{ color: 'var(--artha-warning)' }}>↔ Diverging</span>
        ) : (
          <span className="font-semibold" style={{ color: fiiColor }}>↕ Aligned</span>
        )}
        <span style={{ color: 'var(--artha-text-faint)' }}>{diiNet >= 0 ? 'Buying' : 'Selling'}</span>
      </div>
    </div>
  )
}

export default function MarketPulsePanel({
  fiiNet,
  diiNet,
  fii5d,
  dii5d,
  fiiStreak,
  fiiStreakDir,
  mfEqNet,
  mfDate,
  mfCurrMonthEq,
  mfPrevMonthEq,
  mfLatestMonthLabel,
  mfPrevMonthLabel,
}: MarketPulsePanelProps) {
  const [open, setOpen] = useState(true)

  const netInst = fiiNet + diiNet
  const netUp   = netInst >= 0

  const compactSummary = `FII ${fiiNet >= 0 ? '+' : ''}${fmtCr(fiiNet)} · DII ${diiNet >= 0 ? '+' : ''}${fmtCr(diiNet)} · Net ${netInst >= 0 ? '+' : ''}${fmtCr(netInst)}`

  return (
    <div className="artha-card overflow-hidden">
      {/* Clickable header — always visible */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3.5 transition-colors hover:bg-black/[0.02]"
        style={{ borderBottom: open ? '1px solid var(--artha-border)' : 'none' }}
      >
        <span className="artha-label">Market Pulse</span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono" style={{ color: 'var(--artha-text-faint)' }}>
            {compactSummary}
          </span>
          <ChevronDown
            size={14}
            className="shrink-0 transition-transform duration-200"
            style={{
              color: 'var(--artha-text-faint)',
              transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
            }}
          />
        </div>
      </button>

      {open && (
        <div className="px-4 py-4 space-y-3">
          {/* FII + DII net boxes */}
          <div className="grid grid-cols-2 gap-2">
            {([
              { label: 'FII Net', val: fiiNet, rolling: fii5d },
              { label: 'DII Net', val: diiNet, rolling: dii5d },
            ] as const).map(({ label, val, rolling }) => (
              <div
                key={label}
                className="rounded-xl px-3 py-2.5"
                style={{ background: val >= 0 ? 'var(--artha-teal-subtle)' : 'var(--artha-negative-bg)' }}
              >
                <div className="artha-label mb-1">{label}</div>
                <div
                  className="font-display font-bold text-sm"
                  style={{ color: val >= 0 ? 'var(--artha-teal)' : 'var(--artha-negative)' }}
                >
                  {val >= 0 ? '+' : ''}{fmtCr(val)}
                </div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--artha-text-muted)' }}>
                  5d:{' '}
                  <span style={{ color: rolling >= 0 ? 'var(--artha-teal)' : 'var(--artha-negative)' }}>
                    {rolling >= 0 ? '+' : ''}{fmtCr(rolling)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Tug-of-war bar */}
          <TugOfWarBar fiiNet={fiiNet} diiNet={diiNet} />

          {/* Net Institutional */}
          <div
            className="flex items-center justify-between px-3 py-2 rounded-lg"
            style={{ background: 'var(--artha-surface)' }}
          >
            <span className="text-xs" style={{ color: 'var(--artha-text-muted)' }}>Net Institutional</span>
            <span
              className="font-display font-bold text-sm"
              style={{ color: netUp ? 'var(--artha-teal)' : 'var(--artha-negative)' }}
            >
              {netUp ? '+' : ''}{fmtCr(netInst)}
            </span>
          </div>

          {/* Streak badge */}
          {fiiStreakDir && fiiStreak >= 2 && (
            <div
              className="text-xs font-semibold px-3 py-1.5 rounded-lg"
              style={{
                background: fiiStreakDir === 'buying' ? 'var(--artha-teal-subtle)' : 'var(--artha-negative-bg)',
                color: fiiStreakDir === 'buying' ? 'var(--artha-teal)' : 'var(--artha-negative)',
              }}
            >
              FII {fiiStreakDir} for {fiiStreak} consecutive days
            </div>
          )}

          {/* MF Section */}
          {mfEqNet != null && (
            <>
              <div style={{ borderTop: '1px solid var(--artha-border)', paddingTop: '0.75rem' }}>
                <div className="artha-label mb-2">MF · SEBI Flows</div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div
                    className="rounded-xl px-3 py-2.5"
                    style={{ background: mfEqNet >= 0 ? 'var(--artha-teal-subtle)' : 'var(--artha-negative-bg)' }}
                  >
                    <div className="artha-label mb-1">Equity</div>
                    <div
                      className="font-display font-bold text-sm"
                      style={{ color: mfEqNet >= 0 ? 'var(--artha-teal)' : 'var(--artha-negative)' }}
                    >
                      {mfEqNet >= 0 ? '+' : ''}{fmtCr(mfEqNet)}
                    </div>
                  </div>
                  {/* Month comparison */}
                  <div className="rounded-xl px-3 py-2.5" style={{ background: 'var(--artha-surface)' }}>
                    <div className="artha-label mb-1">MTD</div>
                    <div
                      className="font-display font-bold text-sm"
                      style={{ color: mfCurrMonthEq >= 0 ? 'var(--artha-teal)' : 'var(--artha-negative)' }}
                    >
                      {mfCurrMonthEq >= 0 ? '+' : ''}{fmtCr(mfCurrMonthEq)}
                    </div>
                    <div className="text-[10px] mt-0.5" style={{ color: 'var(--artha-text-faint)' }}>
                      {mfLatestMonthLabel}
                    </div>
                  </div>
                </div>

                {/* Month-over-month */}
                {mfPrevMonthLabel && mfPrevMonthEq !== 0 && (
                  <div className="rounded-xl px-3 py-2" style={{ background: 'var(--artha-surface)' }}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs" style={{ color: 'var(--artha-text-muted)' }}>
                        {mfPrevMonthLabel}
                      </span>
                      <span
                        className="font-mono font-bold text-xs"
                        style={{ color: mfPrevMonthEq >= 0 ? 'var(--artha-teal)' : 'var(--artha-negative)' }}
                      >
                        {mfPrevMonthEq >= 0 ? '+' : ''}{fmtCr(mfPrevMonthEq)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-1 pt-1" style={{ borderTop: '1px solid var(--artha-border)' }}>
                      <span className="text-[10px]" style={{ color: 'var(--artha-text-faint)' }}>MoM</span>
                      <span
                        className="font-mono font-bold text-xs"
                        style={{ color: mfCurrMonthEq >= mfPrevMonthEq ? 'var(--artha-teal)' : 'var(--artha-negative)' }}
                      >
                        {mfCurrMonthEq >= mfPrevMonthEq ? '↑' : '↓'}{' '}
                        {Math.abs(Math.round((mfCurrMonthEq - mfPrevMonthEq) / Math.abs(mfPrevMonthEq) * 100))}%
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
