import { NextRequest, NextResponse } from 'next/server'

const PROMPTS: Record<string, string> = {
  trump: `You are a concise Indian equity market analyst. Below are recent Trump posts/statements flagged as market-relevant.

Summarise in exactly 3 bullet points:
• Key theme / what was said
• Direct market implication (tariffs, USD, commodities, sectors)
• Likely impact on Indian equities (Nifty direction, sectors to watch)

Be specific and direct. No fluff. Use ▲ for positive, ▼ for negative, → for neutral.`,

  macro: `You are a concise Indian equity market analyst. Below are recent macro news items.

Summarise in exactly 3 bullet points:
• Dominant macro theme this week
• Global market implication (rates, USD, oil, risk-on/off)
• Likely impact on Indian equities (Nifty direction, sectors to watch)

Be specific and direct. No fluff. Use ▲ for positive, ▼ for negative, → for neutral.`,
}

export async function POST(req: NextRequest) {
  try {
    const { type, items } = await req.json()
    const systemPrompt = PROMPTS[type]
    if (!systemPrompt || !items?.length) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const itemText = items
      .map((it: { summary: string; created_at: string }, i: number) => {
        const mins  = Math.round((Date.now() - new Date(it.created_at).getTime()) / 60000)
        const label = mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.floor(mins / 60)}h ago` : `${Math.floor(mins / 1440)}d ago`
        return `${i + 1}. [${label}] ${it.summary}`
      })
      .join('\n')

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'API key not configured' }, { status: 500 })

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-api-key':       apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: `Items:\n${itemText}` }],
      }),
    })

    const json = await res.json()
    const brief = json.content?.[0]?.text ?? 'Could not generate brief.'
    return NextResponse.json({ brief })
  } catch (err) {
    console.error('macro-brief error:', err)
    return NextResponse.json({ error: 'Failed to generate brief' }, { status: 500 })
  }
}
