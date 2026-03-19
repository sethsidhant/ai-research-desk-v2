import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import path from 'path'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { ticker } = await params
  const safeTicker = ticker.replace(/[^A-Z0-9&\-\.]/gi, '')
  if (!safeTicker) return NextResponse.json({ error: 'Invalid ticker' }, { status: 400 })

  // Check if already scored today
  const today = new Date().toISOString().slice(0, 10)
  const { data: stock } = await supabase
    .from('stocks')
    .select('id, fundamentals_updated_at')
    .eq('ticker', safeTicker)
    .single()

  if (stock?.fundamentals_updated_at) {
    const lastUpdated = new Date(stock.fundamentals_updated_at).toISOString().slice(0, 10)
    if (lastUpdated === today) {
      return NextResponse.json({ status: 'already_scored', message: 'Already scored today' })
    }
  }

  // Fire and forget — respond immediately, run in background
  const agentsDir = path.join(process.cwd(), 'agents')
  exec(
    `node runOneStock.js ${safeTicker}`,
    { cwd: agentsDir, timeout: 120000 },
    (err, stdout, stderr) => {
      if (err) console.error(`[run-stock] ${safeTicker} failed:`, err.message)
      else console.log(`[run-stock] ${safeTicker} done:`, stdout.trim())
    }
  )

  return NextResponse.json({ status: 'processing', ticker: safeTicker })
}
