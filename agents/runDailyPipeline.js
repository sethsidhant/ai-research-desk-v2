// runDailyPipeline.js
// Runs the full daily pipeline in sequence:
//   1. engine    — score all watchlisted stocks
//   2. newsAgent — fetch BSE filings + news
// (summaryAgent removed — AI briefs are now on-demand per user request)
//
// Run daily at ~3:05 AM Dublin (8:35 AM IST), after refreshKiteToken.js

const { execSync } = require('child_process');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { createClient } = require('@supabase/supabase-js');

const dir = __dirname;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

function run(script, args = '') {
  const label = `[pipeline] ${script}`;
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`${label} — starting at ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);
  console.log('─'.repeat(60));
  try {
    execSync(`node ${script} ${args}`.trim(), { cwd: dir, stdio: 'inherit', timeout: 10 * 60 * 1000 });
    console.log(`✅ ${script} done`);
  } catch (err) {
    console.error(`❌ ${script} failed:`, err.message);
  }
}

async function onboardPendingStocks() {
  // Find stocks in watchlist OR portfolio that have never been onboarded
  const [watchlistRes, portfolioRes] = await Promise.all([
    supabase.from('user_stocks').select('stocks(ticker, fundamentals_updated_at)'),
    supabase.from('portfolio_holdings').select('stocks(ticker, fundamentals_updated_at)'),
  ]);

  const allRows = [...(watchlistRes.data ?? []), ...(portfolioRes.data ?? [])];
  if (!allRows.length) return;

  const pending = [...new Set(
    allRows
      .map(r => Array.isArray(r.stocks) ? r.stocks[0] : r.stocks)
      .filter(s => s && !s.fundamentals_updated_at)
      .map(s => s.ticker)
  )];

  if (!pending.length) {
    console.log('[pipeline] No pending stocks to onboard.');
    return;
  }

  console.log(`[pipeline] Onboarding ${pending.length} new stock(s): ${pending.join(', ')}`);
  for (const ticker of pending) {
    run('onboardStock.js', ticker);
  }
}

async function main() {
  const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day    = nowIST.getDay(); // 0 = Sunday, 6 = Saturday
  if (day === 0 || day === 6) {
    console.log(`[runDailyPipeline] Weekend — skipping. (${nowIST.toDateString()})`);
    process.exit(0);
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`[runDailyPipeline] ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);
  console.log('═'.repeat(60));

  await onboardPendingStocks();

  run('backfillHistory.js');  // EOD closes from Kite — must run before engine
  run('engine.js');
  run('newsAgent.js');
  run('mfSebiAgent.js');     // MF equity/debt flow from SEBI (3-5 day lag)

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`✅ Daily pipeline complete — ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);
  console.log('═'.repeat(60));
}

main();
