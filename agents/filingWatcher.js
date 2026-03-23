// filingWatcher.js — polls BSE for new filings on watchlist stocks every 10 min, 24/7
require('dotenv').config({ path: '../.env.local' });

const { createClient } = require('@supabase/supabase-js');
const { sendAlert }     = require('./telegramAlert');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const POLL_INTERVAL_MS  = 10 * 60 * 1000; // 10 min
const REFRESH_STOCKS_MS = 15 * 60 * 1000; // 15 min

let bseCodes   = {};  // { bseCode: ticker }
const seenIds  = new Set();
let initialLoad = true;

async function loadBSECodes() {
  try {
    const { data } = await supabase
      .from('user_stocks')
      .select('stocks(ticker, bse_code)');

    bseCodes = {};
    for (const row of data ?? []) {
      const s = row.stocks;
      if (s?.bse_code) bseCodes[String(parseInt(s.bse_code))] = s.ticker;
    }
    console.log(`[filingWatcher] Watching ${Object.keys(bseCodes).length} stocks with BSE codes`);
  } catch (err) {
    console.error('[filingWatcher] Load error:', err.message);
  }
}

async function poll() {
  if (!Object.keys(bseCodes).length) return;
  try {
    // BSE announcements API — returns recent filings across all listed companies
    const res = await fetch(
      'https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w?strCat=-1&strPrevDate=&strScrip=&strSearch=P&strToDate=&strType=C&subcategory=-1',
      {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.bseindia.com/' },
        signal: AbortSignal.timeout(15000),
      }
    );
    if (!res.ok) return;
    const json = await res.json();
    const filings = json.Table ?? [];

    for (const f of filings) {
      const scrip   = String(parseInt(f.SCRIP_CD ?? '0'));
      const id      = f.NEWSID ?? f.DT_TM ?? `${scrip}-${f.HEADLINE}`;
      const ticker  = bseCodes[scrip];

      if (!ticker || seenIds.has(id)) continue;
      seenIds.add(id);

      if (initialLoad) continue; // don't alert for filings already present on startup

      const headline = f.HEADLINE ?? 'New Filing';
      await sendAlert(`📋 *${ticker}* — BSE Filing\n${headline}`);
      console.log(`[filingWatcher] Alert: ${ticker} — ${headline}`);
    }

    if (initialLoad) {
      initialLoad = false;
      console.log(`[filingWatcher] Initial load done — ${seenIds.size} existing filings noted`);
    }
  } catch (err) {
    console.error('[filingWatcher] Poll error:', err.message);
  }
}

async function start() {
  await loadBSECodes();
  setInterval(loadBSECodes, REFRESH_STOCKS_MS);
  await poll(); // initial load to seed seenIds
  setInterval(poll, POLL_INTERVAL_MS);
  console.log('[filingWatcher] Started — polling BSE every 10 min');
}

module.exports = { start };
