import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { execFile } from 'child_process'
import path from 'path'

function triggerOnboarding(ticker: string) {
  const safeTicker = ticker.replace(/[^A-Z0-9&\-\.]/gi, '')
  execFile('node', ['onboardStock.js', safeTicker], {
    cwd: path.join(process.cwd(), 'agents'), timeout: 180000,
  }, (err) => {
    if (err) console.error(`[portfolio-onboard] ${safeTicker} failed:`, err.message)
    else     console.log(`[portfolio-onboard] ${safeTicker} done`)
  })
}

// Parse simple CSV: Ticker,Quantity,AvgPrice,Broker
// First row may be a header row (if it starts with non-numeric Ticker column)
function parseCSV(text: string): { ticker: string; quantity: number; avgPrice: number; broker: string }[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const rows: { ticker: string; quantity: number; avgPrice: number; broker: string }[] = []

  for (const line of lines) {
    const cols = line.split(',').map(c => c.trim().replace(/^"(.*)"$/, '$1'))
    if (cols.length < 3) continue
    const [col0, col1, col2, col3] = cols
    // Skip header row
    if (isNaN(Number(col1)) && col1.toLowerCase() === 'quantity') continue
    const ticker   = col0.toUpperCase()
    const quantity = parseFloat(col1)
    const avgPrice = parseFloat(col2)
    const broker   = col3 ?? 'Manual'
    if (!ticker || isNaN(quantity) || quantity <= 0 || isNaN(avgPrice) || avgPrice <= 0) continue
    rows.push({ ticker, quantity, avgPrice, broker })
  }
  return rows
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const admin    = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let csvText: string
  try {
    const formData = await request.formData()
    const file     = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    csvText = await file.text()
  } catch {
    return NextResponse.json({ error: 'Failed to read file' }, { status: 400 })
  }

  const parsed = parseCSV(csvText)
  if (!parsed.length) {
    return NextResponse.json({ error: 'No valid rows found. Format: Ticker,Quantity,AvgPrice,Broker' }, { status: 400 })
  }

  const tickers = [...new Set(parsed.map(r => r.ticker))]

  // Look up existing stocks
  const { data: existing } = await admin
    .from('stocks')
    .select('id, ticker')
    .in('ticker', tickers)

  const tickerToId: Record<string, string> = {}
  for (const s of existing ?? []) tickerToId[s.ticker] = s.id

  // Stub-insert unknown tickers
  const unknown = tickers.filter(t => !tickerToId[t])
  if (unknown.length > 0) {
    const stubs = unknown.map(ticker => ({ ticker, stock_name: ticker }))
    const { data: inserted } = await admin
      .from('stocks')
      .upsert(stubs, { onConflict: 'ticker', ignoreDuplicates: false })
      .select('id, ticker')
    for (const s of inserted ?? []) tickerToId[s.ticker] = s.id
    for (const t of unknown) triggerOnboarding(t)
  }

  // Aggregate duplicate tickers (weighted avg price)
  const aggregated: Record<string, { quantity: number; totalCost: number; broker: string }> = {}
  for (const row of parsed) {
    if (!tickerToId[row.ticker]) continue
    if (!aggregated[row.ticker]) aggregated[row.ticker] = { quantity: 0, totalCost: 0, broker: row.broker }
    aggregated[row.ticker].quantity  += row.quantity
    aggregated[row.ticker].totalCost += row.quantity * row.avgPrice
  }

  const upsertRows = Object.entries(aggregated).map(([ticker, agg]) => ({
    user_id:       user.id,
    stock_id:      tickerToId[ticker],
    quantity:      agg.quantity,
    avg_price:     parseFloat((agg.totalCost / agg.quantity).toFixed(2)),
    broker:        agg.broker,
    import_source: 'csv',
    updated_at:    new Date().toISOString(),
  }))

  const { error } = await supabase
    .from('portfolio_holdings')
    .upsert(upsertRows, { onConflict: 'user_id,stock_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const notFound = tickers.filter(t => !tickerToId[t])

  return NextResponse.json({
    synced:     upsertRows.length,
    onboarding: unknown,
    notFound,
    message:    `Imported ${upsertRows.length} holdings${unknown.length ? `, onboarding ${unknown.length} new stocks` : ''}`,
  })
}
