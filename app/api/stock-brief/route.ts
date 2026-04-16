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

  const { data: stock } = await supabase
    .from('stocks')
    .select('id, stock_name, ticker, industry, current_price, high_52w, low_52w, stock_pe, industry_pe, roe, roce, debt_to_equity, promoter_holding, target_mean, analyst_rating, analyst_buy_pct, latest_headlines, ai_brief, ai_brief_date')
    .eq('ticker', ticker)
    .single()

  if (!stock) return NextResponse.json({ error: 'Stock not found' }, { status: 404 })

  // Cache check: same calendar day IST
  const todayIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
    .toISOString().slice(0, 10)

  if (stock.ai_brief && stock.ai_brief_date === todayIST) {
    try {
      const parsed = JSON.parse(stock.ai_brief)
      // Log cache hit (0 tokens) — for click tracking
      createAdminClient().from('api_usage_log').insert({
        agent: 'ai_brief_stock', ticker: stock.ticker,
        input_tokens: 0, output_tokens: 0, cost_usd: 0,
      }).then()
      return NextResponse.json({ brief: parsed, cached: true })
    } catch {
      // stale plain-text cache — regenerate
    }
  }

  // BYOK fallback
  const { data: userSettings } = await supabase
    .from('user_settings')
    .select('anthropic_api_key')
    .eq('user_id', user.id)
    .single()

  const apiKey = userSettings?.anthropic_api_key || process.env.ANTHROPIC_API_KEY!

  // Latest scores
  const { data: scoreRows } = await supabase
    .from('daily_scores')
    .select('rsi, rsi_signal, pe_deviation, composite_score, classification, suggested_action, above_200_dma, above_50_dma')
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

  // Recent macro alerts matching this stock's sector
  const macroLines: string[] = []
  if (fiiSector) {
    const cutoff7d = new Date(Date.now() - 7 * 86400000).toISOString()
    const { data: macroRows } = await supabase
      .from('macro_alerts')
      .select('summary, sentiment')
      .contains('affected_sectors', [fiiSector])
      .gte('created_at', cutoff7d)
      .order('created_at', { ascending: false })
      .limit(4)

    if (macroRows?.length) {
      macroLines.push(...macroRows.map(m => `[${m.sentiment ?? 'neutral'}] ${m.summary}`))
    }
  }

  // Build prompt context
  const ctx: string[] = []
  ctx.push(`Stock: ${stock.stock_name} (${stock.ticker}) | Industry: ${stock.industry ?? 'N/A'} | Price: ₹${stock.current_price ?? 'N/A'}`)

  if (stock.high_52w && stock.low_52w && stock.current_price) {
    const pctFromHigh = ((stock.current_price - stock.high_52w) / stock.high_52w * 100).toFixed(1)
    ctx.push(`52w range: ₹${stock.low_52w}–₹${stock.high_52w} | ${pctFromHigh}% from high`)
  }

  if (score) {
    ctx.push(`Technicals: RSI ${score.rsi?.toFixed(0) ?? '—'} (${score.rsi_signal ?? 'Neutral'}), ${score.above_200_dma ? 'above' : 'below'} 200DMA, ${score.above_50_dma ? 'above' : 'below'} 50DMA, Score ${score.composite_score?.toFixed(0) ?? '—'}/100 (${score.classification ?? '—'})`)
    if (score.pe_deviation != null) ctx.push(`PE deviation: ${score.pe_deviation > 0 ? '+' : ''}${score.pe_deviation.toFixed(0)}% vs industry`)
  }

  const fundParts: string[] = []
  if (stock.stock_pe)         fundParts.push(`PE ${stock.stock_pe.toFixed(1)}x`)
  if (stock.industry_pe)      fundParts.push(`Ind PE ${stock.industry_pe.toFixed(1)}x`)
  if (stock.roe)              fundParts.push(`ROE ${stock.roe.toFixed(1)}%`)
  if (stock.roce)             fundParts.push(`ROCE ${stock.roce.toFixed(1)}%`)
  if (stock.debt_to_equity != null) fundParts.push(`D/E ${stock.debt_to_equity.toFixed(2)}x`)
  if (stock.promoter_holding) fundParts.push(`Promoter ${stock.promoter_holding.toFixed(1)}%`)
  if (stock.target_mean && stock.current_price) {
    const upside = ((stock.target_mean - stock.current_price) / stock.current_price * 100).toFixed(1)
    fundParts.push(`Analyst target ₹${stock.target_mean.toFixed(0)} (${upside}% upside)`)
  }
  if (fundParts.length) ctx.push(`Fundamentals: ${fundParts.join(' | ')}`)

  if (fiiSector && fiiFlow != null) {
    const flowDesc = fiiFlow >= 500 ? 'strong buying' : fiiFlow >= 0 ? 'mild buying' : fiiFlow >= -500 ? 'mild selling' : 'heavy selling'
    ctx.push(`FII sector flow (${fiiSector}, fortnight): ${fiiFlow >= 0 ? '+' : ''}₹${Math.round(fiiFlow).toLocaleString('en-IN')} Cr — ${flowDesc}`)
  }

  if (macroLines.length) {
    ctx.push(`Recent macro news (${fiiSector} sector, last 7 days):\n${macroLines.map(l => `• ${l}`).join('\n')}`)
  }

  if (stock.latest_headlines) {
    ctx.push(`Stock news: ${stock.latest_headlines.slice(0, 400).replace(/\n+/g, ' ').trim()}`)
  }

  const prompt = `You are a concise Indian equity research analyst. Given the following data, return a JSON object only — no markdown, no explanation outside the JSON.

Return exactly this structure:
{
  "sentiment": "bull" or "bear" or "neutral",
  "summary": "2-3 sentence TL;DR with the single most important takeaway",
  "sections": {
    "fundamentals": "1-2 sentences on valuation vs industry, key profitability ratios, analyst target if available",
    "technicals": "1-2 sentences on RSI, DMA position, momentum score",
    "macro": "1-2 sentences on FII sector flow and any relevant macro news",
    "outlook": "1 sentence verdict — what to watch or do"
  }
}

Rules:
- sentiment "bull": positive setup (good valuation + momentum + macro tailwind)
- sentiment "bear": negative setup (expensive + weak technicals + macro headwind)
- sentiment "neutral": mixed signals
- Be specific with numbers. Keep each section under 50 words.

Data:
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
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!apiRes.ok) {
    console.error('Anthropic API error:', await apiRes.text())
    return NextResponse.json({ error: 'AI service error' }, { status: 500 })
  }

  const aiJson = await apiRes.json()
  const raw    = aiJson.content?.[0]?.text?.trim() ?? ''

  let parsed: object | null = null
  try {
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()
    parsed = JSON.parse(cleaned)
  } catch {
    return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })
  }

  // Cache to stocks table + log usage
  const admin = createAdminClient()
  const inputTokens  = aiJson.usage?.input_tokens  ?? 0
  const outputTokens = aiJson.usage?.output_tokens ?? 0
  const HAIKU_INPUT_PER_M  = 0.80
  const HAIKU_OUTPUT_PER_M = 4.00
  const costUsd = (inputTokens / 1_000_000) * HAIKU_INPUT_PER_M + (outputTokens / 1_000_000) * HAIKU_OUTPUT_PER_M

  await Promise.all([
    admin.from('stocks').update({ ai_brief: JSON.stringify(parsed), ai_brief_date: todayIST }).eq('id', stock.id),
    admin.from('api_usage_log').insert({
      agent: 'ai_brief_stock', ticker: stock.ticker,
      input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: costUsd,
    }),
  ])

  return NextResponse.json({ brief: parsed })
}
