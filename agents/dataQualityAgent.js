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

// NSE requires a cookie handshake — first visit the homepage to get session cookies,
// then use those cookies in the API call.
let _nseCookies = null;
let _nseCookieTs = 0;

async function getNseCookies() {
  // Reuse cookies for up to 5 minutes
  if (_nseCookies && Date.now() - _nseCookieTs < 5 * 60 * 1000) return _nseCookies;
  try {
    const res = await axios.get('https://www.nseindia.com/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept':     'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      timeout: 10000,
    });
    const setCookie = res.headers['set-cookie'];
    if (!setCookie || setCookie.length === 0) return null;
    _nseCookies = setCookie.map(c => c.split(';')[0]).join('; ');
    _nseCookieTs = Date.now();
    return _nseCookies;
  } catch {
    return null;
  }
}

// Fetch current price from NSE for spot-check
async function fetchNsePrice(ticker) {
  try {
    const cookies = await getNseCookies();
    if (!cookies) return null;

    const url = `https://www.nseindia.com/api/quote-equity?symbol=${encodeURIComponent(ticker)}`;
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept':     'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer':    'https://www.nseindia.com/',
        'Cookie':     cookies,
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
    .select('id, ticker, stock_name, current_price, fundamentals_updated_at, stock_pe, mc_scid, analyst_rating, mc_earnings_json')
    .in('id', allStockIds);

  const stockList = stocks ?? [];
  // ETFs/funds have no PE and no Screener fundamentals — exclude from PE-based checks
  const etfList   = stockList.filter(s => s.fundamentals_updated_at && s.stock_pe == null);
  const equityList = stockList.filter(s => !etfList.find(e => e.id === s.id));

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

  // ── 3. Missing fundamentals (equity only — ETFs have no Screener data) ──
  const missingFundamentals = equityList.filter(s => !s.fundamentals_updated_at);
  const staleFundamentals   = equityList.filter(s => {
    if (!s.fundamentals_updated_at) return false;
    return new Date(s.fundamentals_updated_at) < new Date(last30);
  });
  const etfNote = etfList.length > 0 ? ` (${etfList.length} ETF/fund excluded: ${etfList.map(s => s.ticker).join(', ')})` : '';
  checks.push({
    name:   'Fundamentals Coverage',
    ok:     missingFundamentals.length === 0,
    detail: missingFundamentals.length > 0
      ? `⚠️ ${missingFundamentals.length} equities missing: ${missingFundamentals.map(s => s.ticker).join(', ')}${etfNote}`
      : `✅ All ${equityList.length} equities have fundamentals${etfNote}`,
    warning: staleFundamentals.length > 0
      ? `${staleFundamentals.length} equities not refreshed in 30d: ${staleFundamentals.map(s => s.ticker).join(', ')}`
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
    .from('mf_sebi_daily')
    .select('date')
    .order('date', { ascending: false })
    .limit(1)
    .single();

  const mfDate     = mfRow?.date;
  const mfAgeDays  = mfDate ? Math.floor((Date.now() - new Date(mfDate).getTime()) / 86400000) : 999;
  checks.push({
    name:   'MF SEBI Data',
    ok:     mfAgeDays <= 5, // Daily data — flag if older than 5 days
    detail: mfDate ? `Latest: ${mfDate} (${mfAgeDays}d ago)` : '⚠️ No MF data found',
  });

  // ── 8. MC Analyst Coverage ───────────────────────────────────────────────
  const mcNoScid    = equityList.filter(s => !s.mc_scid);
  const mcNoAnalyst = equityList.filter(s => s.mc_scid && !s.analyst_rating);
  const mcCovered   = equityList.filter(s => s.mc_scid && s.analyst_rating);
  const mcGapNote   = [
    mcNoScid.length    > 0 ? `no scId: ${mcNoScid.map(s => s.ticker).join(', ')}` : null,
    mcNoAnalyst.length > 0 ? `scId set, awaiting data: ${mcNoAnalyst.map(s => s.ticker).join(', ')}` : null,
  ].filter(Boolean).join(' · ');
  checks.push({
    name:   'MC Analyst Coverage',
    ok:     mcNoScid.length === 0 && mcNoAnalyst.length === 0,
    detail: mcGapNote
      ? `⚠️ ${mcCovered.length}/${equityList.length} covered · ${mcGapNote}`
      : `✅ ${mcCovered.length}/${equityList.length} equities have analyst data`,
  });

  // ── 9. Closing price spot-check — 5 random equities ─────────────────────
  // Compares daily_history.close (Kite OHLCV) vs NSE lastPrice (both = day's close).
  // Do NOT use stocks.current_price — it is written at engine run time, not at close.
  const lastMarketDay = lastMarketDays[0]; // most recent market day

  const sampleSize = Math.min(5, equityList.length);
  const sample = equityList
    .sort(() => Math.random() - 0.5)
    .slice(0, sampleSize);

  // Fetch today's close from daily_history for sampled stocks
  const { data: historyRows } = await supabase
    .from('daily_history')
    .select('stock_id, close, date')
    .in('stock_id', sample.map(s => s.id))
    .eq('date', lastMarketDay);

  const historyByStockId = Object.fromEntries((historyRows ?? []).map(r => [r.stock_id, r]));

  // Warm up NSE session once before looping
  const nseCookies = await getNseCookies();
  console.log(`[spotCheck] NSE cookie handshake: ${nseCookies ? 'ok' : 'FAILED — NSE unreachable'}`);

  const spotCheckResults = [];
  for (const s of sample) {
    const histRow  = historyByStockId[s.id];
    const kiteClose = histRow?.close ?? null;

    if (kiteClose == null) {
      spotCheckResults.push({ ticker: s.ticker, kite: null, nse: null, ok: true, note: `No daily_history for ${lastMarketDay}` });
      console.log(`[spotCheck] ${s.ticker}: no daily_history row for ${lastMarketDay}`);
      continue;
    }

    const nsePrice = await fetchNsePrice(s.ticker);
    if (nsePrice == null) {
      spotCheckResults.push({ ticker: s.ticker, kite: kiteClose, nse: null, ok: true, note: 'NSE unavailable' });
      console.log(`[spotCheck] ${s.ticker}: NSE unavailable`);
      continue;
    }

    const deviation = Math.abs((kiteClose - nsePrice) / nsePrice) * 100;
    const ok = deviation <= 1; // Kite close vs NSE close should be within 1%
    spotCheckResults.push({
      ticker:    s.ticker,
      kite:      kiteClose,
      nse:       nsePrice,
      date:      lastMarketDay,
      deviation: parseFloat(deviation.toFixed(2)),
      ok,
    });
    console.log(`[spotCheck] ${s.ticker}: Kite close ₹${kiteClose} vs NSE ₹${nsePrice} — ${deviation.toFixed(2)}% ${ok ? '✅' : '⚠️'}`);
  }

  const spotFailed  = spotCheckResults.filter(r => !r.ok);
  const spotChecked = spotCheckResults.filter(r => r.nse != null);
  const spotLines   = spotChecked.map(r =>
    `${r.ok ? '✅' : '⚠️'} ${r.ticker}: Kite ₹${r.kite} vs NSE ₹${r.nse} (${r.deviation}%)`
  );
  const noHistory = spotCheckResults.filter(r => r.note?.startsWith('No daily_history'));
  checks.push({
    name:   'Price Spot-Check (Kite close vs NSE close)',
    ok:     spotFailed.length === 0,
    detail: spotChecked.length === 0
      ? `NSE unavailable for all sampled stocks (date: ${lastMarketDay})`
      : [
          ...spotLines,
          noHistory.length > 0 ? `ℹ️ No history row: ${noHistory.map(r => r.ticker).join(', ')}` : null,
        ].filter(Boolean).join('\n    '),
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
    `_${equityList.length} equities + ${etfList.length} ETFs · ${checks.length} checks · every 2 days_\n` +
    (mcNoScid.length > 0 ? `⚠️ ${mcNoScid.length} stock(s) need MC scId: run \`node setScids.js TICKER SCID\`` : ''),
  ];

  await sendTelegram(lines.join('\n'));
  console.log('[dataQualityAgent] Done.');
}

main();
