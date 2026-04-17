// earningsAlertAgent.js — earnings results scanner (runs every 4h during earnings season)
//
// Scans all watchlist + portfolio stocks for new quarterly results on Screener.
// Sends targeted Telegram notification ONLY to users who hold each specific stock.
// Deduplicates via notifications_sent (user_id + stock_id + alert_type).
// Updates earnings_history in DB when new period found.
//
// Runs on Railway (Indian IP needed for Screener).
// Usage: node earningsAlertAgent.js

require('dotenv').config({ path: '../.env.local' });
const { execFileSync }  = require('child_process');
const { createClient }  = require('@supabase/supabase-js');
const { sendToMany }    = require('./telegramAlert');
const path              = require('path');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Revenue row labels vary by stock type:
//   Industrials/IT/Consumer → Sales / Net Sales / Revenue from Operations
//   Banks                   → Interest Earned
//   Insurance               → Gross Premium Written / Net Premium Earned
const REVENUE_LABELS = /^(sales|net sales|revenue from operations|revenue|interest earned|gross premium written|net premium earned)/i;
const PROFIT_LABELS  = /^(net profit|profit after tax|pat|profit \/ loss after tax|profit\/loss after tax)/i;

function extractResultsSummary(scraped) {
  const q = scraped?.quarterly;
  if (!q?.headers?.length || !q?.rows?.length) return null;

  // Screener table is oldest-first (left→right), so last element = most recent quarter
  const period     = q.headers[q.headers.length - 1];
  const revenueRow = q.rows.find(r => REVENUE_LABELS.test(r.label?.trim()));
  const profitRow  = q.rows.find(r => PROFIT_LABELS.test(r.label?.trim()));

  function yoy(curr, prev) {
    if (curr == null || prev == null || prev === 0) return null;
    return ((curr - prev) / Math.abs(prev) * 100).toFixed(1);
  }

  const len       = revenueRow?.values?.length ?? profitRow?.values?.length ?? 0;
  const revenue   = revenueRow?.values?.[len - 1]  ?? null; // most recent quarter
  const revenueLY = revenueRow?.values?.[len - 5]  ?? null; // same quarter 1 year ago
  const profit    = profitRow?.values?.[len - 1]   ?? null;
  const profitLY  = profitRow?.values?.[len - 5]   ?? null;

  return {
    period,
    revenue,   revenueYoY: yoy(revenue, revenueLY),
    profit,    profitYoY:  yoy(profit,  profitLY),
  };
}

function formatCr(val) {
  if (val == null) return '—';
  const abs = Math.abs(val);
  if (abs >= 100000) return `₹${(val / 100000).toFixed(2)}L Cr`;
  if (abs >= 1000)   return `₹${(val / 1000).toFixed(2)}K Cr`;
  return `₹${val.toFixed(0)} Cr`;
}

function formatYoY(pct) {
  if (pct == null) return '';
  return ` (${parseFloat(pct) >= 0 ? '+' : ''}${pct}% YoY)`;
}

function buildMessage(ticker, summary) {
  const lines = [`📊 *${ticker} — ${summary.period} Results*`, ''];
  if (summary.revenue != null) lines.push(`Revenue: ${formatCr(summary.revenue)}${formatYoY(summary.revenueYoY)}`);
  if (summary.profit  != null) lines.push(`Net Profit: ${formatCr(summary.profit)}${formatYoY(summary.profitYoY)}`);
  lines.push('', '_History tab updated in the app._');
  return lines.join('\n');
}

async function main() {
  const startedAt = new Date();
  console.log(`\n[earningsAlertAgent] ${startedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);

  // Fetch all watchlist + portfolio stocks with user_id
  const [{ data: wsRows }, { data: phRows }] = await Promise.all([
    supabase.from('user_stocks').select('stock_id, user_id'),
    supabase.from('portfolio_holdings').select('stock_id, user_id'),
  ]);

  // Build stock_id → Set<user_id> map
  const holdersByStock = {};
  for (const r of [...(wsRows ?? []), ...(phRows ?? [])]) {
    if (!holdersByStock[r.stock_id]) holdersByStock[r.stock_id] = new Set();
    holdersByStock[r.stock_id].add(r.user_id);
  }

  const stockIds = Object.keys(holdersByStock);
  if (!stockIds.length) { console.log('No stocks found.'); return; }

  const { data: stocks } = await supabase
    .from('stocks')
    .select('id, ticker, stock_name, earnings_history')
    .in('id', stockIds)
    .order('ticker');

  // All user telegram_chat_ids (keyed by user_id)
  const { data: alertPrefs } = await supabase
    .from('user_alert_preferences')
    .select('user_id, telegram_chat_id')
    .not('telegram_chat_id', 'is', null);

  const chatIdByUser = Object.fromEntries(
    (alertPrefs ?? []).map(p => [p.user_id, p.telegram_chat_id])
  );

  console.log(`Checking ${stocks.length} stocks for new quarterly results...\n`);

  let alerted = 0, skipped = 0, noHistory = 0, failed = 0;
  const alertedTickers = [];

  for (const stock of stocks) {
    const { ticker } = stock;
    if (!ticker) continue;

    // Skip stocks with no prior history — avoids first-fetch false positives
    if (!stock.earnings_history) {
      noHistory++;
      await sleep(500);
      continue;
    }

    // headers are oldest-first on Screener — use last element as latest period
    const storedHeaders = stock.earnings_history?.quarterly?.headers ?? [];
    const storedPeriod  = storedHeaders[storedHeaders.length - 1] ?? null;

    let scraped;
    try {
      const out = execFileSync(
        'python3',
        [path.join(__dirname, 'fetchScreenerHistory.py'), ticker],
        { encoding: 'utf8', cwd: __dirname, timeout: 35000 }
      );
      scraped = JSON.parse(out);
    } catch (e) {
      console.log(`[${ticker}] FAILED — ${e.message.slice(0, 80)}`);
      failed++;
      await sleep(3000);
      continue;
    }

    const scrapedHeaders = scraped?.quarterly?.headers ?? [];
    const newPeriod      = scrapedHeaders[scrapedHeaders.length - 1] ?? null;
    if (!newPeriod || newPeriod === storedPeriod) {
      process.stdout.write(`[${ticker}] up-to-date (${newPeriod ?? 'no data'})\n`);
      skipped++;
      await sleep(2000);
      continue;
    }

    console.log(`[${ticker}] NEW period: ${storedPeriod ?? 'none'} → ${newPeriod}`);

    // Dedup: has this period already been alerted for this stock (any user)?
    const alertType = `earnings_q_${newPeriod.replace(/\s+/g, '_')}`;
    const { data: existingAlert } = await supabase
      .from('notifications_sent')
      .select('id')
      .eq('stock_id', stock.id)
      .eq('alert_type', alertType)
      .limit(1);

    if (existingAlert?.length) {
      console.log(`[${ticker}] ${newPeriod} already alerted — skipping`);
      skipped++;
      await sleep(1000);
      continue;
    }

    // Update DB with full new history
    const { error: dbErr } = await supabase
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

    if (dbErr) {
      console.log(`[${ticker}] DB write failed: ${dbErr.message}`);
      failed++;
      await sleep(2000);
      continue;
    }

    // Targeted users: only holders of this stock with Telegram linked
    const holderUserIds = [...(holdersByStock[stock.id] ?? [])];
    const targets = holderUserIds
      .map(uid => ({ uid, chatId: chatIdByUser[uid] }))
      .filter(t => t.chatId);

    // Insert dedup rows before sending (prevents double-send if Telegram fails partway)
    if (targets.length) {
      await supabase.from('notifications_sent').insert(
        targets.map(t => ({ user_id: t.uid, stock_id: stock.id, alert_type: alertType }))
      );
    }

    // Send targeted Telegram notification
    const summary = extractResultsSummary(scraped);
    if (summary && targets.length) {
      const msg = buildMessage(ticker, summary);
      await sendToMany(targets.map(t => t.chatId), msg);
      console.log(`[${ticker}] Notified ${targets.length} user(s) — ${newPeriod} | Rev: ${formatCr(summary.revenue)} | PAT: ${formatCr(summary.profit)}`);
    } else if (!targets.length) {
      console.log(`[${ticker}] DB updated — no Telegram users to notify`);
    } else {
      console.log(`[${ticker}] DB updated — could not extract P&L from Screener rows`);
    }

    alerted++;
    alertedTickers.push(ticker);
    await sleep(3000);
  }

  const durationSecs = Math.round((Date.now() - startedAt.getTime()) / 1000);
  const summary = `Alerted: ${alerted}, Up-to-date: ${skipped}, No history: ${noHistory}, Failed: ${failed} — ${durationSecs}s`;
  console.log(`\n[earningsAlertAgent] Done — ${summary}`);

  await supabase.from('agent_reports').insert({
    agent_name: 'earnings_alert',
    status:     failed > 0 ? 'warning' : 'ok',
    summary,
    report:     { alerted: alertedTickers, up_to_date: skipped, no_history: noHistory, failed, total: stocks.length, duration_secs: durationSecs },
    ran_at:     startedAt.toISOString(),
  });
}

main().catch(err => { console.error('[earningsAlertAgent] Fatal:', err.message); process.exit(1); });
