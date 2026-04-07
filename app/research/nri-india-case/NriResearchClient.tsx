'use client'

import { useState, useMemo } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

type CurrencyInput   = 'EUR' | 'USD' | 'INR'
type MarketKey       = 'india' | 'usa' | 'europe'
type TabKey          = 'thesis' | 'us_problem' | 'india_case' | 'currency' | 'nri_edge' | 'verdict'
type InvestmentMode  = 'lump_sum' | 'sip'
type InvestmentStyle = 'conservative' | 'balanced' | 'growth' | 'aggressive'

interface MarketResult {
  key:           MarketKey
  corpusLocal:   number
  corpusEur:     number
  netEur:        number
  netLocal:      number
  netCagrEur:    number
  netCagrLocal:  number
  totalInvested: number   // EUR equivalent of total money put in
  gainEur:       number
  taxEur:        number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const FX = { EUR_INR: 107, EUR_USD: 1.10 }

const MARKET_DEF = {
  india:  {
    name: 'India',  flag: '🇮🇳', currency: 'INR', symbol: '₹',
    fxDragVsEur: 0.03, taxRepatriate: 0.20, taxLocal: 0.125,
    accentColor: '#d97706', glowColor: 'rgba(217,119,6,0.22)', bgColor: 'rgba(217,119,6,0.06)',
  },
  usa:    {
    name: 'USA',    flag: '🇺🇸', currency: 'USD', symbol: '$',
    fxDragVsEur: 0.00, taxRepatriate: 0.41, taxLocal: 0.15,
    accentColor: '#3b82f6', glowColor: 'rgba(59,130,246,0.22)', bgColor: 'rgba(59,130,246,0.06)',
  },
  europe: {
    name: 'Europe', flag: '🇪🇺', currency: 'EUR', symbol: '€',
    fxDragVsEur: 0.00, taxRepatriate: 0.33, taxLocal: 0.33,
    accentColor: '#8b5cf6', glowColor: 'rgba(139,92,246,0.22)', bgColor: 'rgba(139,92,246,0.06)',
  },
} as const

// Each style maps to equivalent-risk indices across all three markets
const STYLE_DEF: Record<InvestmentStyle, {
  label: string; badge: string; description: string;
  india:  { grossReturn: number; benchmark: string; alloc: string }
  usa:    { grossReturn: number; benchmark: string; alloc: string }
  europe: { grossReturn: number; benchmark: string; alloc: string }
}> = {
  conservative: {
    label: 'Conservative', badge: 'Low risk', description: 'Largecap indices — lowest volatility, broad market',
    india:  { grossReturn: 0.12,  benchmark: 'Nifty 50',            alloc: '100% Nifty 50 largecap' },
    usa:    { grossReturn: 0.06,  benchmark: 'S&P 500',             alloc: 'S&P 500 index fund' },
    europe: { grossReturn: 0.05,  benchmark: 'Euro Stoxx 50',       alloc: 'Euro Stoxx 50' },
  },
  balanced: {
    label: 'Balanced', badge: 'Medium risk', description: 'Mostly large-cap, some mid — moderate risk',
    india:  { grossReturn: 0.125, benchmark: 'Nifty 200 blend',     alloc: '80% Nifty 50 + 20% Midcap 150' },
    usa:    { grossReturn: 0.07,  benchmark: 'S&P 500 + Midcap',    alloc: '70% S&P 500 + 30% Russell Midcap' },
    europe: { grossReturn: 0.055, benchmark: 'MSCI Europe',         alloc: 'MSCI Europe broad market' },
  },
  growth: {
    label: 'Growth', badge: 'Med-high risk', description: 'Mid-cap heavy — higher return, higher volatility',
    india:  { grossReturn: 0.14,  benchmark: 'Nifty Midcap 150',   alloc: 'Nifty Midcap 150' },
    usa:    { grossReturn: 0.08,  benchmark: 'Russell Midcap',      alloc: '50% S&P 500 + 50% Russell Midcap Growth' },
    europe: { grossReturn: 0.06,  benchmark: 'MSCI Europe Mid',     alloc: 'MSCI Europe Mid-Cap' },
  },
  aggressive: {
    label: 'Aggressive', badge: 'High risk', description: 'Small & mid cap — maximum growth, maximum volatility',
    india:  { grossReturn: 0.155, benchmark: 'Mid + Small blend',   alloc: '50% Midcap + 30% Smallcap + 20% Nifty 50' },
    usa:    { grossReturn: 0.09,  benchmark: 'Nasdaq + Russell 2000', alloc: '60% Nasdaq 100 + 40% Russell 2000' },
    europe: { grossReturn: 0.07,  benchmark: 'EU Small/Mid Cap',    alloc: 'MSCI Europe Small Cap' },
  },
}

const TAB_LABELS: Record<TabKey, string> = {
  thesis: 'Overview', us_problem: 'US Problem', india_case: "India's Case",
  currency: 'Currency', nri_edge: 'NRI Edge', verdict: 'Verdict',
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtAmount(n: number, currency: string): string {
  if (currency === 'INR') {
    if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`
    if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`
    return `₹${Math.round(n).toLocaleString('en-IN')}`
  }
  const sym = currency === 'EUR' ? '€' : '$'
  if (n >= 1e6) return `${sym}${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${sym}${(n / 1e3).toFixed(1)}K`
  return `${sym}${Math.round(n).toLocaleString()}`
}

function fmtPct(n: number, decimals = 1): string {
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(decimals)}%`
}

// ── Compute ───────────────────────────────────────────────────────────────────

function sipFV(monthlyLocal: number, annualRate: number, years: number): number {
  const r = annualRate / 12
  const n = years * 12
  if (r === 0) return monthlyLocal * n
  return monthlyLocal * ((Math.pow(1 + r, n) - 1) / r) * (1 + r)
}

function computeResults(
  amountEur: number,
  years: number,
  mode: InvestmentMode,
  style: InvestmentStyle,
): Record<MarketKey, MarketResult> {
  const results = {} as Record<MarketKey, MarketResult>
  const n = years * 12

  for (const key of ['india', 'usa', 'europe'] as MarketKey[]) {
    const m           = MARKET_DEF[key]
    const grossReturn = STYLE_DEF[style][key].grossReturn
    const localRate   = m.currency === 'INR' ? FX.EUR_INR : m.currency === 'USD' ? FX.EUR_USD : 1
    const amountLocal = amountEur * localRate
    const totalInvested = mode === 'sip' ? amountEur * n : amountEur

    let corpusLocal: number
    let principalLocal: number

    if (mode === 'lump_sum') {
      principalLocal = amountLocal
      corpusLocal    = amountLocal * Math.pow(1 + grossReturn, years)
    } else {
      principalLocal = amountLocal * n
      corpusLocal    = sipFV(amountLocal, grossReturn, years)
    }

    const principalEur = mode === 'sip' ? amountEur * n : amountEur

    // Repatriate: convert to EUR at future FX
    let corpusEur: number
    if (m.currency === 'INR') {
      corpusEur = corpusLocal / (FX.EUR_INR * Math.pow(1 + m.fxDragVsEur, years))
    } else if (m.currency === 'USD') {
      corpusEur = corpusLocal / FX.EUR_USD
    } else {
      corpusEur = corpusLocal
    }

    const gainEur     = Math.max(0, corpusEur - principalEur)
    const taxEur      = gainEur * m.taxRepatriate
    const netEur      = corpusEur - taxEur
    const netCagrEur  = principalEur > 0 ? Math.pow(netEur / principalEur, 1 / years) - 1 : 0

    const gainLocal    = Math.max(0, corpusLocal - principalLocal)
    const netLocal     = corpusLocal - gainLocal * m.taxLocal
    const netCagrLocal = principalLocal > 0 ? Math.pow(netLocal / principalLocal, 1 / years) - 1 : 0

    results[key] = { key, corpusLocal, corpusEur, netEur, netLocal, netCagrEur, netCagrLocal, totalInvested, gainEur, taxEur }
  }

  return results
}

// ── Brief sub-components (light theme) ───────────────────────────────────────

function BriefStatCard({ label, value, sub, accent = false }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-xl p-4" style={{
      background: accent ? 'var(--artha-teal-subtle)' : 'var(--artha-surface)',
      border: `1px solid ${accent ? 'rgba(0,106,97,0.15)' : 'rgba(11,28,48,0.07)'}`,
    }}>
      <div className="artha-label mb-1.5">{label}</div>
      <div className="font-display font-bold text-xl" style={{ color: accent ? 'var(--artha-teal)' : 'var(--artha-text)' }}>{value}</div>
      {sub && <div className="text-[10px] mt-0.5" style={{ color: 'var(--artha-text-muted)' }}>{sub}</div>}
    </div>
  )
}

function Callout({ children, type = 'gold' }: { children: React.ReactNode; type?: 'gold' | 'green' | 'red' }) {
  const styles = {
    gold:  { border: 'var(--artha-warning)',  bg: 'var(--artha-warning-bg)' },
    green: { border: 'var(--artha-teal)',     bg: 'var(--artha-teal-subtle)' },
    red:   { border: 'var(--artha-negative)', bg: 'var(--artha-negative-bg)' },
  }
  const s = styles[type]
  return (
    <div className="rounded-r-lg px-4 py-3 my-4" style={{ borderLeft: `2.5px solid ${s.border}`, background: s.bg }}>
      <div className="text-sm leading-relaxed" style={{ color: 'var(--artha-text-secondary)' }}>{children}</div>
    </div>
  )
}

function ScenarioRow({ label, note, india, us, winner }: {
  label: string; note: string; india: string; us: string; winner: 'india' | 'us' | 'draw'
}) {
  return (
    <div className="grid grid-cols-4 gap-3 py-3 border-b last:border-0 items-center" style={{ borderColor: 'rgba(11,28,48,0.06)' }}>
      <div>
        <div className="text-xs font-medium" style={{ color: 'var(--artha-text)' }}>{label}</div>
        <div className="text-[10px] mt-0.5" style={{ color: 'var(--artha-text-faint)' }}>{note}</div>
      </div>
      <div className="text-sm font-mono font-semibold text-center" style={{ color: winner === 'india' ? 'var(--artha-teal)' : 'var(--artha-text-muted)' }}>
        {india}{winner === 'india' && <span className="ml-1 text-[9px]">✓</span>}
      </div>
      <div className="text-sm font-mono font-semibold text-center" style={{ color: winner === 'us' ? 'var(--artha-teal)' : 'var(--artha-text-muted)' }}>
        {us}{winner === 'us' && <span className="ml-1 text-[9px]">✓</span>}
      </div>
      <div className="text-xs font-semibold text-center" style={{
        color: winner === 'india' ? 'var(--artha-teal)' : winner === 'us' ? 'var(--artha-negative)' : 'var(--artha-text-faint)'
      }}>
        {winner === 'india' ? 'India wins' : winner === 'us' ? 'US wins' : 'Draw'}
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function NriResearchClient() {
  const [amount, setAmount]               = useState('10000')
  const [inputCurrency, setInputCurrency] = useState<CurrencyInput>('EUR')
  const [years, setYears]                 = useState(10)
  const [repatriate, setRepatriate]       = useState(true)
  const [mode, setMode]                   = useState<InvestmentMode>('lump_sum')
  const [style, setStyle]                 = useState<InvestmentStyle>('growth')
  const [activeTab, setActiveTab]         = useState<TabKey>('thesis')

  const principalEur = useMemo(() => {
    const n = parseFloat(amount.replace(/,/g, '')) || 0
    if (inputCurrency === 'USD') return n / FX.EUR_USD
    if (inputCurrency === 'INR') return n / FX.EUR_INR
    return n
  }, [amount, inputCurrency])

  const results  = useMemo(() => computeResults(principalEur, years, mode, style), [principalEur, years, mode, style])
  const winnerKey = useMemo(() => {
    return (Object.entries(results) as [MarketKey, MarketResult][])
      .reduce((best, [k, r]) => {
        const v = repatriate ? r.netEur : r.netLocal
        const bv = repatriate ? results[best].netEur : results[best].netLocal
        return v > bv ? k : best
      }, 'india' as MarketKey)
  }, [results, repatriate])

  const maxCorpus = useMemo(() =>
    Math.max(...Object.values(results).map(r => repatriate ? r.netEur : r.netLocal)),
  [results, repatriate])

  const currencySymbol = inputCurrency === 'INR' ? '₹' : inputCurrency === 'USD' ? '$' : '€'

  return (
    <div className="px-6 py-5 max-w-screen-xl mx-auto space-y-6">

      {/* ── Page Header ──────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <h1 className="font-display font-bold text-2xl" style={{ color: 'var(--artha-text)', letterSpacing: '-0.03em' }}>
            NRI Investment Compass
          </h1>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full tracking-widest uppercase"
            style={{ background: 'rgba(0,106,97,0.1)', color: 'var(--artha-teal)' }}>
            Research
          </span>
        </div>
        <p className="text-xs" style={{ color: 'var(--artha-text-muted)' }}>
          India vs USA vs Europe · EUR-based NRI · April 2026 · Not financial advice
        </p>
      </div>

      {/* ── CALCULATOR ───────────────────────────────────────────────────── */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, #0d1f35 0%, #0b1a2e 100%)', boxShadow: '0 24px 64px rgba(0,0,0,0.3)' }}>

        {/* Header */}
        <div className="px-6 pt-6 pb-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="text-[10px] tracking-[0.2em] uppercase font-semibold mb-0.5" style={{ color: 'rgba(255,255,255,0.3)' }}>
            Interactive Calculator
          </div>
          <div className="text-lg font-semibold" style={{ color: 'rgba(255,255,255,0.9)', letterSpacing: '-0.02em' }}>
            Run your own numbers
          </div>
        </div>

        {/* ── Step 1: Investment Style ──────────────────────────────────── */}
        <div className="px-6 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="text-[10px] tracking-[0.15em] uppercase font-semibold mb-3" style={{ color: 'rgba(255,255,255,0.3)' }}>
            1 · Your investment style
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {(Object.entries(STYLE_DEF) as [InvestmentStyle, typeof STYLE_DEF.growth][]).map(([key, def]) => {
              const isActive = style === key
              return (
                <button key={key} onClick={() => setStyle(key)}
                  className="rounded-xl p-3 text-left transition-all"
                  style={{
                    background: isActive ? 'rgba(0,196,180,0.12)' : 'rgba(255,255,255,0.03)',
                    border: `1.5px solid ${isActive ? 'rgba(0,196,180,0.4)' : 'rgba(255,255,255,0.06)'}`,
                  }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold" style={{ color: isActive ? '#4dd9cc' : 'rgba(255,255,255,0.7)' }}>{def.label}</span>
                    <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full" style={{
                      background: isActive ? 'rgba(0,196,180,0.2)' : 'rgba(255,255,255,0.05)',
                      color: isActive ? '#4dd9cc' : 'rgba(255,255,255,0.3)',
                    }}>{def.badge}</span>
                  </div>
                  <div className="text-[9px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.3)' }}>{def.description}</div>
                </button>
              )
            })}
          </div>
          {/* Show what's being compared */}
          <div className="mt-3 flex items-center gap-4 flex-wrap">
            {(['india', 'usa', 'europe'] as MarketKey[]).map(k => (
              <div key={k} className="flex items-center gap-1.5">
                <span className="text-sm">{MARKET_DEF[k].flag}</span>
                <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
                  {STYLE_DEF[style][k].benchmark}
                  <span className="ml-1 font-mono" style={{ color: 'rgba(255,255,255,0.2)' }}>
                    ({(STYLE_DEF[style][k].grossReturn * 100).toFixed(1)}% p.a.)
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Step 2: Investment Type ───────────────────────────────────── */}
        <div className="px-6 py-4 flex items-center gap-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="text-[10px] tracking-[0.15em] uppercase font-semibold shrink-0" style={{ color: 'rgba(255,255,255,0.3)' }}>
            2 · Type
          </div>
          <div className="flex gap-2">
            {([
              { val: 'lump_sum', label: 'Lump Sum',    sub: 'One-time' },
              { val: 'sip',      label: 'Monthly SIP', sub: 'Every month' },
            ] as { val: InvestmentMode; label: string; sub: string }[]).map(opt => (
              <button key={opt.val} onClick={() => setMode(opt.val)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all"
                style={{
                  background: mode === opt.val ? 'rgba(0,196,180,0.15)' : 'rgba(255,255,255,0.04)',
                  color: mode === opt.val ? '#4dd9cc' : 'rgba(255,255,255,0.35)',
                  border: `1.5px solid ${mode === opt.val ? 'rgba(0,196,180,0.35)' : 'rgba(255,255,255,0.06)'}`,
                }}>
                <div className="w-3 h-3 rounded-full border-2 flex items-center justify-center shrink-0"
                  style={{ borderColor: mode === opt.val ? '#4dd9cc' : 'rgba(255,255,255,0.2)' }}>
                  {mode === opt.val && <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#4dd9cc' }} />}
                </div>
                <div>
                  <div>{opt.label}</div>
                  <div className="text-[9px] font-normal" style={{ color: 'rgba(255,255,255,0.25)' }}>{opt.sub}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ── Step 3: Inputs ───────────────────────────────────────────── */}
        <div className="px-6 py-5 grid grid-cols-1 md:grid-cols-3 gap-6" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>

          {/* Amount + currency */}
          <div>
            <label className="block text-[10px] tracking-[0.15em] uppercase font-semibold mb-2.5" style={{ color: 'rgba(255,255,255,0.3)' }}>
              3 · {mode === 'sip' ? 'Monthly Contribution' : 'Amount to Invest'}
            </label>
            <div className="flex items-center rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="pl-4 pr-2 text-sm font-mono" style={{ color: 'rgba(255,255,255,0.4)' }}>{currencySymbol}</div>
              <input
                type="text" value={amount}
                onChange={e => setAmount(e.target.value.replace(/[^0-9.,]/g, ''))}
                className="flex-1 py-3 pr-3 text-base font-mono font-semibold bg-transparent outline-none"
                style={{ color: 'rgba(255,255,255,0.9)' }}
                placeholder="10,000"
              />
            </div>
            <div className="flex gap-1.5 mt-2">
              {(['EUR', 'USD', 'INR'] as CurrencyInput[]).map(c => (
                <button key={c} onClick={() => setInputCurrency(c)}
                  className="flex-1 py-1.5 rounded-lg text-[10px] font-semibold tracking-wider uppercase transition-all"
                  style={{
                    background: inputCurrency === c ? 'rgba(0,196,180,0.15)' : 'rgba(255,255,255,0.04)',
                    color: inputCurrency === c ? '#4dd9cc' : 'rgba(255,255,255,0.3)',
                    border: `1px solid ${inputCurrency === c ? 'rgba(0,196,180,0.3)' : 'rgba(255,255,255,0.06)'}`,
                  }}>
                  {c === 'EUR' ? '€ EUR' : c === 'USD' ? '$ USD' : '₹ INR'}
                </button>
              ))}
            </div>
            {inputCurrency !== 'EUR' && principalEur > 0 && (
              <div className="mt-1.5 text-[10px]" style={{ color: 'rgba(255,255,255,0.2)' }}>
                ≈ €{Math.round(principalEur).toLocaleString()} at today's rates
              </div>
            )}
          </div>

          {/* Time horizon */}
          <div>
            <label className="block text-[10px] tracking-[0.15em] uppercase font-semibold mb-2.5" style={{ color: 'rgba(255,255,255,0.3)' }}>
              4 · Investment Horizon
            </label>
            <div className="flex items-baseline gap-2 mb-3">
              <span className="text-3xl font-display font-bold" style={{ color: '#4dd9cc', letterSpacing: '-0.03em' }}>{years}</span>
              <span className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>years</span>
            </div>
            <input type="range" min={3} max={25} step={1} value={years}
              onChange={e => setYears(Number(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
              style={{ accentColor: '#4dd9cc', background: `linear-gradient(to right, #4dd9cc ${((years - 3) / 22) * 100}%, rgba(255,255,255,0.1) 0%)` }}
            />
            <div className="flex justify-between mt-1.5 text-[9px]" style={{ color: 'rgba(255,255,255,0.2)' }}>
              <span>3 yr</span><span>10 yr</span><span>25 yr</span>
            </div>
          </div>

          {/* Repatriate to EUR */}
          <div>
            <label className="block text-[10px] tracking-[0.15em] uppercase font-semibold mb-2.5" style={{ color: 'rgba(255,255,255,0.3)' }}>
              5 · Bring money back to Europe?
            </label>
            <div className="grid grid-cols-1 gap-2">
              {[
                { val: true,  label: 'Yes — convert to €', sub: 'Final corpus in EUR, net of NRI tax' },
                { val: false, label: 'No — keep locally',  sub: 'Final corpus in local currency' },
              ].map(opt => (
                <button key={String(opt.val)} onClick={() => setRepatriate(opt.val)}
                  className="rounded-xl px-3 py-2.5 text-left transition-all"
                  style={{
                    background: repatriate === opt.val ? 'rgba(0,196,180,0.12)' : 'rgba(255,255,255,0.04)',
                    border: `1.5px solid ${repatriate === opt.val ? 'rgba(0,196,180,0.4)' : 'rgba(255,255,255,0.06)'}`,
                  }}>
                  <div className="flex items-center gap-2">
                    <div className="w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0"
                      style={{ borderColor: repatriate === opt.val ? '#4dd9cc' : 'rgba(255,255,255,0.2)' }}>
                      {repatriate === opt.val && <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#4dd9cc' }} />}
                    </div>
                    <div>
                      <div className="text-xs font-semibold" style={{ color: repatriate === opt.val ? '#4dd9cc' : 'rgba(255,255,255,0.5)' }}>
                        {opt.label}
                      </div>
                      <div className="text-[9px]" style={{ color: 'rgba(255,255,255,0.2)' }}>{opt.sub}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Results ──────────────────────────────────────────────────── */}
        <div className="px-6 py-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            {(['india', 'usa', 'europe'] as MarketKey[]).map(key => {
              const m        = MARKET_DEF[key]
              const r        = results[key]
              const isWinner = key === winnerKey
              const metric   = repatriate ? r.netEur : r.netLocal
              const cagr     = repatriate ? r.netCagrEur : r.netCagrLocal
              const barPct   = maxCorpus > 0 ? (metric / maxCorpus) * 100 : 0
              const displayAmt = repatriate ? fmtAmount(r.netEur, 'EUR') : fmtAmount(r.netLocal, m.currency)
              const localPrincipal = mode === 'sip'
                ? principalEur * (m.currency === 'INR' ? FX.EUR_INR : m.currency === 'USD' ? FX.EUR_USD : 1) * years * 12
                : principalEur * (m.currency === 'INR' ? FX.EUR_INR : m.currency === 'USD' ? FX.EUR_USD : 1)
              const multiplier = localPrincipal > 0 ? metric / (repatriate ? r.totalInvested : localPrincipal) : 0

              return (
                <div key={key} className="rounded-2xl p-5 relative transition-all"
                  style={{
                    background: isWinner ? m.bgColor : 'rgba(255,255,255,0.03)',
                    border: `1.5px solid ${isWinner ? m.accentColor + '55' : 'rgba(255,255,255,0.06)'}`,
                    boxShadow: isWinner ? `0 8px 32px ${m.glowColor}` : 'none',
                  }}>

                  {isWinner && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-[9px] font-bold tracking-widest uppercase whitespace-nowrap"
                      style={{ background: m.accentColor, color: '#fff', boxShadow: `0 2px 8px ${m.glowColor}` }}>
                      Best Pick
                    </div>
                  )}

                  {/* Market + CAGR */}
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{m.flag}</span>
                      <div>
                        <div className="text-sm font-bold" style={{ color: isWinner ? m.accentColor : 'rgba(255,255,255,0.7)' }}>{m.name}</div>
                        <div className="text-[9px]" style={{ color: 'rgba(255,255,255,0.25)' }}>{STYLE_DEF[style][key].benchmark}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold font-mono" style={{ color: m.accentColor }}>{fmtPct(cagr)}/yr</div>
                      <div className="text-[9px]" style={{ color: 'rgba(255,255,255,0.25)' }}>net CAGR</div>
                    </div>
                  </div>

                  {/* Allocation chip */}
                  <div className="mb-3 text-[9px] px-2 py-1 rounded-md inline-block" style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.3)' }}>
                    {STYLE_DEF[style][key].alloc}
                  </div>

                  {/* Corpus */}
                  <div className="mb-1">
                    <div className="text-[9px] uppercase tracking-widest mb-0.5" style={{ color: 'rgba(255,255,255,0.25)' }}>
                      {repatriate ? 'Final corpus (€ net of tax)' : `Final corpus (${m.currency} net)`}
                    </div>
                    <div className="font-display font-bold" style={{ fontSize: '1.75rem', letterSpacing: '-0.03em', color: isWinner ? m.accentColor : 'rgba(255,255,255,0.8)', lineHeight: 1.1 }}>
                      {displayAmt}
                    </div>
                  </div>

                  {/* Invested + multiplier */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-[10px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
                      {mode === 'sip' ? `${fmtAmount(r.totalInvested, 'EUR')} total in` : `${fmtAmount(principalEur, 'EUR')} invested`}
                    </div>
                    {multiplier > 0 && (
                      <div className="text-[10px] font-mono font-semibold" style={{ color: isWinner ? m.accentColor : 'rgba(255,255,255,0.3)' }}>
                        {multiplier.toFixed(1)}× your money
                      </div>
                    )}
                  </div>

                  {/* Bar */}
                  <div className="mb-3">
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      <div className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${barPct}%`, background: isWinner ? m.accentColor : 'rgba(255,255,255,0.15)' }} />
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    <div className="rounded-lg px-2.5 py-2" style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <div style={{ color: 'rgba(255,255,255,0.25)' }}>Gross return</div>
                      <div className="font-mono font-semibold mt-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
                        {(STYLE_DEF[style][key].grossReturn * 100).toFixed(1)}% p.a. {m.currency}
                      </div>
                    </div>
                    <div className="rounded-lg px-2.5 py-2" style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <div style={{ color: 'rgba(255,255,255,0.25)' }}>Tax (NRI)</div>
                      <div className="font-mono font-semibold mt-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
                        {repatriate
                          ? `${(m.taxRepatriate * 100).toFixed(0)}%${key === 'india' ? ' CGT+DTAA' : key === 'usa' ? ' Exit Tax' : ' CGT'}`
                          : `${(m.taxLocal * 100).toFixed(0)}% local`}
                      </div>
                    </div>
                    {repatriate && key === 'india' && (
                      <div className="col-span-2 rounded-lg px-2.5 py-2" style={{ background: 'rgba(255,255,255,0.04)' }}>
                        <div style={{ color: 'rgba(255,255,255,0.25)' }}>FX drag INR→EUR</div>
                        <div className="font-mono font-semibold mt-0.5" style={{ color: '#f87171' }}>
                          −3%/yr · EUR/INR ₹{Math.round(FX.EUR_INR * Math.pow(1.03, years))} at exit
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Winner summary */}
          {principalEur > 0 && (
            <div className="rounded-xl px-4 py-3 flex items-center gap-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <span className="text-lg">{MARKET_DEF[winnerKey].flag}</span>
              <div className="text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>
                <span style={{ color: MARKET_DEF[winnerKey].accentColor, fontWeight: 600 }}>{MARKET_DEF[winnerKey].name}</span>
                {' '}wins on your parameters — {' '}
                <span style={{ color: 'rgba(255,255,255,0.7)' }}>
                  {fmtAmount(repatriate ? results[winnerKey].netEur : results[winnerKey].netLocal, repatriate ? 'EUR' : MARKET_DEF[winnerKey].currency)}
                </span>
                {' '}vs{' '}
                {(Object.entries(results) as [MarketKey, MarketResult][])
                  .filter(([k]) => k !== winnerKey)
                  .map(([k, r]) => fmtAmount(repatriate ? r.netEur : r.netLocal, repatriate ? 'EUR' : MARKET_DEF[k].currency))
                  .join(' / ')}
                {' over '}{years} yrs · {STYLE_DEF[style].label} style
              </div>
            </div>
          )}

          {/* Footnote */}
          <div className="mt-3 text-[9px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.18)' }}>
            {mode === 'sip' ? 'SIP: monthly contributions, monthly compounding. ' : 'Lump sum, annual compounding. '}
            Returns: {STYLE_DEF[style].india.benchmark} {(STYLE_DEF[style].india.grossReturn * 100).toFixed(1)}% INR · {STYLE_DEF[style].usa.benchmark} {(STYLE_DEF[style].usa.grossReturn * 100).toFixed(1)}% USD · {STYLE_DEF[style].europe.benchmark} {(STYLE_DEF[style].europe.grossReturn * 100).toFixed(1)}% EUR ·
            INR→EUR drag 3%/yr (forward est.) · USD/EUR flat · NRI tax: India 20% eff. (CGT+DTAA), USA 41% exit tax (UCITS), Europe 33% CGT ·
            FX: €1 = ₹{FX.EUR_INR} = ${FX.EUR_USD} · Not financial advice.
          </div>
        </div>
      </div>

      {/* ── RESEARCH BRIEF ───────────────────────────────────────────────── */}
      <div className="artha-card overflow-hidden">

        {/* Header */}
        <div className="px-6 py-5" style={{ borderBottom: '1px solid rgba(11,28,48,0.07)' }}>
          <div className="artha-label mb-1">Research Brief · April 2026</div>
          <h2 className="font-display font-bold text-xl mb-1" style={{ color: 'var(--artha-text)', letterSpacing: '-0.02em' }}>
            Can India Beat the US for an EUR-Based NRI?
          </h2>
          <p className="text-xs" style={{ color: 'var(--artha-text-muted)' }}>
            50% Midcap · 30% Smallcap · 20% Largecap · 7–10 year horizon · Base currency: EUR
          </p>
        </div>

        {/* Tabs */}
        <div className="flex overflow-x-auto" style={{ borderBottom: '1px solid rgba(11,28,48,0.07)' }}>
          {(Object.keys(TAB_LABELS) as TabKey[]).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className="px-5 py-3 text-[10px] tracking-widest uppercase whitespace-nowrap font-semibold transition-all border-b-2 shrink-0"
              style={{
                borderColor: activeTab === tab ? 'var(--artha-teal)' : 'transparent',
                color: activeTab === tab ? 'var(--artha-teal)' : 'var(--artha-text-faint)',
                background: 'transparent',
              }}>
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="px-6 py-6">

          {activeTab === 'thesis' && (
            <div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
                <BriefStatCard label="India Portfolio CAGR (INR, hist.)" value="~15%" sub="50% mid · 30% small · 20% large" accent />
                <BriefStatCard label="INR→EUR drag (15yr actual)" value="−3.9%/yr" sub="₹60 (2010) → ₹107 (2026)" />
                <BriefStatCard label="India in EUR terms (pre-tax est.)" value="~11%" sub="After 3% FX drag, gross" />
                <BriefStatCard label="S&P 500 forward (consensus)" value="3–6%" sub="Goldman, JPMorgan 10yr forecast" />
              </div>
              <h3 className="font-semibold text-base mb-2" style={{ color: 'var(--artha-text)' }}>The Core Thesis</h3>
              <p className="text-sm leading-relaxed mb-3" style={{ color: 'var(--artha-text-secondary)' }}>
                The conventional wisdom is that the S&P 500 is unbeatable for a EUR-based investor. The last decade — driven by a handful of mega-cap tech companies and a strengthening dollar — produced ~15–17% EUR CAGR. That was exceptional. Wall Street's own consensus says it will not repeat.
              </p>
              <p className="text-sm leading-relaxed mb-3" style={{ color: 'var(--artha-text-secondary)' }}>
                India's equity market — particularly midcap and smallcap — has delivered 13–17% INR CAGR over rolling 15-year periods. The INR has weakened ~3.9%/yr against EUR historically, stripping ~4 percentage points from every rupee return.
              </p>
              <Callout type="green">
                <strong style={{ color: 'var(--artha-teal)' }}>The single insight: </strong>
                Goldman forecasts 3–6.5% annualised S&P 500 returns over the next decade. India midcap at 14% INR with 2.5% FX drag gives 11.5% EUR gross — roughly double the US forward return, before accounting for the tax structure advantage of direct Indian equity over UCITS ETFs.
              </Callout>
              <h3 className="font-semibold text-base mb-3 mt-5" style={{ color: 'var(--artha-text)' }}>Scenario Matrix · Net EUR CAGR after NRI tax</h3>
              <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(11,28,48,0.08)' }}>
                <div className="grid grid-cols-4 gap-3 px-4 py-2.5" style={{ background: 'var(--artha-surface)', borderBottom: '1px solid rgba(11,28,48,0.07)' }}>
                  {['Scenario', 'India (net €)', 'S&P 500 (net €)', 'Winner'].map(h => (
                    <div key={h} className="text-[9px] tracking-widest uppercase font-semibold text-center first:text-left" style={{ color: 'var(--artha-text-faint)' }}>{h}</div>
                  ))}
                </div>
                <div className="px-4">
                  <ScenarioRow label="Bear case"         note="US 3% · INR dep. 4.5% · India 12% INR" india="+6.2%" us="+1.8%"  winner="india" />
                  <ScenarioRow label="Base case"         note="US 6% · INR dep. 3% · India 14% INR"   india="+8.5%" us="+3.5%"  winner="india" />
                  <ScenarioRow label="India bull"        note="US 6% · INR dep. 2% · India 16% INR"   india="+10.8%" us="+3.5%" winner="india" />
                  <ScenarioRow label="US bull"           note="US 12% · INR dep. 4% · India 14% INR"  india="+7.2%" us="+7.1%"  winner="draw"  />
                  <ScenarioRow label="US repeat 2010–24" note="US 15% USD · dollar +2%/yr"             india="+7.2%" us="+10.2%" winner="us"    />
                </div>
              </div>
              <p className="text-[10px] mt-2" style={{ color: 'var(--artha-text-faint)' }}>
                Net EUR: India direct equity — 33% CGT with DTAA (~20% effective). USA via UCITS ETF — 41% exit tax. 10-year horizon.
              </p>
            </div>
          )}

          {activeTab === 'us_problem' && (
            <div>
              <h3 className="font-semibold text-base mb-4" style={{ color: 'var(--artha-text)' }}>The US Valuation Problem</h3>
              <div className="grid grid-cols-3 gap-3 mb-5">
                <BriefStatCard label="Goldman 10yr S&P forecast" value="3–6.5%" sub="Annualised nominal USD" />
                <BriefStatCard label="JPMorgan 10yr forecast"    value="~6%"    sub="Citing valuation concerns" />
                <BriefStatCard label="Wall St. consensus (21 firms)" value="~6%" sub="Avg of major asset managers" />
              </div>
              <Callout type="red">
                Goldman's CAPE ratio for the S&P 500 sits at 38x — the 97th historical percentile. At comparable starting valuations, 10-year forward returns have ranged from 0–4% nominal. Goldman's model gives a 72% probability that US stocks underperform bonds over the next decade.
              </Callout>
              <h3 className="font-semibold text-base mt-5 mb-2" style={{ color: 'var(--artha-text)' }}>The ETF Tax Penalty for EUR-Based NRIs</h3>
              <p className="text-sm leading-relaxed mb-3" style={{ color: 'var(--artha-text-secondary)' }}>
                The most accessible route into the S&P 500 for EUR-based investors is a UCITS ETF. ETF gains attract <strong style={{ color: 'var(--artha-negative)' }}>41% exit tax</strong> — not the 33% CGT rate applied to direct equity — and deemed disposal applies every 8 years.
              </p>
              <Callout>
                <strong style={{ color: 'var(--artha-warning)' }}>The maths: </strong>
                A 6% USD S&P 500 return, neutral USD/EUR, after 41% exit tax delivers approximately <strong>3.5% net EUR CAGR</strong>. That's near or below EU inflation — a EUR-based investor in a US ETF over the next decade may be running to stand still in real terms.
              </Callout>
            </div>
          )}

          {activeTab === 'india_case' && (
            <div>
              <div className="grid grid-cols-3 gap-3 mb-5">
                <BriefStatCard label="Nifty Midcap 150 (15yr CAGR)" value="17.3%" sub="Apr 2005–Sep 2023, TRI" accent />
                <BriefStatCard label="Nifty Smallcap 250 (15yr)"    value="12.7%" sub="As of July 2025" />
                <BriefStatCard label="Blended (50/30/20)"           value="~15%"  sub="Conservative forward estimate" />
              </div>
              <h3 className="font-semibold text-base mb-3" style={{ color: 'var(--artha-text)' }}>Structural Drivers</h3>
              <div className="space-y-3">
                {[
                  ['GDP growth differential', "India grows at 6–7% real annually vs the US at 2.5%. India's nominal GDP growing ~10–11% annually creates an earnings tailwind that simply doesn't exist in developed markets."],
                  ['Financialisation of savings', 'Only ~5% of Indian households invest in equities vs 55%+ in the US. Domestic SIP inflows hit ₹26,000 Cr/month in 2025 — a structural bid independent of FII flows.'],
                  ['Manufacturing shift', 'PLI schemes are pulling electronics, semiconductors, pharma, and defence manufacturing into India. Midcap companies are the primary beneficiaries.'],
                  ['Demographics', "India's median age is 28 years. The largest working-age population on Earth through 2050 drives consumption-led compounding in financials, healthcare, and discretionary."],
                ].map(([t, b]) => (
                  <div key={t} className="rounded-xl px-4 py-3" style={{ background: 'var(--artha-surface)', border: '1px solid rgba(11,28,48,0.07)' }}>
                    <div className="text-sm font-semibold mb-0.5" style={{ color: 'var(--artha-text)' }}>{t}</div>
                    <p className="text-sm leading-relaxed m-0" style={{ color: 'var(--artha-text-secondary)' }}>{b}</p>
                  </div>
                ))}
              </div>
              <Callout type="red">
                <strong style={{ color: 'var(--artha-negative)' }}>Smallcap reality check: </strong>
                Smallcap 250 does NOT reliably outperform Midcap 150 on a risk-adjusted basis over rolling 10-year periods. The 30% smallcap allocation adds significant volatility without clearly adding return.
              </Callout>
            </div>
          )}

          {activeTab === 'currency' && (
            <div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
                <BriefStatCard label="EUR/INR (2010 avg)"       value="₹60.6"    sub="Historical starting point" />
                <BriefStatCard label="EUR/INR (today)"          value="₹107"     sub="April 2026" />
                <BriefStatCard label="INR depreciation vs EUR"  value="3.9%/yr"  sub="15-year actual" />
                <BriefStatCard label="Break-even drag"          value="<4%/yr"   sub="India wins at any lower rate" accent />
              </div>
              <h3 className="font-semibold text-base mb-2" style={{ color: 'var(--artha-text)' }}>Why Future Depreciation May Be Lower</h3>
              <p className="text-sm leading-relaxed mb-3" style={{ color: 'var(--artha-text-secondary)' }}>
                India's forex reserves crossed $700bn in 2024. The current account deficit has narrowed as IT/services exports boom. CPI inflation has moderated to 4–5%, narrowing the inflation differential vs EUR that historically drove FX depreciation. A 2–3% annual drag going forward is a realistic base case.
              </p>
              <Callout type="green">
                <strong style={{ color: 'var(--artha-teal)' }}>NRE account arbitrage: </strong>
                NRI-held NRE savings accounts earn 6.5–7.5% per annum in India, fully tax-free, and the principal + interest is freely repatriable. For liquid capital awaiting deployment, this alone outperforms EU deposit rates of 1–2% with zero equity risk.
              </Callout>
              <h3 className="font-semibold text-base mt-5 mb-3" style={{ color: 'var(--artha-text)' }}>Structural FX Solutions</h3>
              <div className="space-y-3">
                {[
                  ['Partial & staggered repatriation', 'Convert only EUR-denominated expenses as needed. NRIs with family in India have a natural INR spending requirement — this eliminates the FX cost on that portion entirely.'],
                  ['Cost-average the conversion', 'Converting in monthly tranches over 12–24 months at exit, rather than a lump sum, averages the EUR/INR rate and removes timing risk.'],
                  ['India-listed dollar earners', 'Allocating 20–30% to Indian IT exporters (TCS, Infosys, Persistent) provides natural USD revenue hedging within the INR portfolio.'],
                ].map(([t, b]) => (
                  <div key={t} className="rounded-xl px-4 py-3" style={{ background: 'var(--artha-surface)', border: '1px solid rgba(11,28,48,0.07)' }}>
                    <div className="text-sm font-semibold mb-0.5" style={{ color: 'var(--artha-text)' }}>{t}</div>
                    <p className="text-sm leading-relaxed m-0" style={{ color: 'var(--artha-text-secondary)' }}>{b}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'nri_edge' && (
            <div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
                {[
                  { title: 'NRI Structural Advantages', positive: true, items: [
                    ['Information edge',     'Language, family networks, sector knowledge that foreign funds lack'],
                    ['Direct market access', 'Invest via NRE/NRO + demat — no ETF wrapper, no TER drag'],
                    ['DTAA protection',      'India–EU treaty prevents double taxation; EU CGT (33%) gets Indian withholding credit'],
                    ['NRE account yield',    '6.5–7.5% tax-free on liquid holdings in India, fully repatriable'],
                    ['Natural INR spending', 'Family costs, property — this is free FX hedging worth 1–3%/yr'],
                    ['Repatriation control', 'Convert when EUR/INR is favourable rather than at a forced exit'],
                  ]},
                  { title: 'Foreign Investor Constraints', positive: false, items: [
                    ['ETF wrapper drag',  'UCITS India ETFs carry 0.4–0.7% TER annually vs 0% for direct'],
                    ['No midcap tilt',   'MSCI India is ~75% largecap — no access to the highest-return segment'],
                    ['Full FX drag',     'Same INR depreciation, but without natural INR spending to offset any of it'],
                    ['No DTAA benefit',  'Foreign retail investors cannot claim Indian withholding tax credits in the EU'],
                    ['No NRE account',   'Cannot access the 7% tax-free INR savings rate'],
                    ['Forced exit',      'Must convert all proceeds at market rate at exit — no timing flexibility'],
                  ]},
                ].map(col => (
                  <div key={col.title} className="rounded-xl p-4" style={{ background: 'var(--artha-surface)', border: '1px solid rgba(11,28,48,0.07)' }}>
                    <div className="artha-label mb-3">{col.title}</div>
                    <div className="space-y-3">
                      {col.items.map(([t, d]) => (
                        <div key={t} className="flex gap-2.5">
                          <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                            style={{ background: col.positive ? 'var(--artha-teal)' : 'var(--artha-negative)' }} />
                          <div>
                            <div className="text-xs font-semibold" style={{ color: 'var(--artha-text)' }}>{t}</div>
                            <div className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'var(--artha-text-muted)' }}>{d}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <Callout>
                <strong style={{ color: 'var(--artha-warning)' }}>Portfolio construction: </strong>
                50% India midcap growth + 20% largecap + 20% IT exporters (natural FX hedge) + 10% smallcap. Blended ~14% INR CAGR with built-in FX mitigation.
              </Callout>
            </div>
          )}

          {activeTab === 'verdict' && (
            <div>
              <div className="rounded-xl p-5 mb-5" style={{ background: 'var(--artha-warning-bg)', border: '1px solid rgba(180,83,9,0.15)' }}>
                <div className="artha-label mb-2">Bottom Line</div>
                <p className="text-sm leading-relaxed mb-2" style={{ color: 'var(--artha-text-secondary)' }}>
                  In the base case and bear case for US markets — Goldman Sachs, JPMorgan, and the average of 21 major asset managers — India beats the S&P 500 on a net EUR basis for an EUR-based NRI over 7–10 years. Not marginally. By{' '}
                  <strong style={{ color: 'var(--artha-text)' }}>3–5 percentage points of annual CAGR.</strong>
                </p>
                <p className="text-sm leading-relaxed m-0" style={{ color: 'var(--artha-text-secondary)' }}>
                  The only scenario where the US wins is a repeat of 2010–2024: 13–15% USD returns driven by mega-cap tech, continued dollar strengthening, and CAPE expanding from 17x to 38x. That is the bull case. The base case is 6%. The bear case is 3%.
                </p>
              </div>
              <div className="space-y-3">
                {[
                  ['Hold 10 years minimum', 'The currency drag averages out over longer horizons. At year 10 in the base case, the India corpus in EUR is approximately 2× the US corpus.'],
                  ["Structure the repatriation, don't exit everything", 'NRIs who keep INR-denominated compounding working while drawing down only what they need in EUR get the best of both — Indian equity growth plus controlled FX exposure.'],
                  ['Use IT exporters as an internal hedge', "A 20–25% allocation to India's dollar-earning IT sector (TCS, Infosys, Persistent) within the portfolio naturally cushions INR depreciation on exit."],
                ].map(([t, b]) => (
                  <div key={t} className="rounded-xl px-4 py-3.5" style={{ background: 'var(--artha-surface)', border: '1px solid rgba(11,28,48,0.07)' }}>
                    <div className="text-sm font-semibold mb-1" style={{ color: 'var(--artha-text)' }}>{t}</div>
                    <p className="text-sm leading-relaxed m-0" style={{ color: 'var(--artha-text-secondary)' }}>{b}</p>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between mt-5 pt-4" style={{ borderTop: '1px solid rgba(11,28,48,0.07)' }}>
                <div className="text-[10px]" style={{ color: 'var(--artha-text-faint)' }}>Noesis Research · April 2026 · Not financial advice</div>
                <div className="flex gap-2">
                  {['DTAA', 'NRI', 'EM'].map(tag => (
                    <span key={tag} className="px-2 py-0.5 rounded text-[9px] tracking-widest uppercase font-semibold"
                      style={{ background: 'var(--artha-teal-subtle)', color: 'var(--artha-teal)', border: '1px solid rgba(0,106,97,0.15)' }}>
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
