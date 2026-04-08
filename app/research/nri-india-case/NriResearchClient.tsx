'use client'

import { useState, useMemo, useEffect } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

type CurrencyInput   = 'EUR' | 'INR'
type MarketKey       = 'india' | 'usa' | 'europe'
type TabKey          = 'thesis' | 'us_problem' | 'india_case' | 'currency' | 'nri_edge' | 'verdict'
type InvestmentMode  = 'lump_sum' | 'sip'
type InvestmentStyle = 'conservative' | 'balanced' | 'growth' | 'aggressive'
type EuCountry       = 'ireland' | 'germany' | 'france' | 'italy' | 'spain' | 'netherlands' | 'portugal' | 'austria' | 'belgium' | 'denmark' | 'sweden' | 'finland' | 'luxembourg'

// CGT rates on equity capital gains. India LTCG = 12.5%; DTAA credit reduces home-country top-up.
// Effective India rate = max(homeCGT − 0.125, 0.125). USA/Europe = homeCGT (no treaty credit).
const EU_TAX: Record<EuCountry, { label: string; flag: string; cgt: number }> = {
  ireland:     { label: 'Ireland',     flag: '🇮🇪', cgt: 0.330 },
  germany:     { label: 'Germany',     flag: '🇩🇪', cgt: 0.264 },
  france:      { label: 'France',      flag: '🇫🇷', cgt: 0.300 },
  italy:       { label: 'Italy',       flag: '🇮🇹', cgt: 0.260 },
  spain:       { label: 'Spain',       flag: '🇪🇸', cgt: 0.190 },
  netherlands: { label: 'Netherlands', flag: '🇳🇱', cgt: 0.310 },
  portugal:    { label: 'Portugal',    flag: '🇵🇹', cgt: 0.280 },
  austria:     { label: 'Austria',     flag: '🇦🇹', cgt: 0.275 },
  belgium:     { label: 'Belgium',     flag: '🇧🇪', cgt: 0.000 }, // 0% CGT; India 12.5% still applies
  denmark:     { label: 'Denmark',     flag: '🇩🇰', cgt: 0.420 },
  sweden:      { label: 'Sweden',      flag: '🇸🇪', cgt: 0.300 },
  finland:     { label: 'Finland',     flag: '🇫🇮', cgt: 0.300 },
  luxembourg:  { label: 'Luxembourg',  flag: '🇱🇺', cgt: 0.000 }, // 0% CGT on long-term equity gains
}

function getCountryTax(country: EuCountry): Record<MarketKey, { repatriate: number; local: number }> {
  const { cgt } = EU_TAX[country]
  return {
    india:  { repatriate: Math.max(cgt - 0.125, 0.125), local: 0.125 }, // DTAA: credit Indian 12.5% LTCG
    usa:    { repatriate: cgt,                           local: 0.150 }, // home CGT on US gains
    europe: { repatriate: cgt,                           local: cgt   }, // home CGT on EU gains
  }
}

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
    fxDragVsEur: 0.005, taxRepatriate: 0.33, taxLocal: 0.15,
    accentColor: '#3b82f6', glowColor: 'rgba(59,130,246,0.22)', bgColor: 'rgba(59,130,246,0.06)',
  },
  europe: {
    name: 'Europe', flag: '🇪🇺', currency: 'EUR', symbol: '€',
    fxDragVsEur: 0.00, taxRepatriate: 0.33, taxLocal: 0.33,
    accentColor: '#8b5cf6', glowColor: 'rgba(139,92,246,0.22)', bgColor: 'rgba(139,92,246,0.06)',
  },
} as const

// ── Blended return model ──────────────────────────────────────────────────────
// Historical trailing CAGRs — all from official ETF factsheets (verified April 2026)
// India: Motilal Oswal passive factsheet Feb 28 2026 (TRI, INR)
// Europe: iShares Feb 2026 (EUR) + SPDR Feb 2026 (EUR). 10y for EMID = since-inception proxy (fund launched 2017)
// USA: Invesco RSP Dec 2025 / iShares IJH+IWM Dec 2025 / Invesco QQQ Dec 2025 (all USD)
const HIST_CAGR: Record<InvestmentStyle, Record<MarketKey, { y3: number; y5: number; y10: number }>> = {
  conservative: {
    india:  { y3: 0.146, y5: 0.129, y10: 0.151 }, // Nifty 50 TRI — MO Feb 2026
    usa:    { y3: 0.125, y5: 0.103, y10: 0.115 }, // S&P 500 Equal Weight (RSP) — Invesco Dec 2025
    europe: { y3: 0.165, y5: 0.142, y10: 0.091 }, // Euro Stoxx 50 (CSX5) — iShares Feb 2026
  },
  balanced: {
    india:  { y3: 0.160, y5: 0.134, y10: 0.150 }, // Nifty Next 50 TRI — MO Feb 2026
    usa:    { y3: 0.230, y5: 0.144, y10: 0.148 }, // S&P 500 cap-weighted — MO Feb 2026
    europe: { y3: 0.143, y5: 0.127, y10: 0.079 }, // MSCI Europe broad (SMEA) — iShares Feb 2026
  },
  growth: {
    india:  { y3: 0.241, y5: 0.162, y10: 0.150 }, // Nifty Midcap 150 TRI — MO Feb 2026
    usa:    { y3: 0.125, y5: 0.091, y10: 0.107 }, // S&P MidCap 400 (IJH) — iShares Dec 2025
    europe: { y3: 0.145, y5: 0.100, y10: 0.080 }, // MSCI Europe Mid Cap (EMID) — iShares Feb 2026
  },
  aggressive: {
    india:  { y3: 0.195, y5: 0.156, y10: 0.144 }, // 50% Mid150 + 30% Small250 + 20% N50 — MO/NSE factsheets
    usa:    { y3: 0.252, y5: 0.114, y10: 0.155 }, // 60% QQQ + 40% IWM — Invesco/iShares Dec 2025
    europe: { y3: 0.100, y5: 0.062, y10: 0.079 }, // MSCI Europe Small Cap (SMC) — SPDR Feb 2026
  },
}

// Forward 10yr analyst consensus estimates (Goldman Sachs Oct 2024, Vanguard VCMM 2025)
const FWD_10Y: Record<InvestmentStyle, Record<MarketKey, number>> = {
  conservative: { india: 0.120, usa: 0.050, europe: 0.055 },
  balanced:     { india: 0.125, usa: 0.055, europe: 0.050 },
  growth:       { india: 0.130, usa: 0.070, europe: 0.055 },
  aggressive:   { india: 0.140, usa: 0.080, europe: 0.055 },
}

// Blends historical CAGR (interpolated for horizon) with forward 10yr estimate.
// Historical weight: 70% at 3yr → 35% at 25yr. Longer horizons trust forward more.
function getBlendedReturn(style: InvestmentStyle, key: MarketKey, years: number): number {
  const h = HIST_CAGR[style][key]
  const fwd = FWD_10Y[style][key]
  let histRate: number
  if (years <= 3)       histRate = h.y3
  else if (years <= 5)  histRate = h.y3 + (h.y5 - h.y3) * (years - 3) / 2
  else if (years <= 10) histRate = h.y5 + (h.y10 - h.y5) * (years - 5) / 5
  else                  histRate = h.y10
  const histWeight = Math.max(0.35, 0.70 - ((years - 3) / 22) * 0.35)
  return histWeight * histRate + (1 - histWeight) * fwd
}

// Each style maps to equivalent-risk indices across all three markets
const STYLE_DEF: Record<InvestmentStyle, {
  label: string; badge: string; description: string;
  india:  { benchmark: string; alloc: string }
  usa:    { benchmark: string; alloc: string }
  europe: { benchmark: string; alloc: string }
}> = {
  conservative: {
    label: 'Conservative', badge: 'Low risk', description: 'Largecap indices — lowest volatility, broad market',
    india:  { benchmark: 'Nifty 50',              alloc: '100% Nifty 50 largecap' },
    usa:    { benchmark: 'S&P 500 Equal Weight',   alloc: 'S&P 500 EW index (Invesco RSP)' },
    europe: { benchmark: 'Euro Stoxx 50',          alloc: 'Euro Stoxx 50' },
  },
  balanced: {
    label: 'Balanced', badge: 'Medium risk', description: 'Mostly large-cap, some mid — moderate risk',
    india:  { benchmark: 'Nifty Next 50',          alloc: 'Nifty Next 50 TRI' },
    usa:    { benchmark: 'S&P 500',                alloc: 'S&P 500 cap-weighted' },
    europe: { benchmark: 'MSCI Europe',            alloc: 'MSCI Europe broad market' },
  },
  growth: {
    label: 'Growth', badge: 'Med-high risk', description: 'Mid-cap heavy — higher return, higher volatility',
    india:  { benchmark: 'Nifty Midcap 150',       alloc: 'Nifty Midcap 150 TRI' },
    usa:    { benchmark: 'S&P MidCap 400',          alloc: 'S&P MidCap 400 (iShares IJH)' },
    europe: { benchmark: 'MSCI Europe Mid',         alloc: 'MSCI Europe Mid-Cap' },
  },
  aggressive: {
    label: 'Aggressive', badge: 'High risk', description: 'Small & mid cap — maximum growth, maximum volatility',
    india:  { benchmark: 'Mid + Small blend',      alloc: '50% Midcap + 30% Smallcap + 20% Nifty 50' },
    usa:    { benchmark: 'Nasdaq + Russell 2000',   alloc: '60% Nasdaq 100 + 40% Russell 2000' },
    europe: { benchmark: 'EU Small/Mid Cap',        alloc: 'MSCI Europe Small Cap' },
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
  liveFx: { EUR_INR: number; EUR_USD: number },
  taxes: Record<MarketKey, { repatriate: number; local: number }>,
): Record<MarketKey, MarketResult> {
  const results = {} as Record<MarketKey, MarketResult>
  const n = years * 12

  for (const key of ['india', 'usa', 'europe'] as MarketKey[]) {
    const m           = MARKET_DEF[key]
    const grossReturn = getBlendedReturn(style, key, years)
    const localRate   = m.currency === 'INR' ? liveFx.EUR_INR : m.currency === 'USD' ? liveFx.EUR_USD : 1
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

    let corpusEur: number
    if (m.currency === 'INR') {
      corpusEur = corpusLocal / (liveFx.EUR_INR * Math.pow(1 + m.fxDragVsEur, years))
    } else if (m.currency === 'USD') {
      corpusEur = corpusLocal / (liveFx.EUR_USD * Math.pow(1 + m.fxDragVsEur, years))
    } else {
      corpusEur = corpusLocal
    }

    const gainEur     = Math.max(0, corpusEur - principalEur)
    const taxEur      = gainEur * taxes[key].repatriate
    const netEur      = corpusEur - taxEur
    const netCagrEur  = principalEur > 0 ? Math.pow(netEur / principalEur, 1 / years) - 1 : 0

    const gainLocal    = Math.max(0, corpusLocal - principalLocal)
    const netLocal     = corpusLocal - gainLocal * taxes[key].local
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
  const [country, setCountry]             = useState<EuCountry>('ireland')
  const [activeTab, setActiveTab]         = useState<TabKey>('thesis')

  const taxes = useMemo(() => getCountryTax(country), [country])

  // ── Live FX rates ──────────────────────────────────────────────────────────
  const [fx, setFx] = useState({ EUR_INR: FX.EUR_INR, EUR_USD: FX.EUR_USD, loading: true, updatedAt: '' })

  useEffect(() => {
    fetch('/api/fx-rates')
      .then(r => r.json())
      .then(data => {
        if (data.EUR_INR && data.EUR_USD) {
          setFx({
            EUR_INR: data.EUR_INR,
            EUR_USD: data.EUR_USD,
            loading: false,
            updatedAt: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
          })
        }
      })
      .catch(() => setFx(prev => ({ ...prev, loading: false })))
  }, [])

  const principalEur = useMemo(() => {
    const n = parseFloat(amount.replace(/,/g, '')) || 0
    if (inputCurrency === 'INR') return n / fx.EUR_INR
    return n
  }, [amount, inputCurrency, fx])

  const results  = useMemo(() => computeResults(principalEur, years, mode, style, fx, taxes), [principalEur, years, mode, style, fx, taxes])
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

  const currencySymbol = inputCurrency === 'INR' ? '₹' : '€'

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
      <div className="artha-card overflow-hidden">

        {/* Header */}
        <div className="px-6 pt-6 pb-4 flex items-start justify-between" style={{ borderBottom: '1px solid rgba(11,28,48,0.07)' }}>
          <div>
            <div className="artha-label mb-0.5">Interactive Calculator</div>
            <div className="text-lg font-semibold" style={{ color: 'var(--artha-text)', letterSpacing: '-0.02em' }}>
              Run your own numbers
            </div>
          </div>
          {/* Live FX badge */}
          <div className="flex items-center gap-2 rounded-lg px-3 py-1.5 shrink-0"
            style={{ background: 'var(--artha-surface)', border: '1px solid rgba(11,28,48,0.07)' }}>
            <span className="relative flex h-2 w-2">
              {!fx.loading && <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-50"
                style={{ background: 'var(--artha-teal)' }} />}
              <span className="relative inline-flex rounded-full h-2 w-2"
                style={{ background: fx.loading ? 'var(--artha-text-faint)' : 'var(--artha-teal)' }} />
            </span>
            {fx.loading ? (
              <span className="text-[10px]" style={{ color: 'var(--artha-text-faint)' }}>Fetching rates…</span>
            ) : (
              <span className="text-[10px]" style={{ color: 'var(--artha-text-muted)' }}>
                Live FX · €1 = ₹{fx.EUR_INR.toFixed(1)} · ${fx.EUR_USD.toFixed(3)}
                {' '}<span style={{ color: 'var(--artha-text-faint)' }}>at {fx.updatedAt}</span>
              </span>
            )}
          </div>
        </div>

        {/* ── Country selector ─────────────────────────────────────────── */}
        <div className="px-6 py-4" style={{ borderBottom: '1px solid rgba(11,28,48,0.07)' }}>
          <div className="artha-label mb-2.5">Your EU country of residence</div>
          <div className="flex flex-wrap gap-1.5">
            {(Object.entries(EU_TAX) as [EuCountry, typeof EU_TAX.ireland][]).map(([code, def]) => (
              <button key={code} onClick={() => setCountry(code)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold transition-all"
                style={{
                  background: country === code ? 'var(--artha-teal-subtle)' : 'var(--artha-surface)',
                  border: `1px solid ${country === code ? 'rgba(0,106,97,0.25)' : 'rgba(11,28,48,0.07)'}`,
                  color: country === code ? 'var(--artha-teal)' : 'var(--artha-text-faint)',
                }}>
                <span>{def.flag}</span>
                <span>{def.label}</span>
              </button>
            ))}
          </div>
          <div className="mt-2 text-[9px]" style={{ color: 'var(--artha-text-faint)' }}>
            CGT: {(EU_TAX[country].cgt * 100).toFixed(1)}% ·
            India effective: {(taxes.india.repatriate * 100).toFixed(1)}% (DTAA credit) ·
            USA: {(taxes.usa.repatriate * 100).toFixed(1)}% ·
            Europe: {(taxes.europe.repatriate * 100).toFixed(1)}%
          </div>
        </div>

        {/* ── Step 1: Investment Style ──────────────────────────────────── */}
        <div className="px-6 py-4" style={{ borderBottom: '1px solid rgba(11,28,48,0.07)' }}>
          <div className="artha-label mb-3">1 · Your investment style</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {(Object.entries(STYLE_DEF) as [InvestmentStyle, typeof STYLE_DEF.growth][]).map(([key, def]) => {
              const isActive = style === key
              return (
                <button key={key} onClick={() => setStyle(key)}
                  className="rounded-xl p-3 text-left transition-all"
                  style={{
                    background: isActive ? 'var(--artha-teal-subtle)' : 'var(--artha-surface)',
                    border: `1.5px solid ${isActive ? 'rgba(0,106,97,0.25)' : 'rgba(11,28,48,0.07)'}`,
                  }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold" style={{ color: isActive ? 'var(--artha-teal)' : 'var(--artha-text)' }}>{def.label}</span>
                    <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full" style={{
                      background: isActive ? 'rgba(0,106,97,0.12)' : 'rgba(11,28,48,0.05)',
                      color: isActive ? 'var(--artha-teal)' : 'var(--artha-text-faint)',
                    }}>{def.badge}</span>
                  </div>
                  <div className="text-[9px] leading-relaxed" style={{ color: 'var(--artha-text-faint)' }}>{def.description}</div>
                </button>
              )
            })}
          </div>
          {/* Show what's being compared */}
          <div className="mt-3 flex items-center gap-4 flex-wrap">
            {(['india', 'usa', 'europe'] as MarketKey[]).map(k => (
              <div key={k} className="flex items-center gap-1.5">
                <span className="text-sm">{MARKET_DEF[k].flag}</span>
                <span className="text-[10px]" style={{ color: 'var(--artha-text-muted)' }}>
                  {STYLE_DEF[style][k].benchmark}
                  <span className="ml-1 font-mono" style={{ color: 'var(--artha-text-faint)' }}>
                    ({(getBlendedReturn(style, k, years) * 100).toFixed(1)}% blended)
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Step 2: Investment Type ───────────────────────────────────── */}
        <div className="px-6 py-4 flex items-center gap-3" style={{ borderBottom: '1px solid rgba(11,28,48,0.07)' }}>
          <div className="artha-label shrink-0">2 · Type</div>
          <div className="flex gap-2">
            {([
              { val: 'lump_sum', label: 'Lump Sum',    sub: 'One-time' },
              { val: 'sip',      label: 'Monthly SIP', sub: 'Every month' },
            ] as { val: InvestmentMode; label: string; sub: string }[]).map(opt => (
              <button key={opt.val} onClick={() => setMode(opt.val)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all"
                style={{
                  background: mode === opt.val ? 'var(--artha-teal-subtle)' : 'var(--artha-surface)',
                  color: mode === opt.val ? 'var(--artha-teal)' : 'var(--artha-text-secondary)',
                  border: `1.5px solid ${mode === opt.val ? 'rgba(0,106,97,0.25)' : 'rgba(11,28,48,0.07)'}`,
                }}>
                <div className="w-3 h-3 rounded-full border-2 flex items-center justify-center shrink-0"
                  style={{ borderColor: mode === opt.val ? 'var(--artha-teal)' : 'rgba(11,28,48,0.2)' }}>
                  {mode === opt.val && <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--artha-teal)' }} />}
                </div>
                <div>
                  <div>{opt.label}</div>
                  <div className="text-[9px] font-normal" style={{ color: 'var(--artha-text-faint)' }}>{opt.sub}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ── Step 3: Inputs ───────────────────────────────────────────── */}
        <div className="px-6 py-5 grid grid-cols-1 md:grid-cols-3 gap-6" style={{ borderBottom: '1px solid rgba(11,28,48,0.07)' }}>

          {/* Amount + currency */}
          <div>
            <label className="block artha-label mb-2.5">
              3 · {mode === 'sip' ? 'Monthly Contribution' : 'Amount to Invest'}
            </label>
            <div className="flex items-center rounded-xl overflow-hidden" style={{ background: 'var(--artha-surface)', border: '1px solid rgba(11,28,48,0.1)' }}>
              <div className="pl-4 pr-2 text-sm font-mono" style={{ color: 'var(--artha-text-muted)' }}>{currencySymbol}</div>
              <input
                type="text" value={amount}
                onChange={e => setAmount(e.target.value.replace(/[^0-9.,]/g, ''))}
                className="flex-1 py-3 pr-3 text-base font-mono font-semibold bg-transparent outline-none"
                style={{ color: 'var(--artha-text)' }}
                placeholder="10,000"
              />
            </div>
            <div className="flex gap-1.5 mt-2">
              {(['EUR', 'INR'] as CurrencyInput[]).map(c => (
                <button key={c} onClick={() => setInputCurrency(c)}
                  className="flex-1 py-1.5 rounded-lg text-[10px] font-semibold tracking-wider uppercase transition-all"
                  style={{
                    background: inputCurrency === c ? 'var(--artha-teal-subtle)' : 'var(--artha-surface)',
                    color: inputCurrency === c ? 'var(--artha-teal)' : 'var(--artha-text-faint)',
                    border: `1px solid ${inputCurrency === c ? 'rgba(0,106,97,0.25)' : 'rgba(11,28,48,0.07)'}`,
                  }}>
                  {c === 'EUR' ? '€ EUR' : '₹ INR'}
                </button>
              ))}
            </div>
            {principalEur > 0 && (
              <div className="mt-1.5 text-[10px]" style={{ color: 'var(--artha-text-faint)' }}>
                {inputCurrency === 'INR'
                  ? `≈ €${Math.round(principalEur).toLocaleString()} · $${Math.round(principalEur * fx.EUR_USD).toLocaleString()} at live rates`
                  : `≈ ₹${Math.round(principalEur * fx.EUR_INR).toLocaleString()} · $${Math.round(principalEur * fx.EUR_USD).toLocaleString()} at live rates`}
              </div>
            )}
          </div>

          {/* Time horizon */}
          <div>
            <label className="block artha-label mb-2.5">4 · Investment Horizon</label>
            <div className="flex items-baseline gap-2 mb-3">
              <span className="text-3xl font-display font-bold" style={{ color: 'var(--artha-teal)', letterSpacing: '-0.03em' }}>{years}</span>
              <span className="text-sm" style={{ color: 'var(--artha-text-muted)' }}>years</span>
            </div>
            <input type="range" min={3} max={25} step={1} value={years}
              onChange={e => setYears(Number(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
              style={{ accentColor: 'var(--artha-teal)', background: `linear-gradient(to right, var(--artha-teal) ${((years - 3) / 22) * 100}%, rgba(11,28,48,0.1) 0%)` }}
            />
            <div className="flex justify-between mt-1.5 text-[9px]" style={{ color: 'var(--artha-text-faint)' }}>
              <span>3 yr</span><span>10 yr</span><span>25 yr</span>
            </div>
          </div>

          {/* Repatriate to EUR */}
          <div>
            <label className="block artha-label mb-2.5">5 · Bring money back to Europe?</label>
            <div className="grid grid-cols-1 gap-2">
              {[
                { val: true,  label: 'Yes — convert to €', sub: 'Final corpus in EUR, net of NRI tax' },
                { val: false, label: 'No — keep locally',  sub: 'Final corpus in local currency' },
              ].map(opt => (
                <button key={String(opt.val)} onClick={() => setRepatriate(opt.val)}
                  className="rounded-xl px-3 py-2.5 text-left transition-all"
                  style={{
                    background: repatriate === opt.val ? 'var(--artha-teal-subtle)' : 'var(--artha-surface)',
                    border: `1.5px solid ${repatriate === opt.val ? 'rgba(0,106,97,0.25)' : 'rgba(11,28,48,0.07)'}`,
                  }}>
                  <div className="flex items-center gap-2">
                    <div className="w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0"
                      style={{ borderColor: repatriate === opt.val ? 'var(--artha-teal)' : 'rgba(11,28,48,0.2)' }}>
                      {repatriate === opt.val && <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--artha-teal)' }} />}
                    </div>
                    <div>
                      <div className="text-xs font-semibold" style={{ color: repatriate === opt.val ? 'var(--artha-teal)' : 'var(--artha-text-secondary)' }}>
                        {opt.label}
                      </div>
                      <div className="text-[9px]" style={{ color: 'var(--artha-text-faint)' }}>{opt.sub}</div>
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
                ? principalEur * (m.currency === 'INR' ? fx.EUR_INR : m.currency === 'USD' ? fx.EUR_USD : 1) * years * 12
                : principalEur * (m.currency === 'INR' ? fx.EUR_INR : m.currency === 'USD' ? fx.EUR_USD : 1)
              const multiplier = localPrincipal > 0 ? metric / (repatriate ? r.totalInvested : localPrincipal) : 0

              return (
                <div key={key} className="rounded-2xl p-5 relative transition-all"
                  style={{
                    background: isWinner ? m.bgColor : 'var(--artha-surface)',
                    border: `1.5px solid ${isWinner ? m.accentColor + '55' : 'rgba(11,28,48,0.07)'}`,
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
                        <div className="text-sm font-bold" style={{ color: isWinner ? m.accentColor : 'var(--artha-text)' }}>{m.name}</div>
                        <div className="text-[9px]" style={{ color: 'var(--artha-text-faint)' }}>{STYLE_DEF[style][key].benchmark}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold font-mono" style={{ color: m.accentColor }}>{fmtPct(cagr)}/yr</div>
                      <div className="text-[9px]" style={{ color: 'var(--artha-text-faint)' }}>net CAGR</div>
                    </div>
                  </div>

                  {/* Allocation chip */}
                  <div className="mb-3 text-[9px] px-2 py-1 rounded-md inline-block"
                    style={{ background: 'rgba(11,28,48,0.05)', color: 'var(--artha-text-muted)' }}>
                    {STYLE_DEF[style][key].alloc}
                  </div>

                  {/* Corpus */}
                  <div className="mb-1">
                    <div className="artha-label mb-0.5">
                      {repatriate ? 'Final corpus (€ net of tax)' : `Final corpus (${m.currency} net)`}
                    </div>
                    <div className="font-display font-bold" style={{ fontSize: '1.75rem', letterSpacing: '-0.03em', color: isWinner ? m.accentColor : 'var(--artha-text)', lineHeight: 1.1 }}>
                      {displayAmt}
                    </div>
                  </div>

                  {/* Invested + multiplier */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-[10px]" style={{ color: 'var(--artha-text-faint)' }}>
                      {mode === 'sip' ? `${fmtAmount(r.totalInvested, 'EUR')} total in` : `${fmtAmount(principalEur, 'EUR')} invested`}
                    </div>
                    {multiplier > 0 && (
                      <div className="text-[10px] font-mono font-semibold" style={{ color: isWinner ? m.accentColor : 'var(--artha-text-muted)' }}>
                        {multiplier.toFixed(1)}× your money
                      </div>
                    )}
                  </div>

                  {/* Bar */}
                  <div className="mb-3">
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(11,28,48,0.08)' }}>
                      <div className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${barPct}%`, background: isWinner ? m.accentColor : 'rgba(11,28,48,0.15)' }} />
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    <div className="rounded-lg px-2.5 py-2" style={{ background: 'var(--artha-card)', border: '1px solid rgba(11,28,48,0.06)' }}>
                      <div style={{ color: 'var(--artha-text-faint)' }}>Blended return</div>
                      <div className="font-mono font-semibold mt-0.5" style={{ color: 'var(--artha-text-secondary)' }}>
                        {(getBlendedReturn(style, key, years) * 100).toFixed(1)}% p.a. {m.currency}
                      </div>
                      <div className="mt-0.5" style={{ color: 'var(--artha-text-faint)', fontSize: '8px' }}>
                        hist·{(HIST_CAGR[style][key].y10 * 100).toFixed(0)}% fwd·{(FWD_10Y[style][key] * 100).toFixed(0)}%
                      </div>
                    </div>
                    <div className="rounded-lg px-2.5 py-2" style={{ background: 'var(--artha-card)', border: '1px solid rgba(11,28,48,0.06)' }}>
                      <div style={{ color: 'var(--artha-text-faint)' }}>Tax (NRI)</div>
                      <div className="font-mono font-semibold mt-0.5" style={{ color: 'var(--artha-text-secondary)' }}>
                        {repatriate
                          ? `${(taxes[key].repatriate * 100).toFixed(1)}%${key === 'india' ? ' DTAA net' : ' CGT'}`
                          : `${(taxes[key].local * 100).toFixed(1)}% local`}
                      </div>
                    </div>
                    {repatriate && key === 'india' && (
                      <div className="col-span-2 rounded-lg px-2.5 py-2" style={{ background: 'var(--artha-negative-bg)', border: '1px solid rgba(192,57,43,0.1)' }}>
                        <div style={{ color: 'var(--artha-text-faint)' }}>FX drag INR→EUR</div>
                        <div className="font-mono font-semibold mt-0.5" style={{ color: 'var(--artha-negative)' }}>
                          −3%/yr · EUR/INR ₹{Math.round(fx.EUR_INR * Math.pow(1.03, years))} at exit
                        </div>
                      </div>
                    )}
                    {repatriate && key === 'usa' && (
                      <div className="col-span-2 rounded-lg px-2.5 py-2" style={{ background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.1)' }}>
                        <div style={{ color: 'var(--artha-text-faint)' }}>FX drag USD→EUR</div>
                        <div className="font-mono font-semibold mt-0.5" style={{ color: 'var(--artha-text-secondary)' }}>
                          −0.5%/yr · EUR/USD ${(fx.EUR_USD * Math.pow(1.005, years)).toFixed(3)} at exit
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
            <div className="rounded-xl px-4 py-3 flex items-center gap-3"
              style={{ background: 'var(--artha-teal-subtle)', border: '1px solid rgba(0,106,97,0.12)' }}>
              <span className="text-lg">{MARKET_DEF[winnerKey].flag}</span>
              <div className="text-sm" style={{ color: 'var(--artha-text-secondary)' }}>
                <span style={{ color: MARKET_DEF[winnerKey].accentColor, fontWeight: 600 }}>{MARKET_DEF[winnerKey].name}</span>
                {' '}wins on your parameters — {' '}
                <span style={{ color: 'var(--artha-text)', fontWeight: 600 }}>
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
          <div className="mt-3 text-[9px] leading-relaxed" style={{ color: 'var(--artha-text-faint)' }}>
            {mode === 'sip' ? 'SIP: monthly contributions, monthly compounding. ' : 'Lump sum, annual compounding. '}
            Returns are blended (70% hist → 35% hist at 25yr) from verified factsheets: {STYLE_DEF[style].india.benchmark} {(getBlendedReturn(style, 'india', years) * 100).toFixed(1)}% INR · {STYLE_DEF[style].usa.benchmark} {(getBlendedReturn(style, 'usa', years) * 100).toFixed(1)}% USD · {STYLE_DEF[style].europe.benchmark} {(getBlendedReturn(style, 'europe', years) * 100).toFixed(1)}% EUR ·
            Sources: Motilal Oswal Feb 2026, Invesco RSP Dec 2025, Goldman Sachs Oct 2024 forward est. ·
            INR→EUR drag 3%/yr · Tax ({EU_TAX[country].label}): India {(taxes.india.repatriate * 100).toFixed(1)}% eff. (DTAA nets 12.5% Indian LTCG), USA {(taxes.usa.repatriate * 100).toFixed(1)}% CGT, Europe {(taxes.europe.repatriate * 100).toFixed(1)}% CGT · Direct stocks assumed (UCITS ETFs attract higher exit tax in some countries) ·
            FX: €1 = ₹{fx.EUR_INR.toFixed(1)} = ${fx.EUR_USD.toFixed(3)} (live) · Not financial advice.
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
