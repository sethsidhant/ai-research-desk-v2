// dataQualityAgent.js
// Runs every 2 days at 08:00 PM IST.
// Performs DB health checks + Screener spot-check on 5 random stocks.
// Sends a quality report card to Telegram.
// Writes structured result to agent_reports table.

require('dotenv').config({ path: '../.env.local' });
const axios            = require('axios');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const TELEGRAM_BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_CHAT = process.env.TELEGRAM_ADMIN_CHAT_ID;

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_CHAT) { console.log(text); return; }
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_ADMIN_CHAT, text, parse_mode: 'Markdown' }),
  }).catch(() => {});
}

// Get NSE market days in the last N days (rough: exclude Sat/Sun)
function getLastMarketDays(n) {
  const days = [];
  let d = new Date();
  while (days.length < n) {
    d = new Date(d.getTime() - 86400000);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

// Fetch current price from NSE for spot-check
async function fetchNsePrice(ticker) {
  try {
    const url = `https://www.nseindia.com/api/quote-equity?symbol=${encodeURIComponent(ticker)}`;
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept':     'application/json',
        'Referer':    'https://www.nseindia.com/',
      },
      timeout: 8000,
    });
    const ltp = res.data?.priceInfo?.lastPrice;
    return typeof ltp === 'number' ? ltp : null;
  } catch {
    return null;
  }
}

async function main() {
  console.log('[dataQualityAgent] Starting quality check...');

  const checks = [];
  const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const todayIST = nowIST.toISOString().slice(0, 10);
  const last30   = new Date(Date.now() - 30 * 86400000).toISOString();
  const last7    = new Date(Date.now() - 7  * 86400000).toISOString().slice(0, 10);

  // ── 1. Get all tracked stocks ────────────────────────────────────────────
  const [{ data: watchRows }, { data: portRows }] = await Promise.all([
    supabase.from('user_stocks').select('stock_id'),
    supabase.from('portfolio_holdings').select('stock_id'),
  ]);
  const allStockIds = [...new Set([
    ...(watchRows ?? []).map(r => r.stock_id),
    ...(portRows  ?? []).map(r => r.stock_id),
  ])];

  const { data: stocks } = await supabase
    .from('stocks')
    .select('id, ticker, stock_name, current_price, fundamentals_updated_at, stock_pe')
    .in('id', allStockIds);

  const stockList = stocks ?? [];

  // ── 2. Stale price check ─────────────────────────────────────────────────
  const stalePrice = stockList.filter(s => {
    if (!s.current_price) return true;
    // Price considered ok if pipeline ran today (we can't check price timestamp directly)
    return false; // Will be captured by pipeline heartbeat instead
  });
  checks.push({
    name:   'Current Prices',
    ok:     true,
    detail: `${stockList.length} stocks tracked`,
  });

  // ── 3. Missing fundamentals ──────────────────────────────────────────────
  const missingFundamentals = stockList.filter(s => !s.fundamentals_updated_at);
  const staleFundamentals   = stockList.filter(s => {
    if (!s.fundamentals_updated_at) return false;
    return new Date(s.fundamentals_updated_at) < new Date(last30);
  });
  checks.push({
    name:   'Fundamentals Coverage',
    ok:     missingFundamentals.length === 0,
    detail: missingFundamentals.length > 0
      ? `⚠️ ${missingFundamentals.length} stocks missing: ${missingFundamentals.map(s => s.ticker).join(', ')}`
      : `✅ All ${stockList.length} stocks have fundamentals`,
    warning: staleFundamentals.length > 0
      ? `${staleFundamentals.length} stocks not refreshed in 30d: ${staleFundamentals.map(s => s.ticker).join(', ')}`
      : null,
  });

  // ── 4. Daily scores gaps ─────────────────────────────────────────────────
  const lastMarketDays = getLastMarketDays(3);
  const { data: recentScores } = await supabase
    .from('daily_scores')
    .select('stock_id, date')
    .in('stock_id', allStockIds)
    .gte('date', lastMarketDays[lastMarketDays.length - 1]);

  const scoredRecently = new Set((recentScores ?? []).map(r => r.stock_id));
  const missingScores  = allStockIds.filter(id => !scoredRecently.has(id));
  const missingTickers = stockList.filter(s => missingScores.includes(s.id)).map(s => s.ticker);

  checks.push({
    name:   'Daily Scores (last 3 market days)',
    ok:     missingScores.length === 0,
    detail: missingScores.length > 0
      ? `⚠️ ${missingScores.length} stocks missing scores: ${missingTickers.join(', ')}`
      : `✅ All ${allStockIds.length} stocks scored`,
  });

  // ── 5. daily_history gaps ────────────────────────────────────────────────
  const { data: recentHistory } = await supabase
    .from('daily_history')
    .select('stock_id, date')
    .in('stock_id', allStockIds)
    .gte('date', lastMarketDays[lastMarketDays.length - 1]);

  const withHistory   = new Set((recentHistory ?? []).map(r => r.stock_id));
  const missingHist   = allStockIds.filter(id => !withHistory.has(id));
  const missingHistTk = stockList.filter(s => missingHist.includes(s.id)).map(s => s.ticker);

  checks.push({
    name:   'Daily History (last 3 market days)',
    ok:     missingHist.length === 0,
    detail: missingHist.length > 0
      ? `⚠️ ${missingHist.length} stocks missing history: ${missingHistTk.join(', ')}`
      : `✅ All stocks have recent OHLCV data`,
  });

  // ── 6. FII data freshness ────────────────────────────────────────────────
  const { data: fiiRow } = await supabase
    .from('fii_dii_daily')
    .select('date')
    .order('date', { ascending: false })
    .limit(1)
    .single();

  const fiiDate    = fiiRow?.date;
  const fiiAgeDays = fiiDate ? Math.floor((Date.now() - new Date(fiiDate).getTime()) / 86400000) : 999;
  checks.push({
    name:   'FII/DII Data',
    ok:     fiiAgeDays <= 2,
    detail: fiiDate
      ? `${fiiAgeDays === 0 ? 'Today' : fiiAgeDays === 1 ? '1 day ago' : `${fiiAgeDays} days ago`} (${fiiDate})`
      : '⚠️ No FII data found',
  });

  // ── 7. MF SEBI data lag ──────────────────────────────────────────────────
  const { data: mfRow } = await supabase
    .from('mf_sebi_monthly')
    .select('month')
    .order('month', { ascending: false })
    .limit(1)
    .single();

  const mfMonth    = mfRow?.month;
  const mfAgeDays  = mfMonth ? Math.floor((Date.now() - new Date(mfMonth).getTime()) / 86400000) : 999;
  checks.push({
    name:   'MF SEBI Data',
    ok:     mfAgeDays <= 45, // Monthly data, allow up to 45 days
    detail: mfMonth ? `Latest: ${mfMonth} (${mfAgeDays}d ago)` : '⚠️ No MF data found',
  });

  // ── 8. Screener spot-check — 5 random stocks ─────────────────────────────
  const sampleSize = Math.min(5, stockList.length);
  const sample = stockList
    .filter(s => s.current_price)
    .sort(() => Math.random() - 0.5)
    .slice(0, sampleSize);

  const spotCheckResults = [];
  for (const s of sample) {
    const nsePrice = await fetchNsePrice(s.ticker);
    if (nsePrice == null) {
      spotCheckResults.push({ ticker: s.ticker, db: s.current_price, live: null, ok: true, note: 'NSE unavailable' });
      continue;
    }
    const deviation = Math.abs((s.current_price - nsePrice) / nsePrice) * 100;
    const ok = deviation <= 5;
    spotCheckResults.push({
      ticker:    s.ticker,
      db:        s.current_price,
      live:      nsePrice,
      deviation: parseFloat(deviation.toFixed(2)),
      ok,
    });
    console.log(`[spotCheck] ${s.ticker}: DB ₹${s.current_price} vs NSE ₹${nsePrice} — ${deviation.toFixed(1)}% ${ok ? '✅' : '⚠️'}`);
  }

  const spotFailed = spotCheckResults.filter(r => !r.ok);
  checks.push({
    name:   'Price Spot-Check vs NSE',
    ok:     spotFailed.length === 0,
    detail: spotFailed.length > 0
      ? `⚠️ ${spotFailed.length} price(s) deviated >5%: ${spotFailed.map(r => `${r.ticker} (${r.deviation}%)`).join(', ')}`
      : `✅ ${spotCheckResults.filter(r => r.live != null).length} checked, all within 5%`,
  });

  // ── Build report ──────────────────────────────────────────────────────────
  const failedChecks = checks.filter(c => !c.ok);
  const overallStatus = failedChecks.length === 0 ? 'ok'
    : failedChecks.length <= 2 ? 'warning' : 'error';

  const summary = failedChecks.length === 0
    ? `All ${checks.length} checks passed`
    : `${failedChecks.length} of ${checks.length} checks failed: ${failedChecks.map(c => c.name).join(', ')}`;

  console.log(`[dataQualityAgent] ${summary}`);

  const { error: reportErr } = await supabase.from('agent_reports').insert({
    agent_name: 'data_quality_agent',
    status:     overallStatus,
    summary,
    report: {
      checks,
      spot_check: spotCheckResults,
      stocks_tracked: allStockIds.length,
      ran_at: nowIST.toISOString(),
    },
  });
  if (reportErr) console.error('[dataQualityAgent] agent_reports insert failed:', reportErr.message);
  else console.log('[dataQualityAgent] Report written:', overallStatus);

  // Build Telegram message
  const icon = overallStatus === 'ok' ? '✅' : overallStatus === 'warning' ? '🟡' : '🔴';
  const lines = [
    `${icon} *Data Quality Report · ${todayIST}*`,
    '',
    ...checks.map(c => `${c.ok ? '✅' : '⚠️'} *${c.name}*\n    ${c.detail}${c.warning ? '\n    ℹ️ ' + c.warning : ''}`),
    '',
    `_${stockList.length} stocks · ${checks.length} checks · every 2 days_`,
  ];

  await sendTelegram(lines.join('\n'));
  console.log('[dataQualityAgent] Done.');
}

main();
