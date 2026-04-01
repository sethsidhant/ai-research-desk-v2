import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { INDUSTRY_TO_FII_SECTOR } from '@/lib/fiiSectorMap'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { ticker } = await request.json().catch(() => ({}))
  if (!ticker) return NextResponse.json({ error: 'ticker required' }, { status: 400 })

  // Fetch stock data (includes brief cache fields)
  const { data: stock } = await supabase
    .from('stocks')
    .select('id, stock_name, ticker, industry, current_price, stock_pe, industry_pe, roe, roce, debt_to_equity, promoter_holding, latest_headlines, ai_brief, ai_brief_date')
    .eq('ticker', ticker)
    .single()

  if (!stock) return NextResponse.json({ error: 'Stock not found' }, { status: 404 })

  // ── Cache check: if brief was generated today (IST), return it ──────────
  const todayIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
    .toISOString().slice(0, 10)

  if (stock.ai_brief && stock.ai_brief_date === todayIST) {
    return NextResponse.json({ brief: stock.ai_brief, cached: true })
  }

  // ── Get user's BYOK key (falls back to app key) ──────────────────────────
  const { data: userSettings } = await supabase
    .from('user_settings')
    .select('anthropic_api_key')
    .eq('user_id', user.id)
    .single()

  const apiKey = userSettings?.anthropic_api_key || process.env.ANTHROPIC_API_KEY!

  // Latest scores
  const { data: scoreRows } = await supabase
    .from('daily_scores')
    .select('rsi, rsi_signal, pe_deviation, composite_score, classification, suggested_action, above_200_dma, above_50_dma, date')
    .eq('stock_id', stock.id)
    .order('date', { ascending: false })
    .limit(1)

  const score = scoreRows?.[0] ?? null

  // FII sector flow
  const fiiSector = stock.industry ? (INDUSTRY_TO_FII_SECTOR[stock.industry] ?? null) : null
  let fiiFlow: number | null = null
  if (fiiSector) {
    const { data: fiiRows } = await supabase
      .from('fii_sector')
      .select('fortnight_flow')
      .eq('sector', fiiSector)
      .single()
    fiiFlow = fiiRows?.fortnight_flow ?? null
  }

  // Build compact context for the prompt
  const ctx: string[] = []

  ctx.push(`Stock: ${stock.stock_name} (${stock.ticker}) | Industry: ${stock.industry ?? 'N/A'} | Price: ₹${stock.current_price ?? 'N/A'}`)

  if (score) {
    const dmaStatus   = score.above_200_dma ? 'above 200DMA' : 'below 200DMA'
    const dmaStatus50 = score.above_50_dma  ? 'above 50DMA'  : 'below 50DMA'
    ctx.push(`Technicals: RSI ${score.rsi?.toFixed(0) ?? '—'} (${score.rsi_signal ?? 'Neutral'}), PE deviation ${score.pe_deviation != null ? (score.pe_deviation > 0 ? '+' : '') + score.pe_deviation.toFixed(0) + '%' : '—'} vs industry, ${dmaStatus}, ${dmaStatus50}, Score: ${score.composite_score?.toFixed(1) ?? '—'}/10 (${score.classification ?? '—'})`)
  }

  const fundParts: string[] = []
  if (stock.stock_pe)         fundParts.push(`PE: ${stock.stock_pe.toFixed(1)}x`)
  if (stock.industry_pe)      fundParts.push(`Industry PE: ${stock.industry_pe.toFixed(1)}x`)
  if (stock.roe)              fundParts.push(`ROE: ${stock.roe.toFixed(1)}%`)
  if (stock.roce)             fundParts.push(`ROCE: ${stock.roce.toFixed(1)}%`)
  if (stock.debt_to_equity)   fundParts.push(`D/E: ${stock.debt_to_equity.toFixed(2)}x`)
  if (stock.promoter_holding) fundParts.push(`Promoter: ${stock.promoter_holding.toFixed(1)}%`)
  if (fundParts.length) ctx.push(`Fundamentals: ${fundParts.join(' | ')}`)

  if (fiiSector && fiiFlow != null) {
    ctx.push(`FII flow (${fiiSector}, fortnight): ${fiiFlow >= 0 ? '+' : ''}₹${Math.round(fiiFlow).toLocaleString('en-IN')} Cr — ${fiiFlow >= 500 ? 'strong buying' : fiiFlow >= 0 ? 'mild buying' : fiiFlow >= -500 ? 'mild selling' : 'heavy selling'} in sector`)
  }

  // News — first 600 chars only
  if (stock.latest_headlines) {
    const newsSnippet = stock.latest_headlines.slice(0, 600).replace(/\n+/g, ' ').trim()
    ctx.push(`Recent news: ${newsSnippet}`)
  }

  const prompt = `You are a concise Indian equity research analyst. Given the following data, write a 4-line investment brief. Be direct. Cover: (1) valuation vs industry PE, (2) technical momentum, (3) FII sector flow implication, (4) one-line verdict. No headers, no bullet points, just 4 short sentences. Keep it under 120 words total.

${ctx.join('\n')}`

  const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!apiRes.ok) {
    const err = await apiRes.text()
    console.error('Anthropic API error:', err)
    return NextResponse.json({ error: 'AI service error' }, { status: 500 })
  }

  const aiJson = await apiRes.json()
  const brief  = aiJson.content?.[0]?.text?.trim() ?? ''

  // ── Write brief back to stocks table (cache for rest of today) ───────────
  if (brief) {
    const admin = createAdminClient()
    await admin
      .from('stocks')
      .update({ ai_brief: brief, ai_brief_date: todayIST })
      .eq('id', stock.id)
  }

  return NextResponse.json({ brief })
}
