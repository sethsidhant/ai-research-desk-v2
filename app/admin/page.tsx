import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import BudgetForm from '@/components/BudgetForm'

// ── Claude claude-sonnet-4-6 pricing (USD per 1M tokens) ────────────────────────────
const PRICE_INPUT  = 3.00   // $3/M input tokens
const PRICE_OUTPUT = 15.00  // $15/M output tokens

// Estimated tokens per unique stock per day (engine + summaryAgent)
const DAILY_INPUT_PER_STOCK  = 2600
const DAILY_OUTPUT_PER_STOCK = 950

// One-time onboarding tokens per stock
const ONBOARD_INPUT  = 5000
const ONBOARD_OUTPUT = 2000

function costUsd(inputTokens: number, outputTokens: number) {
  return (inputTokens / 1_000_000) * PRICE_INPUT + (outputTokens / 1_000_000) * PRICE_OUTPUT
}

function fmt(n: number, decimals = 2) {
  return n.toFixed(decimals)
}

function usd(n: number) {
  if (n < 0.01) return `$${(n * 100).toFixed(4)}¢`
  return `$${n.toFixed(2)}`
}

export default async function AdminPage() {
  const supabase      = await createClient()
  const adminSupabase = createAdminClient()

  // Gate: only admin
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const adminEmail = process.env.ADMIN_EMAIL
  if (adminEmail && user.email !== adminEmail) redirect('/')

  // ── 1. User count via admin API ────────────────────────────────────────────
  const { data: { users: allUsers = [] } } = await adminSupabase.auth.admin.listUsers({ perPage: 1000 })
  const totalUsers = allUsers.length

  // ── 2. Watchlist stats ─────────────────────────────────────────────────────
  const { data: watchlistRows } = await adminSupabase
    .from('user_stocks')
    .select('user_id, stock_id, added_at')

  const entries      = watchlistRows ?? []
  const usersWithStocks = new Set(entries.map(r => r.user_id)).size
  const uniqueStocks    = new Set(entries.map(r => r.stock_id)).size
  const avgStocksPerUser = usersWithStocks > 0 ? (entries.length / usersWithStocks) : 0

  // Stock popularity
  const stockCounts: Record<string, number> = {}
  for (const r of entries) {
    stockCounts[r.stock_id] = (stockCounts[r.stock_id] ?? 0) + 1
  }
  const topStockIds = Object.entries(stockCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id]) => id)

  const { data: topStockData } = topStockIds.length > 0
    ? await adminSupabase.from('stocks').select('id, ticker, stock_name, industry').in('id', topStockIds)
    : { data: [] }

  const topStocks = topStockIds.map(id => {
    const s = (topStockData ?? []).find(x => x.id === id)
    return { ...s, count: stockCounts[id] }
  }).filter(s => s.ticker)

  // ── 3. Recent onboards (last 7 days) ──────────────────────────────────────
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const recentAdds   = entries.filter(r => r.added_at && r.added_at > sevenDaysAgo).length

  // ── 4. Real API usage from log ─────────────────────────────────────────────
  const thirtyDaysAgoISO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const todayISO         = new Date().toISOString().slice(0, 10)

  const { data: usageRows } = await adminSupabase
    .from('api_usage_log')
    .select('agent, input_tokens, output_tokens, cost_usd, created_at')
    .gte('created_at', thirtyDaysAgoISO)
    .order('created_at', { ascending: false })

  const usage = usageRows ?? []

  // Totals (30d)
  const totalCost30d   = usage.reduce((s, r) => s + Number(r.cost_usd), 0)
  const todayUsage     = usage.filter(r => r.created_at.slice(0, 10) === todayISO)
  const totalCostToday = todayUsage.reduce((s, r) => s + Number(r.cost_usd), 0)

  // All-time totals
  const { data: allTimeRows } = await adminSupabase
    .from('api_usage_log')
    .select('input_tokens, output_tokens, cost_usd')

  const allTime            = allTimeRows ?? []
  const allTimeCost        = allTime.reduce((s, r) => s + Number(r.cost_usd), 0)
  const allTimeInputTokens = allTime.reduce((s, r) => s + Number(r.input_tokens), 0)
  const allTimeOutputTokens= allTime.reduce((s, r) => s + Number(r.output_tokens), 0)

  // Credit budget from app_settings
  const { data: budgetRow } = await adminSupabase
    .from('app_settings').select('value').eq('key', 'anthropic_credit_budget').single()
  const creditBudget    = budgetRow?.value ? parseFloat(budgetRow.value) : null
  const creditRemaining = creditBudget != null ? Math.max(0, creditBudget - allTimeCost) : null
  const spentPct        = creditBudget != null ? Math.min((allTimeCost / creditBudget) * 100, 100) : null

  // By agent (last 30d)
  const byAgent: Record<string, { calls: number; inputTokens: number; outputTokens: number; cost: number }> = {}
  for (const r of usage) {
    if (!byAgent[r.agent]) byAgent[r.agent] = { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 }
    byAgent[r.agent].calls++
    byAgent[r.agent].inputTokens  += Number(r.input_tokens)
    byAgent[r.agent].outputTokens += Number(r.output_tokens)
    byAgent[r.agent].cost         += Number(r.cost_usd)
  }

  // Estimated (for projection — still useful when log is empty)
  const dailyCost    = costUsd(uniqueStocks * DAILY_INPUT_PER_STOCK, uniqueStocks * DAILY_OUTPUT_PER_STOCK)
  const monthlyCost  = dailyCost * 30
  const onboardCost  = costUsd(recentAdds * ONBOARD_INPUT, recentAdds * ONBOARD_OUTPUT)

  // ── 5. Growth projections ──────────────────────────────────────────────────
  // Assume avg 8 unique stocks per user, ~60% overlap at scale
  function projectUniqueStocks(users: number) {
    return Math.round(users * avgStocksPerUser * (1 - Math.min(0.6, users * 0.005)))
  }
  const projections = [10, 25, 50, 100, 250, 500].map(u => {
    const stocks   = Math.max(uniqueStocks, projectUniqueStocks(u))
    const daily    = costUsd(stocks * DAILY_INPUT_PER_STOCK, stocks * DAILY_OUTPUT_PER_STOCK)
    const monthly  = daily * 30
    return { users: u, stocks, daily, monthly }
  })

  // ── 6. User join trend (last 30 days) ────────────────────────────────────
  const recentUsers = allUsers.filter(u => u.created_at && new Date(u.created_at) > new Date(thirtyDaysAgoISO)).length

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 px-6 py-4 bg-white flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Admin Dashboard</h1>
          <p className="text-xs text-gray-400 mt-0.5">Visible only to you</p>
        </div>
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-900 px-3 py-1.5 rounded-lg hover:bg-gray-100">
          ← Back to Dashboard
        </Link>
      </header>

      <main className="max-w-screen-xl mx-auto px-6 py-8 space-y-10">

        {/* ── Users ─────────────────────────────────────────────── */}
        <section>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">Users</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <AdminCard label="Total Users"        value={totalUsers.toString()} />
            <AdminCard label="With Watchlists"    value={usersWithStocks.toString()} />
            <AdminCard label="Joined Last 30d"    value={recentUsers.toString()} highlight="green" />
            <AdminCard label="Avg Stocks / User"  value={fmt(avgStocksPerUser, 1)} />
          </div>
        </section>

        {/* ── Stocks ────────────────────────────────────────────── */}
        <section>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">Stocks</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <AdminCard label="Unique Stocks"       value={uniqueStocks.toString()} />
            <AdminCard label="Total Watchlist Rows" value={entries.length.toString()} />
            <AdminCard label="Added Last 7d"       value={recentAdds.toString()} highlight="green" />
            <AdminCard label="Onboard Cost (7d)"   value={usd(onboardCost)} />
          </div>

          {/* Top stocks */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 text-xs font-semibold text-gray-400 uppercase tracking-widest">
              Most Watchlisted Stocks
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100">
                  <th className="text-left px-5 py-2">#</th>
                  <th className="text-left px-5 py-2">Ticker</th>
                  <th className="text-left px-5 py-2">Name</th>
                  <th className="text-left px-5 py-2">Industry</th>
                  <th className="text-right px-5 py-2">Users Watching</th>
                </tr>
              </thead>
              <tbody>
                {topStocks.map((s, i) => (
                  <tr key={s.id} className={`border-b border-gray-50 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
                    <td className="px-5 py-2.5 text-gray-400 font-mono text-xs">{i + 1}</td>
                    <td className="px-5 py-2.5 font-mono font-semibold text-gray-900">{s.ticker}</td>
                    <td className="px-5 py-2.5 text-gray-700">{s.stock_name}</td>
                    <td className="px-5 py-2.5 text-gray-400 text-xs">{s.industry ?? '—'}</td>
                    <td className="px-5 py-2.5 text-right">
                      <span className="inline-block bg-blue-50 text-blue-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                        {s.count}
                      </span>
                    </td>
                  </tr>
                ))}
                {topStocks.length === 0 && (
                  <tr><td colSpan={5} className="px-5 py-6 text-center text-gray-400 text-sm">No data yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Anthropic Credit ──────────────────────────────────── */}
        <section>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">Anthropic Credit</h2>
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm px-5 py-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
              <AdminCard label="All-Time Spend"     value={usd(allTimeCost)} highlight={allTimeCost > (creditBudget ?? 999) * 0.8 ? 'red' : undefined} />
              <AdminCard label="Credit Remaining"   value={creditRemaining != null ? usd(creditRemaining) : '—'} highlight={creditRemaining != null ? (creditRemaining < 2 ? 'red' : creditRemaining < 5 ? 'amber' : 'green') : undefined} />
              <AdminCard label="Input Tokens (all)" value={`${(allTimeInputTokens / 1000).toFixed(1)}K`} />
              <AdminCard label="Output Tokens (all)"value={`${(allTimeOutputTokens / 1000).toFixed(1)}K`} />
            </div>

            {/* Progress bar */}
            {spentPct != null && (
              <div className="mb-4">
                <div className="flex justify-between text-xs text-gray-400 mb-1.5">
                  <span>Spent {usd(allTimeCost)} of {usd(creditBudget!)}</span>
                  <span className={spentPct > 80 ? 'text-red-600 font-semibold' : 'text-gray-500'}>{spentPct.toFixed(1)}% used</span>
                </div>
                <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${spentPct > 80 ? 'bg-red-500' : spentPct > 50 ? 'bg-amber-400' : 'bg-emerald-500'}`}
                    style={{ width: `${spentPct}%` }}
                  />
                </div>
              </div>
            )}

            <div className="text-xs text-gray-400 border-t border-gray-100 pt-3">
              Anthropic has no API to read your live balance — enter it manually when you top up.
              <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noopener noreferrer" className="ml-2 text-blue-500 hover:underline">
                View on Anthropic Console →
              </a>
              <BudgetForm current={creditBudget} />
            </div>
          </div>
        </section>

        {/* ── API Costs ─────────────────────────────────────────── */}
        <section>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">Claude API Cost (claude-sonnet-4-6) — Actual</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <AdminCard label="Today's Spend"      value={usd(totalCostToday)} highlight={totalCostToday > 1 ? 'amber' : undefined} />
            <AdminCard label="Last 30 Days"       value={usd(totalCost30d)}   highlight={totalCost30d > 10 ? 'amber' : undefined} />
            <AdminCard label="Est. Monthly"       value={usd(monthlyCost)}    />
            <AdminCard label="Total API Calls"    value={usage.length.toString()} />
          </div>

          {/* Per-agent breakdown */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden mb-4">
            <div className="px-5 py-3 border-b border-gray-100 text-xs font-semibold text-gray-400 uppercase tracking-widest">
              Breakdown by Agent (last 30 days)
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100">
                  <th className="text-left px-5 py-2">Agent</th>
                  <th className="text-right px-5 py-2">Calls</th>
                  <th className="text-right px-5 py-2">Input Tokens</th>
                  <th className="text-right px-5 py-2">Output Tokens</th>
                  <th className="text-right px-5 py-2">Total Cost</th>
                  <th className="text-right px-5 py-2">Avg / Call</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(byAgent).sort((a, b) => b[1].cost - a[1].cost).map(([agent, d], i) => (
                  <tr key={agent} className={`border-b border-gray-50 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
                    <td className="px-5 py-2.5 font-mono text-gray-900">{agent}</td>
                    <td className="px-5 py-2.5 text-right text-gray-700">{d.calls}</td>
                    <td className="px-5 py-2.5 text-right font-mono text-xs text-gray-500">{(d.inputTokens / 1000).toFixed(1)}K</td>
                    <td className="px-5 py-2.5 text-right font-mono text-xs text-gray-500">{(d.outputTokens / 1000).toFixed(1)}K</td>
                    <td className="px-5 py-2.5 text-right font-semibold text-gray-900">{usd(d.cost)}</td>
                    <td className="px-5 py-2.5 text-right text-gray-500 text-xs">{usd(d.cost / d.calls)}</td>
                  </tr>
                ))}
                {Object.keys(byAgent).length === 0 && (
                  <tr><td colSpan={6} className="px-5 py-6 text-center text-gray-400 text-sm">No usage logged yet — will populate from tomorrow's pipeline run</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm px-5 py-4 text-xs text-gray-400 space-y-1">
            <p>Pricing: <span className="text-gray-600">$3.00/M input · $15.00/M output</span></p>
            <p>Cost scales with <span className="text-gray-600 font-medium">unique stocks</span>, not users — if 10 users all watch RELIANCE, it only costs once.</p>
          </div>
        </section>

        {/* ── Growth Projections ────────────────────────────────── */}
        <section>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">Cost Projections as You Grow</h2>
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-5 py-3">Users</th>
                  <th className="text-right px-5 py-3">Est. Unique Stocks</th>
                  <th className="text-right px-5 py-3">Daily Claude Cost</th>
                  <th className="text-right px-5 py-3">Monthly Claude Cost</th>
                </tr>
              </thead>
              <tbody>
                {projections.map((p, i) => (
                  <tr key={p.users} className={`border-b border-gray-50 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
                    <td className="px-5 py-3 font-semibold text-gray-900">{p.users}</td>
                    <td className="px-5 py-3 text-right font-mono text-gray-700">{p.stocks}</td>
                    <td className="px-5 py-3 text-right font-mono text-gray-700">{usd(p.daily)}</td>
                    <td className={`px-5 py-3 text-right font-mono font-semibold ${p.monthly > 20 ? 'text-red-600' : p.monthly > 5 ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {usd(p.monthly)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-5 py-3 text-xs text-gray-400 border-t border-gray-100">
              Projection assumes avg {fmt(avgStocksPerUser || 8, 1)} stocks/user with overlap increasing at scale. Actual costs may vary.
            </div>
          </div>
        </section>

      </main>
    </div>
  )
}

function AdminCard({
  label, value, highlight,
}: {
  label: string
  value: string
  highlight?: 'green' | 'amber' | 'red'
}) {
  const color =
    highlight === 'green' ? 'text-emerald-600' :
    highlight === 'amber' ? 'text-amber-600' :
    highlight === 'red'   ? 'text-red-600' :
    'text-gray-900'

  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-4 shadow-sm">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-400 mt-1">{label}</div>
    </div>
  )
}
