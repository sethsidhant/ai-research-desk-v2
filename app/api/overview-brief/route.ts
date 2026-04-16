import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { INDUSTRY_TO_FII_SECTOR } from '@/lib/fiiSectorMap'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { type } = await request.json().catch(() => ({}))
  if (type !== 'portfolio' && type !== 'watchlist') {
    return NextResponse.json({ error: 'type must be portfolio or watchlist' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Cache check: same calendar day IST
  const todayIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
    .toISOString().slice(0, 10)

  const { data: cached } = await admin
    .from('user_briefs')
    .select('brief, sentiment, generated_at')
    .eq('user_id', user.id)
    .eq('type', type)
    .single()

  if (cached?.generated_at) {
    const cachedDate = new Date(cached.generated_at).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }).split(',')[0]
    const todayDate  = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }).split(',')[0]
    if (cachedDate === todayDate) {
      try {
        // Log cache hit (0 tokens) — for click tracking
        admin.from('api_usage_log').insert({
          agent: 'ai_brief_overview', ticker: type,
          input_tokens: 0, output_tokens: 0, cost_usd: 0,
        }).then()
        return NextResponse.json({ brief: JSON.parse(cached.brief), cached: true })
      } catch {}
    }
  }

  // BYOK fallback
  const { data: userSettings } = await supabase
    .from('user_settings')
    .select('anthropic_api_key')
    .eq('user_id', user.id)
    .single()
  const apiKey = userSettings?.anthropic_api_key || process.env.ANTHROPIC_API_KEY!

  // Fetch stocks + scores
  let stockLines: string[] = []
  let uniqueSectors: string[] = []

  if (type === 'portfolio') {
    const { data: holdings } = await admin
      .from('portfolio_holdings')
      .select('stock_id, quantity, avg_price, stocks(ticker, stock_name, industry, current_price)')
      .eq('user_id', user.id)

    if (!holdings?.length) return NextResponse.json({ error: 'No portfolio holdings found' }, { status: 400 })

    const stockIds = holdings.map(h => h.stock_id)
    const { data: scores } = await admin
      .from('daily_scores')
      .select('stock_id, rsi, rsi_signal, composite_score, classification, above_200_dma')
      .in('stock_id', stockIds)
      .order('date', { ascending: false })

    // Keep only latest score per stock
    const latestScore: Record<string, NonNullable<typeof scores>[0]> = {}
    for (const s of (scores ?? [])) {
      if (!latestScore[s.stock_id]) latestScore[s.stock_id] = s
    }

    for (const h of holdings) {
      const st = h.stocks as any
      if (!st) continue
      const price   = st.current_price ?? h.avg_price
      const pnlPct  = ((price - h.avg_price) / h.avg_price * 100).toFixed(1)
      const sc      = latestScore[h.stock_id]
      const sector  = st.industry ? (INDUSTRY_TO_FII_SECTOR[st.industry] ?? null) : null
      if (sector && !uniqueSectors.includes(sector)) uniqueSectors.push(sector)

      const parts = [`${st.ticker} (${st.industry ?? 'N/A'}) — P&L ${parseFloat(pnlPct) >= 0 ? '+' : ''}${pnlPct}%`]
      if (sc) parts.push(`RSI ${sc.rsi?.toFixed(0) ?? '—'} ${sc.rsi_signal ?? ''}, Score ${sc.composite_score?.toFixed(0) ?? '—'}/100 (${sc.classification ?? '—'}), ${sc.above_200_dma ? '↑200DMA' : '↓200DMA'}`)
      stockLines.push(parts.join(' | '))
    }
  } else {
    const { data: watchlist } = await admin
      .from('user_stocks')
      .select('stock_id, entry_price, invested_amount, stocks(ticker, stock_name, industry, current_price)')
      .eq('user_id', user.id)

    if (!watchlist?.length) return NextResponse.json({ error: 'No watchlist stocks found' }, { status: 400 })

    const stockIds = watchlist.map(w => w.stock_id)
    const { data: scores } = await admin
      .from('daily_scores')
      .select('stock_id, rsi, rsi_signal, composite_score, classification, above_200_dma')
      .in('stock_id', stockIds)
      .order('date', { ascending: false })

    const latestScore: Record<string, NonNullable<typeof scores>[0]> = {}
    for (const s of (scores ?? [])) {
      if (!latestScore[s.stock_id]) latestScore[s.stock_id] = s
    }

    for (const w of watchlist) {
      const st = w.stocks as any
      if (!st) continue
      const sector = st.industry ? (INDUSTRY_TO_FII_SECTOR[st.industry] ?? null) : null
      if (sector && !uniqueSectors.includes(sector)) uniqueSectors.push(sector)

      const sc    = latestScore[w.stock_id]
      const parts = [`${st.ticker} (${st.industry ?? 'N/A'})`]
      if (sc) parts.push(`RSI ${sc.rsi?.toFixed(0) ?? '—'} ${sc.rsi_signal ?? ''}, Score ${sc.composite_score?.toFixed(0) ?? '—'}/100 (${sc.classification ?? '—'}), ${sc.above_200_dma ? '↑200DMA' : '↓200DMA'}`)
      if (w.entry_price && st.current_price) {
        const ret = ((st.current_price - w.entry_price) / w.entry_price * 100).toFixed(1)
        parts.push(`Return ${parseFloat(ret) >= 0 ? '+' : ''}${ret}%`)
      }
      stockLines.push(parts.join(' | '))
    }
  }

  // Macro alerts across all held sectors (last 7 days)
  const macroLines: string[] = []
  if (uniqueSectors.length) {
    const cutoff7d = new Date(Date.now() - 7 * 86400000).toISOString()
    const { data: macroRows } = await admin
      .from('macro_alerts')
      .select('summary, sentiment, affected_sectors')
      .overlaps('affected_sectors', uniqueSectors)
      .gte('created_at', cutoff7d)
      .order('created_at', { ascending: false })
      .limit(6)

    if (macroRows?.length) {
      macroLines.push(...macroRows.map(m => `[${m.sentiment ?? 'neutral'}] ${m.summary}`))
    }
  }

  const isPortfolio = type === 'portfolio'

  const prompt = `You are a concise Indian equity portfolio analyst. Given the following ${isPortfolio ? 'portfolio' : 'watchlist'} data, return a JSON object only — no markdown, no explanation.

Return exactly this structure:
{
  "sentiment": "bull" or "bear" or "neutral",
  "summary": "2-3 sentence ${isPortfolio ? 'portfolio' : 'watchlist'} overview — the single most important takeaway",
  "sections": {
    "composition": "${isPortfolio ? 'P&L leaders/laggards, sector concentration, allocation insights' : 'Sector spread, top scoring stocks, notable signals'}",
    "signals": "RSI and DMA signals across the ${isPortfolio ? 'portfolio' : 'watchlist'} — what is overbought, oversold, or at key levels",
    "macro": "Macro and FII flow implications for the specific sectors held",
    "outlook": "1 sentence overall verdict — what to watch or action to consider"
  }
}

Rules:
- sentiment reflects the overall setup of the ${isPortfolio ? 'portfolio' : 'watchlist'} right now
- Be specific: name stocks when making points
- Keep each section under 60 words

${isPortfolio ? 'Portfolio' : 'Watchlist'} stocks:
${stockLines.join('\n')}
${macroLines.length ? `\nRecent macro news (sectors held):\n${macroLines.map(l => `• ${l}`).join('\n')}` : ''}`

  const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!apiRes.ok) {
    console.error('Anthropic overview-brief error:', await apiRes.text())
    return NextResponse.json({ error: 'AI service error' }, { status: 500 })
  }

  const aiJson = await apiRes.json()
  const raw    = aiJson.content?.[0]?.text?.trim() ?? ''

  let parsed: any = null
  try {
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()
    parsed = JSON.parse(cleaned)
  } catch {
    return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })
  }

  const inputTokens  = aiJson.usage?.input_tokens  ?? 0
  const outputTokens = aiJson.usage?.output_tokens ?? 0
  const HAIKU_INPUT_PER_M  = 0.80
  const HAIKU_OUTPUT_PER_M = 4.00
  const costUsd = (inputTokens / 1_000_000) * HAIKU_INPUT_PER_M + (outputTokens / 1_000_000) * HAIKU_OUTPUT_PER_M

  // Upsert to user_briefs (one row per user+type) + log usage
  await Promise.all([
    admin.from('user_briefs').upsert(
      { user_id: user.id, type, brief: JSON.stringify(parsed), sentiment: parsed.sentiment ?? 'neutral', generated_at: new Date().toISOString() },
      { onConflict: 'user_id,type' }
    ),
    admin.from('api_usage_log').insert({
      agent: 'ai_brief_overview', ticker: type,
      input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: costUsd,
    }),
  ])

  return NextResponse.json({ brief: parsed })
}
