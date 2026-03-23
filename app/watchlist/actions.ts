'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { exec } from 'child_process'
import path from 'path'
import fs from 'fs'

// Fetch live prices from Kite for both a stock and the indices.
// Kite last_price = live price during market hours, closing price after close.
// Both stock and index come from Kite so they always reflect the same market state.
async function fetchKitePrices(instrumentToken: number | null): Promise<{
  stockPrice: number | null
  nifty50:    number | null
  nifty500:   number | null
}> {
  try {
    const apiKey = process.env.KITE_API_KEY
    if (!apiKey) return { stockPrice: null, nifty50: null, nifty500: null }

    // Try .kite_token file (local), then Supabase app_settings (always up-to-date after GH Actions refresh), then env var
    let accessToken: string | undefined
    try {
      accessToken = fs.readFileSync(path.join(process.cwd(), '.kite_token'), 'utf8').trim()
    } catch { /* not available on Vercel */ }

    if (!accessToken) {
      const admin = createAdminClient()
      const { data } = await admin.from('app_settings').select('value').eq('key', 'kite_access_token').single()
      accessToken = data?.value ?? process.env.KITE_ACCESS_TOKEN
    }

    if (!accessToken) return { stockPrice: null, nifty50: null, nifty500: null }

    // Always fetch indices; only include stock instrument if token available
    const query = instrumentToken
      ? `i=NSE%3ANIFTY+50&i=NSE%3ANIFTY+500&i=${instrumentToken}`
      : `i=NSE%3ANIFTY+50&i=NSE%3ANIFTY+500`
    const res = await fetch(`https://api.kite.trade/quote?${query}`, {
      headers: { 'X-Kite-Version': '3', 'Authorization': `token ${apiKey}:${accessToken}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return { stockPrice: null, nifty50: null, nifty500: null }
    const json = await res.json()
    const d = json.data ?? {}
    const stockKey = instrumentToken
      ? Object.keys(d).find(k => k !== 'NSE:NIFTY 50' && k !== 'NSE:NIFTY 500')
      : undefined
    return {
      stockPrice: stockKey ? (d[stockKey]?.last_price ?? null) : null,
      nifty50:    d['NSE:NIFTY 50']?.last_price  ?? null,
      nifty500:   d['NSE:NIFTY 500']?.last_price ?? null,
    }
  } catch {
    return { stockPrice: null, nifty50: null, nifty500: null }
  }
}

export type AlertPrefs = {
  rsi_oversold_threshold:   number
  rsi_overbought_threshold: number
  dma_cross_alert:          boolean
  pct_from_high_threshold:  number
  new_filing_alert:         boolean
}

export async function addToWatchlist(stockId: string, alerts: AlertPrefs, investedAmount?: number, entryPrice?: number) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Fetch index levels from Kite for relative performance tracking
  let nifty50: number | null = null
  let nifty500: number | null = null

  const kite = await fetchKitePrices(null)
  nifty50  = kite.nifty50
  nifty500 = kite.nifty500

  // If Kite failed, fall back to latest index_history close
  if (!nifty50 || !nifty500) {
    const admin = createAdminClient()
    const { data: idx } = await admin
      .from('index_history')
      .select('nifty50_close, nifty500_close')
      .order('date', { ascending: false })
      .limit(1)
      .single()
    if (!nifty50)  nifty50  = idx?.nifty50_close  ?? null
    if (!nifty500) nifty500 = idx?.nifty500_close ?? null
  }

  const { error } = await supabase
    .from('user_stocks')
    .insert({
      user_id:  user.id,
      stock_id: stockId,
      rsi_oversold_threshold:   alerts.rsi_oversold_threshold,
      rsi_overbought_threshold: alerts.rsi_overbought_threshold,
      dma_cross_alert:          alerts.dma_cross_alert,
      pct_from_high_threshold:  alerts.pct_from_high_threshold,
      new_filing_alert:         alerts.new_filing_alert,
      invested_amount:  investedAmount && investedAmount > 0 ? investedAmount : null,
      entry_price:      entryPrice && entryPrice > 0 ? entryPrice : null,
      nifty50_entry:    nifty50,
      nifty500_entry:   nifty500,
    })

  if (error) return { error: error.message }

  // Trigger on-demand scoring in background (fire-and-forget)
  const { data: stock } = await supabase
    .from('stocks')
    .select('ticker, fundamentals_updated_at')
    .eq('id', stockId)
    .single()

  if (stock?.ticker) {
    const today = new Date().toISOString().slice(0, 10)
    const lastUpdated = stock.fundamentals_updated_at
      ? new Date(stock.fundamentals_updated_at).toISOString().slice(0, 10)
      : null

    if (lastUpdated !== today) {
      const agentsDir = path.join(process.cwd(), 'agents')
      const safeTicker = stock.ticker.replace(/[^A-Z0-9&\-\.]/gi, '')
      exec(
        `node onboardStock.js ${safeTicker}`,
        { cwd: agentsDir, timeout: 180000 },
        (err, stdout) => {
          if (err) console.error(`[onboard] ${safeTicker} failed:`, err.message)
          else console.log(`[onboard] ${safeTicker} done:`, stdout.trim())
        }
      )
    }
  }

  revalidatePath('/')
  revalidatePath('/watchlist')
  return { success: true }
}

export async function removeFromWatchlist(stockId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('user_stocks')
    .delete()
    .eq('user_id', user.id)
    .eq('stock_id', stockId)

  if (error) return { error: error.message }
  revalidatePath('/')
  revalidatePath('/watchlist')
  return { success: true }
}

export async function updateStockAlerts(stockId: string, alerts: AlertPrefs, investedAmount?: number, entryPrice?: number) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('user_stocks')
    .update({
      rsi_oversold_threshold:   alerts.rsi_oversold_threshold,
      rsi_overbought_threshold: alerts.rsi_overbought_threshold,
      dma_cross_alert:          alerts.dma_cross_alert,
      pct_from_high_threshold:  alerts.pct_from_high_threshold,
      new_filing_alert:         alerts.new_filing_alert,
      invested_amount:  investedAmount && investedAmount > 0 ? investedAmount : null,
      entry_price:      entryPrice && entryPrice > 0 ? entryPrice : null,
    })
    .eq('user_id', user.id)
    .eq('stock_id', stockId)

  if (error) return { error: error.message }
  revalidatePath('/')
  revalidatePath('/watchlist')
  return { success: true }
}
