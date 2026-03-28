// onboardingWatchdog.js
// Runs at 08:20 AM IST — 15 minutes before daily pipeline.
// Finds stocks in watchlist or portfolio with missing fundamentals.
// Triggers onboardStock.js for each pending stock.
// Writes result to agent_reports table.

require('dotenv').config({ path: '../.env.local' });
const { spawnSync }    = require('child_process');
const path             = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const TELEGRAM_BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_CHAT = process.env.TELEGRAM_ADMIN_CHAT_ID;

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_CHAT) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_ADMIN_CHAT, text, parse_mode: 'Markdown' }),
  }).catch(() => {});
}

function runOnboard(ticker) {
  const result = spawnSync('node', ['onboardStock.js', ticker], {
    cwd:     __dirname,
    stdio:   'inherit',
    timeout: 3 * 60 * 1000,
  });
  return result.status === 0;
}

async function main() {
  console.log('[onboardingWatchdog] Starting...');

  const [{ data: watchlistRows }, { data: portfolioRows }] = await Promise.all([
    supabase.from('user_stocks').select('stock_id'),
    supabase.from('portfolio_holdings').select('stock_id'),
  ]);

  const allStockIds = [
    ...new Set([
      ...(watchlistRows ?? []).map(r => r.stock_id),
      ...(portfolioRows ?? []).map(r => r.stock_id),
    ])
  ];

  if (!allStockIds.length) {
    console.log('[onboardingWatchdog] No stocks tracked. Exiting.');
    const { error: e0 } = await supabase.from('agent_reports').insert({
      agent_name: 'onboarding_watchdog',
      status: 'ok',
      summary: 'No stocks tracked',
      report: { pending: [] },
    });
    if (e0) console.error('[onboardingWatchdog] agent_reports insert failed:', e0.message);
    return;
  }

  const { data: stocks } = await supabase
    .from('stocks')
    .select('id, ticker, fundamentals_updated_at, stock_pe, mc_scid, analyst_rating, mc_earnings_json')
    .in('id', allStockIds);

  const stockList  = stocks ?? [];
  // ETFs have no PE — exclude from MC analyst checks (they have no MC page)
  const etfList    = stockList.filter(s => s.fundamentals_updated_at && s.stock_pe == null);
  const equityList = stockList.filter(s => !etfList.find(e => e.id === s.id));
  const pending    = stockList.filter(s => !s.fundamentals_updated_at);

  console.log(`[onboardingWatchdog] ${allStockIds.length} tracked, ${pending.length} missing fundamentals`);

  // ── Onboarding section ───────────────────────────────────────────────────
  const onboarded = [];
  const failed    = [];

  for (const stock of pending) {
    console.log(`[onboardingWatchdog] Onboarding ${stock.ticker}...`);
    const ok = runOnboard(stock.ticker);
    if (ok) onboarded.push(stock.ticker);
    else    failed.push(stock.ticker);
  }

  const onboardStatus  = failed.length > 0 ? (onboarded.length > 0 ? 'warning' : 'error') : 'ok';
  const onboardSummary = pending.length === 0
    ? `All ${allStockIds.length} stocks have fundamentals`
    : `Onboarded: ${onboarded.length} · Failed: ${failed.length} (of ${pending.length} pending)`;

  console.log(`[onboardingWatchdog] ${onboardSummary}`);

  // ── MC scId + analyst gap check ──────────────────────────────────────────
  const missingScid    = equityList.filter(s => !s.mc_scid);
  const missingAnalyst = equityList.filter(s => s.mc_scid && !s.analyst_rating);
  const missingEarnings = equityList.filter(s => s.mc_scid && !s.mc_earnings_json);

  console.log(`[onboardingWatchdog] MC gaps — no scId: ${missingScid.length}, no analyst data: ${missingAnalyst.length}`);

  // ── Write agent_reports ──────────────────────────────────────────────────
  const { error: e2 } = await supabase.from('agent_reports').insert({
    agent_name: 'onboarding_watchdog',
    status:     onboardStatus,
    summary:    onboardSummary,
    report: {
      total: allStockIds.length,
      onboarded,
      failed,
      mc_missing_scid:     missingScid.map(s => s.ticker),
      mc_missing_analyst:  missingAnalyst.map(s => s.ticker),
      mc_missing_earnings: missingEarnings.map(s => s.ticker),
    },
  });
  if (e2) console.error('[onboardingWatchdog] agent_reports insert failed:', e2.message);

  // ── Telegram alerts ──────────────────────────────────────────────────────
  if (onboarded.length > 0) {
    await sendTelegram(
      `🔍 *Onboarding Watchdog*\n\n` +
      `Onboarded ${onboarded.length} stock(s): ${onboarded.join(', ')}\n` +
      (failed.length > 0 ? `⚠️ Failed: ${failed.join(', ')}` : '✅ All completed')
    );
  }
  if (failed.length > 0 && onboarded.length === 0) {
    await sendTelegram(`🔴 *Onboarding Watchdog FAILED*\n\nFailed: ${failed.join(', ')}`);
  }

  // Report MC gaps every day so you don't forget
  if (missingScid.length > 0 || missingAnalyst.length > 0) {
    const lines = [`📊 *MC Data Gaps*\n`];
    if (missingScid.length > 0) {
      lines.push(`⚠️ *No scId set* (${missingScid.length}) — analyst + earnings data missing:`);
      lines.push(`  ${missingScid.map(s => s.ticker).join(', ')}`);
      lines.push(`  ➡️ Run: \`node setScids.js TICKER SCID\``);
    }
    if (missingAnalyst.length > 0) {
      lines.push(`\n⚠️ *scId set but no analyst data* (${missingAnalyst.length}):`);
      lines.push(`  ${missingAnalyst.map(s => s.ticker).join(', ')}`);
      lines.push(`  ➡️ Will auto-fill on Saturday engine run`);
    }
    if (missingEarnings.length > 0) {
      lines.push(`\n⚠️ *Missing earnings forecast* (${missingEarnings.length}):`);
      lines.push(`  ${missingEarnings.map(s => s.ticker).join(', ')}`);
    }
    await sendTelegram(lines.join('\n'));
  }
}

main();
