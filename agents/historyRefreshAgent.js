// historyRefreshAgent.js — Quarterly Screener history refresh
//
// Runs 4x/year after results seasons (~Jan 20, Apr 20, Jul 20, Oct 20).
// For each watchlisted/portfolio stock:
//   1. Fetch all 6 Screener sections
//   2. Compare latest header of EVERY section vs what's stored in DB
//   3. Only update DB if any section has a new period
//   4. Skips stocks already up-to-date — zero unnecessary writes
//
// Usage: node historyRefreshAgent.js

require('dotenv').config({ path: '../.env.local' });
const { execSync }     = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const { sendToMany }   = require('./telegramAlert');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const sleep = ms => new Promise(r => setTimeout(r, ms));

const SECTIONS = ['quarterly', 'annual_pl', 'balance_sheet', 'cash_flow', 'ratios', 'shareholding'];

function latestHeaders(history) {
  if (!history) return {};
  const out = {};
  for (const s of SECTIONS) {
    // Screener table is oldest-first (left→right) — last element is the most recent period
    const headers = history[s]?.headers ?? [];
    out[s] = headers[headers.length - 1] ?? null;
  }
  return out;
}

function hasNewData(scraped, stored) {
  const scrapedH = latestHeaders(scraped);
  const storedH  = latestHeaders(stored);
  return SECTIONS.some(s => {
    if (!scrapedH[s]) return false;
    if (!storedH[s])  return true;
    return scrapedH[s] !== storedH[s];
  });
}

async function main() {
  const startedAt = new Date();
  console.log(`\n[historyRefreshAgent] ${startedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);

  const [{ data: wsRows }, { data: phRows }] = await Promise.all([
    supabase.from('user_stocks').select('stock_id'),
    supabase.from('portfolio_holdings').select('stock_id'),
  ]);
  const stockIds = [...new Set([
    ...(wsRows ?? []).map(r => r.stock_id),
    ...(phRows ?? []).map(r => r.stock_id),
  ])];

  if (!stockIds.length) { console.log('No stocks found.'); return; }

  const { data: stocks } = await supabase
    .from('stocks')
    .select('id, ticker, stock_name, earnings_history')
    .in('id', stockIds)
    .order('ticker');

  console.log(`Refreshing history for ${stocks.length} stocks...\n`);

  let updated = 0, skipped = 0, failed = 0;
  const updatedTickers = [], newResultsTickers = [], skippedTickers = [], failedTickers = [];

  for (const stock of stocks) {
    const { ticker, stock_name } = stock;
    if (!ticker) continue;

    process.stdout.write(`[${ticker}] ${stock_name}... `);

    let scraped;
    try {
      scraped = JSON.parse(execSync(`python3 fetchScreenerHistory.py ${ticker}`, {
        encoding: 'utf8', cwd: __dirname, timeout: 35000,
      }));
    } catch (e) {
      console.log(`FAILED (${e.message.slice(0, 60)})`);
      failed++; failedTickers.push(ticker);
      await sleep(3000); continue;
    }

    if (!hasNewData(scraped, stock.earnings_history)) {
      console.log('up-to-date — skipped');
      skipped++; skippedTickers.push(ticker);
      await sleep(2000); continue;
    }

    const scrapedH = latestHeaders(scraped);
    const storedH  = latestHeaders(stock.earnings_history);
    const changed  = SECTIONS.filter(s => scrapedH[s] && scrapedH[s] !== storedH[s]);
    console.log(`updated [${changed.join(', ')}]`);

    const { error } = await supabase
      .from('stocks')
      .update({
        earnings_history: {
          quarterly:     scraped.quarterly     ?? null,
          annual_pl:     scraped.annual_pl     ?? null,
          balance_sheet: scraped.balance_sheet ?? null,
          cash_flow:     scraped.cash_flow     ?? null,
          ratios:        scraped.ratios        ?? null,
          shareholding:  scraped.shareholding  ?? null,
        },
      })
      .eq('id', stock.id);

    if (error) {
      console.log(`  DB write failed: ${error.message}`);
      failed++; failedTickers.push(ticker);
    } else {
      updated++; updatedTickers.push(ticker);
      // Only notify if this stock had previous history and got a genuinely new period
      // (not a first-time fetch where stored was null)
      if (stock.earnings_history && changed.includes('quarterly')) {
        newResultsTickers.push(ticker);
      }
    }

    await sleep(3000);
  }

  const durationSecs = Math.round((Date.now() - startedAt.getTime()) / 1000);
  const status  = failed > 0 ? 'warning' : 'ok';
  const summary = `Updated: ${updated}, Skipped (up-to-date): ${skipped}, Failed: ${failed} — ${durationSecs}s`;
  console.log(`\n✅ Done — ${summary}`);

  await supabase.from('agent_reports').insert({
    agent_name: 'history_refresh',
    status,
    summary,
    report: { updated: updatedTickers, skipped: skippedTickers, failed: failedTickers, total: stocks.length, duration_secs: durationSecs },
    ran_at: startedAt.toISOString(),
  });

  await supabase.from('app_settings').upsert(
    { key: 'cron_history_refresh_last_run', value: startedAt.toISOString() },
    { onConflict: 'key' }
  );

  // Notify users only for stocks with genuinely new quarterly periods (not first-time fetches)
  if (newResultsTickers.length > 0) {
    const { data: userPrefs } = await supabase
      .from('user_alert_preferences')
      .select('telegram_chat_id')
      .not('telegram_chat_id', 'is', null);

    const chatIds = (userPrefs ?? []).map(p => p.telegram_chat_id).filter(Boolean);
    if (chatIds.length) {
      const lines = newResultsTickers.map(t => `• ${t}`).join('\n');
      const msg = `🧪 *[TEST] New Quarterly Results*\n\n${newResultsTickers.length} stock${newResultsTickers.length > 1 ? 's have' : ' has'} new results on Screener:\n\n${lines}\n\n_History tab in the app is up to date._\n\n_This is a test message — remove [TEST] once verified._`;
      await sendToMany(chatIds, msg);
      console.log(`[historyRefreshAgent] Telegram TEST sent to ${chatIds.length} user(s) for ${newResultsTickers.length} stocks.`);
    }
  }

  console.log('[historyRefreshAgent] Report written.');
}

main().catch(err => { console.error('[historyRefreshAgent] Fatal:', err.message); process.exit(1); });
