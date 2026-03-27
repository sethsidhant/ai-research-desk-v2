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
    .select('id, ticker, fundamentals_updated_at')
    .in('id', allStockIds);

  const pending = (stocks ?? []).filter(s => !s.fundamentals_updated_at);

  console.log(`[onboardingWatchdog] ${allStockIds.length} tracked, ${pending.length} missing fundamentals`);

  if (!pending.length) {
    const summary = `All ${allStockIds.length} stocks have fundamentals`;
    console.log(`✅ ${summary}`);
    const { error: e1 } = await supabase.from('agent_reports').insert({
      agent_name: 'onboarding_watchdog',
      status: 'ok',
      summary,
      report: { total: allStockIds.length, pending: [] },
    });
    if (e1) console.error('[onboardingWatchdog] agent_reports insert failed:', e1.message);
    return;
  }

  const onboarded = [];
  const failed    = [];

  for (const stock of pending) {
    console.log(`[onboardingWatchdog] Onboarding ${stock.ticker}...`);
    const ok = runOnboard(stock.ticker);
    if (ok) onboarded.push(stock.ticker);
    else    failed.push(stock.ticker);
  }

  const status  = failed.length > 0 ? (onboarded.length > 0 ? 'warning' : 'error') : 'ok';
  const summary = `Onboarded: ${onboarded.length} · Failed: ${failed.length} (of ${pending.length} pending)`;

  console.log(`[onboardingWatchdog] ${summary}`);

  const { error: e2 } = await supabase.from('agent_reports').insert({
    agent_name: 'onboarding_watchdog',
    status,
    summary,
    report: { total: allStockIds.length, onboarded, failed },
  });
  if (e2) console.error('[onboardingWatchdog] agent_reports insert failed:', e2.message);

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
}

main();
