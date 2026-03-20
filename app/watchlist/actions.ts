'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { exec } from 'child_process'
import path from 'path'
import fs from 'fs'

async function fetchIndexBaseline(): Promise<{ nifty50: number | null; nifty500: number | null }> {
  try {
    const apiKey = process.env.KITE_API_KEY
    if (!apiKey) return { nifty50: null, nifty500: null }

    let accessToken: string | undefined
    try {
      accessToken = fs.readFileSync(path.join(process.cwd(), '.kite_token'), 'utf8').trim()
    } catch {
      accessToken = process.env.KITE_ACCESS_TOKEN
    }
    if (!accessToken) return { nifty50: null, nifty500: null }

    const res = await fetch(
      'https://api.kite.trade/quote?i=NSE%3ANIFTY+50&i=NSE%3ANIFTY+500',
      {
        headers: { 'X-Kite-Version': '3', 'Authorization': `token ${apiKey}:${accessToken}` },
        signal: AbortSignal.timeout(5000),
      }
    )
    if (!res.ok) return { nifty50: null, nifty500: null }
    const json = await res.json()
    return {
      nifty50:  json.data?.['NSE:NIFTY 50']?.last_price  ?? null,
      nifty500: json.data?.['NSE:NIFTY 500']?.last_price ?? null,
    }
  } catch {
    return { nifty50: null, nifty500: null }
  }
}

export type AlertPrefs = {
  rsi_oversold_threshold:   number
  rsi_overbought_threshold: number
  dma_cross_alert:          boolean
  pct_from_high_threshold:  number
  new_filing_alert:         boolean
}

export async function addToWatchlist(stockId: string, alerts: AlertPrefs, investedAmount?: number) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Fetch current stock price + index baseline in parallel
  const [{ data: stockData }, { nifty50, nifty500 }] = await Promise.all([
    supabase.from('stocks').select('current_price').eq('id', stockId).single(),
    fetchIndexBaseline(),
  ])

  const entryPrice = stockData?.current_price ?? null

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
      entry_price:      entryPrice,
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

export async function updateStockAlerts(stockId: string, alerts: AlertPrefs) {
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
    })
    .eq('user_id', user.id)
    .eq('stock_id', stockId)

  if (error) return { error: error.message }
  revalidatePath('/watchlist')
  return { success: true }
}
