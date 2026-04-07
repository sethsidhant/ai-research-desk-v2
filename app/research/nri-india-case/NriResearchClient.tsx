'use client'

import { useState, useMemo } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

type CurrencyInput = 'EUR' | 'USD' | 'INR'
type MarketKey     = 'india' | 'usa' | 'europe'
type TabKey        = 'thesis' | 'us_problem' | 'india_case' | 'currency' | 'nri_edge' | 'verdict'

interface MarketResult {
  key:        MarketKey
  corpusLocal: number       // final corpus in local currency
  corpusEur:  number        // final corpus in EUR (repatriate path)
  netEur:     number        // after tax in EUR
  netLocal:   number        // after local tax, in local currency
  netCagrEur: number        // annualised EUR net CAGR (repatriate)
  netCagrLocal: number      // annualised local net CAGR
  gainEur:    number
  taxEur:     number
  multiplier: number        // corpus / principal (EUR terms, repatriate)
}

// ── Constants ─────────────────────────────────────────────────────────────────

const FX = { EUR_INR: 107, EUR_USD: 1.10 }

const MARKET_DEF = {
  india: {
    name: 'India', flag: '🇮🇳', currency: 'INR', symbol: '₹',
    grossReturn: 0.14, fxDragVsEur: 0.03,
    taxRepatriate: 0.20,  // Irish CGT 33% with DTAA credit → ~20% effective
    taxLocal: 0.125,      // India LTCG 12.5%
    subtitle: 'Nifty Mid/Largecap blend',
    accentColor: '#d97706',
    glowColor: 'rgba(217, 119, 6, 0.25)',
    bgColor: 'rgba(217, 119, 6, 0.06)',
  },
  usa: {
    name: 'USA', flag: '🇺🇸', currency: 'USD', symbol: '$',
    grossReturn: 0.06, fxDragVsEur: 0.00,
    taxRepatriate: 0.41,  // Irish Exit Tax on UCITS ETF
    taxLocal: 0.15,       // US LTCG for NRI
    subtitle: 'S&P 500 via UCITS ETF',
    accentColor: '#3b82f6',
    glowColor: 'rgba(59, 130, 246, 0.25)',
    bgColor: 'rgba(59, 130, 246, 0.06)',
  },
  europe: {
    name: 'Europe', flag: '🇪🇺', currency: 'EUR', symbol: '€',
    grossReturn: 0.05, fxDragVsEur: 0.00,
    taxRepatriate: 0.33,  // Irish CGT on direct stocks
    taxLocal: 0.33,
    subtitle: 'Euro Stoxx 50 direct',
    accentColor: '#8b5cf6',
    glowColor: 'rgba(139, 92, 246, 0.25)',
    bgColor: 'rgba(139, 92, 246, 0.06)',
  },
}

const TAB_LABELS: Record<TabKey, string> = {
  thesis:     'Overview',
  us_problem: 'US Problem',
  india_case: "India's Case",
  currency:   'Currency',
  nri_edge:   'NRI Edge',
  verdict:    'Verdict',
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

function fmtPct(n: number): string {
  const sign = n >= 0 ? '+' : ''
  return `${sign}${(n * 100).toFixed(1)}%`
}

// ── Compute ───────────────────────────────────────────────────────────────────

function computeResults(
  principalEur: number,
  years: number,
): Record<MarketKey, MarketResult> {
  const results = {} as Record<MarketKey, MarketResult>

  for (const key of ['india', 'usa', 'europe'] as MarketKey[]) {
    const m = MARKET_DEF[key]

    // Principal in local currency
    const principalLocal =
      m.currency === 'INR' ? principalEur * FX.EUR_INR :
      m.currency === 'USD' ? principalEur * FX.EUR_USD :
      principalEur

    // Gross corpus in local currency
    const corpusLocal = principalLocal * Math.pow(1 + m.grossReturn, years)

    // ── Repatriate path (EUR out) ──────────────────────────────────────
    let corpusEur: number
    if (m.currency === 'INR') {
      const futureEurInr = FX.EUR_INR * Math.pow(1 + m.fxDragVsEur, years)
      corpusEur = corpusLocal / futureEurInr
    } else if (m.currency === 'USD') {
      corpusEur = corpusLocal / FX.EUR_USD
    } else {
      corpusEur = corpusLocal
    }

    const gainEur  = Math.max(0, corpusEur - principalEur)
    const taxEur   = gainEur * m.taxRepatriate
    const netEur   = corpusEur - taxEur
    const netCagrEur = Math.pow(netEur / principalEur, 1 / years) - 1

    // ── Local path (keep in market currency) ──────────────────────────
    const gainLocal  = Math.max(0, corpusLocal - principalLocal)
    const taxLocal   = gainLocal * m.taxLocal
    const netLocal   = corpusLocal - taxLocal
    const netCagrLocal = Math.pow(netLocal / principalLocal, 1 / years) - 1

    results[key] = {
      key, corpusLocal, corpusEur, netEur, netLocal,
      netCagrEur, netCagrLocal, gainEur, taxEur,
      multiplier: netEur / principalEur,
    }
  }

  return results
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Callout({ children, type = 'gold' }: { children: React.ReactNode; type?: 'gold' | 'green' | 'red' }) {
  const border = type === 'green' ? '#6ee7a0' : type === 'red' ? '#f87171' : '#c9a84c'
  return (
    <div className="rounded-r-lg px-4 py-3 my-4" style={{ borderLeft: `2px solid ${border}`, background: `${border}0d` }}>
      <div className="text-sm leading-relaxed" style={{ color: '#a0998e' }}>{children}</div>
    </div>
  )
}

function StatCard({ label, value, sub, accent = false }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-xl p-4" style={{
      background: accent ? 'rgba(201,168,76,0.06)' : 'rgba(255,255,255,0.03)',
      border: `1px solid ${accent ? 'rgba(201,168,76,0.2)' : 'rgba(255,255,255,0.06)'}`,
    }}>
      <div className="text-[9px] tracking-[0.18em] uppercase mb-1.5" style={{ color: '#555' }}>{label}</div>
      <div className="text-xl font-semibold font-mono" style={{ color: accent ? '#c9a84c' : '#e8e0d0' }}>{value}</div>
      {sub && <div className="text-[10px] mt-1" style={{ color: '#444' }}>{sub}</div>}
    </div>
  )
}

function ScenarioRow({ label, note, india, us, winner }: {
  label: string; note: string; india: string; us: string; winner: 'india' | 'us' | 'draw'
}) {
  return (
    <div className="grid grid-cols-4 gap-3 py-3 border-b items-center last:border-0" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
      <div>
        <div className="text-xs" style={{ color: '#777' }}>{label}</div>
        <div className="text-[9px] mt-0.5" style={{ color: '#444' }}>{note}</div>
      </div>
      <div className="text-sm font-mono font-medium text-center" style={{ color: winner === 'india' ? '#6ee7a0' : '#666' }}>
        {india}{winner === 'india' && <span className="ml-1 text-[9px]">✓</span>}
      </div>
      <div className="text-sm font-mono font-medium text-center" style={{ color: winner === 'us' ? '#6ee7a0' : '#666' }}>
        {us}{winner === 'us' && <span className="ml-1 text-[9px]">✓</span>}
      </div>
      <div className="text-[10px] text-center font-medium" style={{
        color: winner === 'india' ? '#6ee7a0' : winner === 'us' ? '#f87171' : '#888'
      }}>
        {winner === 'india' ? 'India wins' : winner === 'us' ? 'US wins' : 'Draw'}
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function NriResearchClient() {
  // Calculator state
  const [amount, setAmount]           = useState('10000')
  const [inputCurrency, setInputCurrency] = useState<CurrencyInput>('EUR')
  const [years, setYears]             = useState(10)
  const [repatriate, setRepatriate]   = useState(true)

  // Brief state
  const [activeTab, setActiveTab]     = useState<TabKey>('thesis')

  // Derived principal in EUR
  const principalEur = useMemo(() => {
    const n = parseFloat(amount.replace(/,/g, '')) || 0
    if (inputCurrency === 'USD') return n / FX.EUR_USD
    if (inputCurrency === 'INR') return n / FX.EUR_INR
    return n
  }, [amount, inputCurrency])

  const results = useMemo(() => computeResults(principalEur, years), [principalEur, years])

  // Find winner
  const winnerKey = useMemo(() => {
    const vals = Object.entries(results) as [MarketKey, MarketResult][]
    return vals.reduce((best, [k, r]) => {
      const metric = repatriate ? r.netEur : r.netLocal
      const bestMetric = repatriate ? results[best].netEur : results[best].netLocal
      return metric > bestMetric ? k : best
    }, 'india' as MarketKey)
  }, [results, repatriate])

  // Max corpus for bar scaling
  const maxCorpus = useMemo(() => {
    return Math.max(...Object.values(results).map(r => repatriate ? r.netEur : r.netLocal))
  }, [results, repatriate])

  const handleAmountChange = (val: string) => {
    const cleaned = val.replace(/[^0-9.,]/g, '')
    setAmount(cleaned)
  }

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
          India vs USA vs Europe · EUR-based NRI (Ireland) · April 2026 · Not financial advice
        </p>
      </div>

      {/* ── CALCULATOR ───────────────────────────────────────────────────── */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, #0d1f35 0%, #0b1a2e 100%)', boxShadow: '0 24px 64px rgba(0,0,0,0.3)' }}>

        {/* Calculator header */}
        <div className="px-6 pt-6 pb-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="text-[10px] tracking-[0.2em] uppercase font-semibold mb-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
            Interactive Calculator
          </div>
          <div className="text-lg font-semibold" style={{ color: 'rgba(255,255,255,0.9)', letterSpacing: '-0.02em' }}>
            Run your own numbers
          </div>
        </div>

        {/* Inputs */}
        <div className="px-6 py-5 grid grid-cols-1 md:grid-cols-3 gap-6" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>

          {/* Amount + currency */}
          <div>
            <label className="block text-[10px] tracking-[0.15em] uppercase font-semibold mb-2.5" style={{ color: 'rgba(255,255,255,0.35)' }}>
              Investment Amount
            </label>
            <div className="flex items-center rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="pl-4 pr-2 text-sm font-mono" style={{ color: 'rgba(255,255,255,0.4)' }}>{currencySymbol}</div>
              <input
                type="text"
                value={amount}
                onChange={e => handleAmountChange(e.target.value)}
                className="flex-1 py-3 pr-3 text-base font-mono font-semibold bg-transparent outline-none"
                style={{ color: 'rgba(255,255,255,0.9)' }}
                placeholder="10,000"
              />
            </div>
            {/* Currency toggles */}
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
              <div className="mt-1.5 text-[10px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
                ≈ €{Math.round(principalEur).toLocaleString()} at current rates
              </div>
            )}
          </div>

          {/* Time horizon */}
          <div>
            <label className="block text-[10px] tracking-[0.15em] uppercase font-semibold mb-2.5" style={{ color: 'rgba(255,255,255,0.35)' }}>
              Investment Horizon
            </label>
            <div className="flex items-center gap-3 mb-3">
              <span className="text-3xl font-display font-bold" style={{ color: '#4dd9cc', letterSpacing: '-0.03em' }}>{years}</span>
              <span className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>years</span>
            </div>
            <input
              type="range" min={3} max={25} step={1} value={years}
              onChange={e => setYears(Number(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
              style={{ accentColor: '#4dd9cc', background: `linear-gradient(to right, #4dd9cc ${((years - 3) / 22) * 100}%, rgba(255,255,255,0.1) 0%)` }}
            />
            <div className="flex justify-between mt-1.5 text-[9px]" style={{ color: 'rgba(255,255,255,0.2)' }}>
              <span>3 yr</span><span>10 yr</span><span>25 yr</span>
            </div>
          </div>

          {/* Repatriate toggle */}
          <div>
            <label className="block text-[10px] tracking-[0.15em] uppercase font-semibold mb-2.5" style={{ color: 'rgba(255,255,255,0.35)' }}>
              Bring money back to Europe?
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { val: true,  label: 'Yes — convert to €',  sub: 'Shows EUR net of Irish tax' },
                { val: false, label: 'No — keep locally',   sub: 'Shows local currency returns' },
              ].map(opt => (
                <button key={String(opt.val)} onClick={() => setRepatriate(opt.val)}
                  className="rounded-xl px-3 py-3 text-left transition-all"
                  style={{
                    background: repatriate === opt.val ? 'rgba(0,196,180,0.12)' : 'rgba(255,255,255,0.04)',
                    border: `1.5px solid ${repatriate === opt.val ? 'rgba(0,196,180,0.4)' : 'rgba(255,255,255,0.06)'}`,
                  }}>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0" style={{
                      borderColor: repatriate === opt.val ? '#4dd9cc' : 'rgba(255,255,255,0.2)',
                    }}>
                      {repatriate === opt.val && <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#4dd9cc' }} />}
                    </div>
                    <span className="text-xs font-semibold" style={{ color: repatriate === opt.val ? '#4dd9cc' : 'rgba(255,255,255,0.5)' }}>
                      {opt.label}
                    </span>
                  </div>
                  <div className="text-[9px] pl-5" style={{ color: 'rgba(255,255,255,0.2)' }}>{opt.sub}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="px-6 py-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(['india', 'usa', 'europe'] as MarketKey[]).map(key => {
              const m   = MARKET_DEF[key]
              const r   = results[key]
              const isWinner  = key === winnerKey
              const metric    = repatriate ? r.netEur : r.netLocal
              const cagr      = repatriate ? r.netCagrEur : r.netCagrLocal
              const barPct    = maxCorpus > 0 ? (metric / maxCorpus) * 100 : 0
              const displayAmt = repatriate
                ? fmtAmount(r.netEur, 'EUR')
                : fmtAmount(r.netLocal, m.currency)

              return (
                <div key={key} className="rounded-2xl p-5 relative transition-all"
                  style={{
                    background: isWinner ? m.bgColor : 'rgba(255,255,255,0.03)',
                    border: `1.5px solid ${isWinner ? m.accentColor + '50' : 'rgba(255,255,255,0.06)'}`,
                    boxShadow: isWinner ? `0 8px 32px ${m.glowColor}` : 'none',
                  }}>

                  {/* Winner badge */}
                  {isWinner && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-[9px] font-bold tracking-widest uppercase"
                      style={{ background: m.accentColor, color: '#fff', boxShadow: `0 2px 8px ${m.glowColor}` }}>
                      Best Pick
                    </div>
                  )}

                  {/* Header */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{m.flag}</span>
                      <div>
                        <div className="text-sm font-bold" style={{ color: isWinner ? m.accentColor : 'rgba(255,255,255,0.7)' }}>{m.name}</div>
                        <div className="text-[9px]" style={{ color: 'rgba(255,255,255,0.25)' }}>{m.subtitle}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-bold font-mono" style={{ color: m.accentColor }}>
                        {fmtPct(cagr)}/yr
                      </div>
                      <div className="text-[9px]" style={{ color: 'rgba(255,255,255,0.25)' }}>net CAGR</div>
                    </div>
                  </div>

                  {/* Main corpus number */}
                  <div className="mb-1">
                    <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.25)' }}>
                      {repatriate ? 'Final corpus (€ net)' : `Final corpus (${m.currency} net)`}
                    </div>
                    <div className="font-display font-bold" style={{ fontSize: '1.75rem', letterSpacing: '-0.03em', color: isWinner ? m.accentColor : 'rgba(255,255,255,0.8)', lineHeight: 1.1 }}>
                      {displayAmt}
                    </div>
                  </div>

                  {/* Multiplier */}
                  <div className="text-xs mb-4" style={{ color: 'rgba(255,255,255,0.3)' }}>
                    {(repatriate ? r.netEur : r.netLocal) > 0 && principalEur > 0
                      ? `${(metric / (repatriate ? principalEur : (key === 'india' ? principalEur * FX.EUR_INR : key === 'usa' ? principalEur * FX.EUR_USD : principalEur))).toFixed(1)}× your money over ${years} years`
                      : '—'}
                  </div>

                  {/* Progress bar */}
                  <div className="mb-4">
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      <div className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${barPct}%`, background: isWinner ? m.accentColor : 'rgba(255,255,255,0.15)' }} />
                    </div>
                  </div>

                  {/* Stats row */}
                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    <div className="rounded-lg px-2.5 py-2" style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <div style={{ color: 'rgba(255,255,255,0.25)' }}>Gross return</div>
                      <div className="font-mono font-semibold mt-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
                        {(m.grossReturn * 100).toFixed(0)}% p.a. ({m.currency})
                      </div>
                    </div>
                    <div className="rounded-lg px-2.5 py-2" style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <div style={{ color: 'rgba(255,255,255,0.25)' }}>Tax applied</div>
                      <div className="font-mono font-semibold mt-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
                        {repatriate
                          ? `${(m.taxRepatriate * 100).toFixed(0)}% Irish${key === 'india' ? ' (+DTAA)' : key === 'usa' ? ' Exit Tax' : ' CGT'}`
                          : `${(m.taxLocal * 100).toFixed(0)}% local`}
                      </div>
                    </div>
                    {repatriate && key === 'india' && (
                      <div className="col-span-2 rounded-lg px-2.5 py-2" style={{ background: 'rgba(255,255,255,0.04)' }}>
                        <div style={{ color: 'rgba(255,255,255,0.25)' }}>FX drag (INR→EUR)</div>
                        <div className="font-mono font-semibold mt-0.5" style={{ color: '#f87171' }}>
                          −{(m.fxDragVsEur * 100).toFixed(0)}%/yr assumed · EUR/INR: ₹{Math.round(FX.EUR_INR * Math.pow(1 + m.fxDragVsEur, years))} at exit
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Winner callout */}
          {principalEur > 0 && (
            <div className="mt-4 rounded-xl px-4 py-3 flex items-center gap-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <span className="text-lg">{MARKET_DEF[winnerKey].flag}</span>
              <div className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
                <span style={{ color: MARKET_DEF[winnerKey].accentColor, fontWeight: 600 }}>{MARKET_DEF[winnerKey].name}</span>
                {' '}wins your scenario —{' '}
                <span style={{ color: 'rgba(255,255,255,0.7)' }}>
                  {fmtAmount(
                    repatriate ? results[winnerKey].netEur : results[winnerKey].netLocal,
                    repatriate ? 'EUR' : MARKET_DEF[winnerKey].currency
                  )}
                </span>
                {' '}vs{' '}
                {repatriate
                  ? Object.entries(results)
                      .filter(([k]) => k !== winnerKey)
                      .map(([, r]) => fmtAmount(r.netEur, 'EUR'))
                      .join(' / ')
                  : Object.entries(results)
                      .filter(([k]) => k !== winnerKey)
                      .map(([k, r]) => fmtAmount(r.netLocal, MARKET_DEF[k as MarketKey].currency))
                      .join(' / ')
                }
                {' over '}{years} years
              </div>
            </div>
          )}

          {/* Assumptions footnote */}
          <div className="mt-3 text-[9px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.2)' }}>
            Assumptions: India 14% INR CAGR (50% mid / 30% small / 20% large blend) · USA 6% USD (S&P 500, Goldman/JPMorgan consensus) · Europe 5% EUR (Euro Stoxx 50) ·
            INR→EUR drag 3%/yr (forward estimate, 15yr actual was 3.9%) · USD/EUR flat · Irish tax: India 20% effective (33% CGT – DTAA credit), USA 41% exit tax (UCITS ETF), Europe 33% CGT ·
            Exchange rates: €1 = ₹{FX.EUR_INR} = ${FX.EUR_USD} · Not financial advice.
          </div>
        </div>
      </div>

      {/* ── RESEARCH BRIEF ───────────────────────────────────────────────── */}
      <div className="artha-card overflow-hidden">
        {/* Brief header */}
        <div className="px-6 py-4" style={{ borderBottom: '1px solid rgba(11,28,48,0.06)' }}>
          <div className="text-[10px] tracking-[0.15em] uppercase font-semibold mb-0.5" style={{ color: 'var(--artha-text-faint)' }}>
            Research Brief · April 2026
          </div>
          <h2 className="font-display font-bold text-lg" style={{ color: 'var(--artha-text)', letterSpacing: '-0.02em' }}>
            Can India Beat the US for a EUR-Based NRI Investor?
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--artha-text-muted)' }}>
            Portfolio: 50% Midcap · 30% Smallcap · 20% Largecap · Horizon: 7–10 years · Base: EUR (Ireland)
          </p>
        </div>

        {/* Tab nav */}
        <div className="px-6 flex gap-0 overflow-x-auto" style={{ borderBottom: '1px solid rgba(11,28,48,0.06)' }}>
          {(Object.keys(TAB_LABELS) as TabKey[]).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className="px-4 py-3 text-[10px] tracking-widest uppercase whitespace-nowrap font-semibold transition-all border-b-2"
              style={{
                borderColor: activeTab === tab ? 'var(--artha-teal)' : 'transparent',
                color: activeTab === tab ? 'var(--artha-teal)' : 'var(--artha-text-faint)',
              }}>
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>

        {/* Tab content — dark background for brief content */}
        <div className="px-6 py-6" style={{ background: '#0a1420', color: '#d4cfc5' }}>

          {activeTab === 'thesis' && (
            <div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
                <StatCard label="India Portfolio CAGR (INR, hist.)" value="~15%" sub="50% mid · 30% small · 20% large" accent />
                <StatCard label="INR→EUR Drag (15yr actual)" value="−3.9%/yr" sub="₹60 (2010) → ₹107 (2026)" />
                <StatCard label="India net EUR (pre-tax est.)" value="~11%" sub="After 3% FX drag, gross" />
                <StatCard label="S&P 500 forward (consensus)" value="3–6%" sub="Goldman, JPMorgan 10yr forecast" />
              </div>
              <h3 className="text-lg font-semibold mb-2 mt-6" style={{ color: '#e8e0d0' }}>The Core Thesis</h3>
              <p className="text-sm leading-relaxed mb-3" style={{ color: '#a0998e' }}>
                The conventional wisdom is that the S&P 500 is unbeatable for a EUR-based investor. The last decade of US returns —
                driven almost entirely by a handful of mega-cap technology companies and a strengthening dollar — produced ~15–17% EUR CAGR.
                That was exceptional. Wall Street's own consensus says it will not repeat.
              </p>
              <p className="text-sm leading-relaxed mb-3" style={{ color: '#a0998e' }}>
                Meanwhile, India's equity market — particularly the midcap and smallcap segments — has delivered 13–17% INR CAGR
                over rolling 15-year periods. The INR has weakened ~3.9% per year against EUR historically, stripping out roughly
                4 percentage points from every rupee return.
              </p>
              <Callout type="green">
                <strong style={{ color: '#6ee7a0' }}>The single insight: </strong>
                Goldman Sachs forecasts 3–6.5% annualised S&P 500 returns over the next decade.
                India midcap at 14% INR with 2.5% FX drag gives 11.5% EUR gross — roughly double the US, before accounting for tax structure advantages.
              </Callout>
              <h3 className="text-lg font-semibold mb-3 mt-6" style={{ color: '#e8e0d0' }}>Scenario Matrix · Net EUR CAGR after Irish tax</h3>
              <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="grid grid-cols-4 gap-3 px-4 py-2" style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  {['Scenario', 'India (net €)', 'S&P 500 (net €)', 'Winner'].map(h => (
                    <div key={h} className="text-[9px] tracking-widest uppercase text-center first:text-left" style={{ color: '#444' }}>{h}</div>
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
              <p className="text-[10px] mt-2" style={{ color: '#333' }}>
                Net EUR figures: Indian direct stocks at 33% Irish CGT with DTAA credit (~20% effective). US via UCITS ETF at 41% Irish Exit Tax. 10-year horizon.
              </p>
            </div>
          )}

          {activeTab === 'us_problem' && (
            <div>
              <h3 className="text-lg font-semibold mb-3" style={{ color: '#e8e0d0' }}>The US Valuation Problem is Real</h3>
              <div className="grid grid-cols-3 gap-3 my-5">
                <StatCard label="Goldman 10yr S&P forecast" value="3–6.5%" sub="Annualised nominal USD" />
                <StatCard label="JPMorgan 10yr forecast"    value="~6%"    sub="Citing valuation + inflation" />
                <StatCard label="Wall St. consensus (21 firms)" value="~6%" sub="Double Goldman's estimate" />
              </div>
              <Callout type="red">
                Goldman's CAPE ratio for the S&P 500 sits at 38x — the 97th historical percentile. At prior times the market
                started a decade at similar valuations, 10-year forward returns ranged from 0% to 4% nominal.
                A 72% probability exists that US stocks underperform bonds over the next decade, per Goldman's model.
              </Callout>
              <h3 className="text-lg font-semibold mt-6 mb-2" style={{ color: '#e8e0d0' }}>The Irish Tax Penalty on US ETFs</h3>
              <p className="text-sm leading-relaxed" style={{ color: '#a0998e' }}>
                The most efficient route for Irish investors into the S&P 500 is a UCITS ETF (e.g. iShares Core S&P 500 UCITS).
                In Ireland, ETF gains are subject to <strong style={{ color: '#f87171' }}>41% Exit Tax</strong> — not the 33% CGT rate — and deemed disposal applies every 8 years.
              </p>
              <Callout>
                <strong style={{ color: '#c9a84c' }}>The maths: </strong>
                A 6% USD S&P 500 return with neutral USD/EUR, after 41% Irish exit tax,
                delivers approximately 3.5% net EUR CAGR. That's below Irish inflation. An Irish investor in a US ETF over the next decade
                may be running to stand still in real terms.
              </Callout>
            </div>
          )}

          {activeTab === 'india_case' && (
            <div>
              <div className="grid grid-cols-3 gap-3 my-5">
                <StatCard label="Nifty Midcap 150 (15yr CAGR)" value="17.3%" sub="Apr 2005 – Sep 2023, TRI" accent />
                <StatCard label="Nifty Smallcap 250 (15yr)"    value="12.7%" sub="As of July 2025" />
                <StatCard label="Blended (50/30/20)"           value="~15%"  sub="Conservative forward estimate" />
              </div>
              <h3 className="text-lg font-semibold mt-6 mb-2" style={{ color: '#e8e0d0' }}>Structural Drivers</h3>
              {[
                ['GDP growth differential', 'India grows at 6–7% real annually vs the US at 2.5%. India\'s nominal GDP growing ~10–11% annually creates a fundamental earnings tailwind that simply doesn\'t exist in developed markets.'],
                ['Financialisation of savings', 'Only ~5% of Indian households invest in equities vs 55%+ in the US. Domestic SIP inflows hit ₹26,000 Cr/month in 2025, providing a structural bid independent of foreign flows.'],
                ['Manufacturing shift from China', 'PLI schemes are pulling electronics, semiconductors, pharma, and defence manufacturing into India. Midcap companies are the primary beneficiaries.'],
                ['Demographics', 'India\'s median age is 28 years. The largest working-age population on Earth through 2050 drives consumption-led compounding.'],
              ].map(([title, body]) => (
                <div key={title} className="mb-4">
                  <div className="text-sm font-semibold mb-1" style={{ color: '#e8e0d0' }}>{title}</div>
                  <p className="text-sm leading-relaxed" style={{ color: '#a0998e' }}>{body}</p>
                </div>
              ))}
              <Callout type="red">
                <strong style={{ color: '#f87171' }}>Smallcap reality check: </strong>
                Smallcap 250 does NOT reliably outperform Midcap 150 on a risk-adjusted basis over rolling 10-year periods.
                The 30% smallcap allocation adds volatility without clearly adding return.
              </Callout>
            </div>
          )}

          {activeTab === 'currency' && (
            <div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 my-5">
                <StatCard label="EUR/INR (2010 avg)"    value="₹60.6"    sub="Historical starting point" />
                <StatCard label="EUR/INR (today)"       value="₹107"     sub="April 2026" />
                <StatCard label="INR depreciation/yr"   value="3.9%/yr"  sub="15-year actual vs EUR" />
                <StatCard label="Required for India to win" value="<4%/yr" sub="India wins at virtually any lower rate" accent />
              </div>
              <h3 className="text-lg font-semibold mt-6 mb-2" style={{ color: '#e8e0d0' }}>Why Future Depreciation May Be Lower</h3>
              <p className="text-sm leading-relaxed mb-4" style={{ color: '#a0998e' }}>
                India's forex reserves crossed $700bn in 2024. CAD has narrowed as services exports boom. CPI inflation has moderated to 4–5%,
                narrowing the inflation differential with EUR that historically drove FX depreciation.
                A 2–3% annual depreciation scenario is realistic going forward, versus the 3.9% historical average.
              </p>
              <Callout type="green">
                <strong style={{ color: '#6ee7a0' }}>NRE account arbitrage: </strong>
                NRI-held NRE savings accounts earn 6.5–7.5% per annum in India, fully tax-free, and the principal + interest is
                freely repatriable to Ireland. For liquid capital, this alone beats Irish deposit rates of 1–2% with zero equity risk.
              </Callout>
              <h3 className="text-lg font-semibold mt-6 mb-2" style={{ color: '#e8e0d0' }}>Structural FX Solutions</h3>
              {[
                ['Partial & staggered repatriation', 'Convert only EUR-denominated expenses needed. NRIs with family in India have a natural INR spending requirement — this eliminates the FX cost on that portion entirely.'],
                ['Cost averaging on conversion', 'Converting in monthly tranches over 12–24 months at exit, rather than a lump sum, averages the EUR/INR rate and removes timing risk.'],
                ['India-listed dollar earners', 'Allocating 20–30% to Indian IT exporters provides natural dollar revenue hedging within the INR-denominated portfolio.'],
              ].map(([title, body]) => (
                <div key={title} className="mb-3">
                  <div className="text-sm font-semibold mb-0.5" style={{ color: '#e8e0d0' }}>{title}</div>
                  <p className="text-sm leading-relaxed" style={{ color: '#a0998e' }}>{body}</p>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'nri_edge' && (
            <div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-5">
                {[
                  { title: 'NRI Structural Advantages', color: '#c9a84c', items: [
                    ['Information edge',      'Language, family networks, sector knowledge that foreign funds lack'],
                    ['Direct market access',  'Invest directly via NRE/NRO + demat, no ETF wrapper needed'],
                    ['DTAA protection',       'India–Ireland treaty prevents double taxation; Irish CGT (33%) gets Indian tax credit'],
                    ['NRE account yield',     '6.5–7.5% tax-free in India on liquid holdings, fully repatriable'],
                    ['Natural INR spending',  'Family costs, property — this is free FX hedging worth 1–3%/yr'],
                    ['Repatriation timing',   'Can convert when EUR/INR is favourable rather than forced exit'],
                  ]},
                  { title: 'Foreign Investor Disadvantages', color: '#f87171', items: [
                    ['ETF wrapper drag',      'UCITS India ETFs carry 0.4–0.7% TER annually vs 0% for direct'],
                    ['No midcap tilt',        'MSCI India is ~75% largecap; no access to the highest-return segment'],
                    ['Same FX drag',          'Full INR drag, but without natural INR spending to offset any of it'],
                    ['No DTAA benefit',       'Foreign retail investors can\'t claim Indian withholding tax credits in EU'],
                    ['No NRE account',        'Cannot access 7% tax-free INR savings rate'],
                    ['Forced conversion',     'Must convert all proceeds at market rate at exit'],
                  ]},
                ].map(col => (
                  <div key={col.title} className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div className="text-[9px] tracking-[0.18em] uppercase mb-3 font-semibold" style={{ color: '#555' }}>{col.title}</div>
                    {col.items.map(([t, d]) => (
                      <div key={t} className="flex gap-2.5 mb-3 last:mb-0">
                        <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: col.color }} />
                        <div>
                          <div className="text-xs font-medium" style={{ color: '#999' }}>{t}</div>
                          <div className="text-[10px] mt-0.5 leading-relaxed" style={{ color: '#444' }}>{d}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <Callout>
                <strong style={{ color: '#c9a84c' }}>Portfolio suggestion: </strong>
                50% India midcap growth + 20% largecap + 20% IT exporters (natural FX hedge) + 10% smallcap.
                Blended ~14% INR CAGR with built-in FX mitigation.
              </Callout>
            </div>
          )}

          {activeTab === 'verdict' && (
            <div>
              <div className="rounded-xl p-5 mb-6" style={{ background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.15)' }}>
                <div className="text-[9px] tracking-[0.2em] uppercase mb-2 font-semibold" style={{ color: '#c9a84c' }}>Bottom Line</div>
                <p className="text-sm leading-relaxed mb-2" style={{ color: '#bbb' }}>
                  In the base case and bear case for US markets — which represent the consensus view of Goldman Sachs,
                  JPMorgan, and the average of 21 major asset managers — India beats the S&P 500 on a net EUR basis
                  for an Irish NRI investor over 7–10 years. Not marginally. By <strong style={{ color: '#e8e0d0' }}>3–5 percentage points of annual CAGR.</strong>
                </p>
                <p className="text-sm leading-relaxed" style={{ color: '#bbb' }}>
                  The only scenario where the US wins is a repeat of 2010–2024: 13–15% USD returns driven by mega-cap tech,
                  continued dollar strengthening, and CAPE expanding from 17x to 38x. That is the bull case for the US. The base case is 6%.
                </p>
              </div>
              <div className="space-y-3">
                {[
                  ['Hold 10 years minimum', 'The currency drag averages out over longer horizons. At year 10, the gap between India and US scenarios in net EUR is approximately 2× the invested capital in the base case.'],
                  ['Structure the repatriation, don\'t exit everything', 'NRIs who keep INR-denominated compounding working while drawing down only what they need in EUR get the best of both — Indian equity growth plus controlled FX exposure.'],
                  ['Use IT exporters as an internal hedge', 'A 20–25% allocation to India\'s dollar-earning IT sector within the portfolio naturally cushions INR depreciation on exit, turning a structural weakness into a portfolio feature.'],
                ].map(([title, body]) => (
                  <div key={title} className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div className="text-sm font-semibold mb-1" style={{ color: '#e8e0d0' }}>{title}</div>
                    <p className="text-sm leading-relaxed m-0" style={{ color: '#888' }}>{body}</p>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between mt-6 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="text-[9px]" style={{ color: '#2a2a2a' }}>Noesis Research · India Equity · April 2026 · Not financial advice</div>
                <div className="flex gap-2">
                  {['DTAA', 'NRI', 'Emerging Markets'].map(tag => (
                    <span key={tag} className="px-2 py-0.5 rounded text-[9px] tracking-widest uppercase" style={{ background: 'rgba(201,168,76,0.1)', color: '#c9a84c', border: '1px solid rgba(201,168,76,0.2)' }}>{tag}</span>
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
