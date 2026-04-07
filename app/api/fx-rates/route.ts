import { NextResponse } from 'next/server'

// Proxy Yahoo Finance FX quotes server-side to avoid CORS.
// Symbols: EURINR=X, EURUSD=X
const YAHOO_URL =
  'https://query1.finance.yahoo.com/v7/finance/quote?symbols=EURINR=X,EURUSD=X'

export async function GET() {
  try {
    const res = await fetch(YAHOO_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      next: { revalidate: 60 }, // cache 60s on Vercel edge
    })
    if (!res.ok) throw new Error(`Yahoo returned ${res.status}`)

    const json = await res.json()
    const quotes: { symbol: string; regularMarketPrice: number }[] =
      json?.quoteResponse?.result ?? []

    const inrQ = quotes.find(q => q.symbol === 'EURINR=X')
    const usdQ = quotes.find(q => q.symbol === 'EURUSD=X')

    if (!inrQ || !usdQ) throw new Error('Missing symbols in response')

    return NextResponse.json(
      { EUR_INR: inrQ.regularMarketPrice, EUR_USD: usdQ.regularMarketPrice },
      { headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=30' } },
    )
  } catch (err) {
    // Fall back to ECB via frankfurter so the client always gets something
    try {
      const fb = await fetch('https://api.frankfurter.app/latest?from=EUR&to=INR,USD')
      const fbJson = await fb.json()
      const rates = fbJson?.rates ?? {}
      if (rates.INR && rates.USD) {
        return NextResponse.json({ EUR_INR: rates.INR, EUR_USD: rates.USD, fallback: true })
      }
    } catch {}
    return NextResponse.json({ error: String(err) }, { status: 502 })
  }
}
