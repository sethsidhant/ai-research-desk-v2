// filingWatcher.js — polls BSE for new filings, alerts users watching that stock
require('dotenv').config({ path: '../.env.local' });

const { createClient } = require('@supabase/supabase-js');
const { sendToMany }   = require('./telegramAlert');
const userCache        = require('./userCache');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const POLL_INTERVAL_MS  = 10 * 60 * 1000; // 10 min
const REFRESH_STOCKS_MS = 15 * 60 * 1000; // 15 min

// { bseCode: { ticker, chatIds: string[] } }
let bseMap     = {};
const seenIds  = new Set();
let initialLoad = true;

function loadBSECodes() {
  try {
    const rows  = userCache.getUserStocks();
    const prefs = userCache.getPrefs();

    // Only users with Telegram linked + filing alerts enabled
    const chatIdByUser = {};
    for (const p of prefs) {
      if (p.telegram_chat_id && p.new_filing_alert) chatIdByUser[p.user_id] = p.telegram_chat_id;
    }

    const updated = {};
    for (const row of rows) {
      const s = row.stocks;
      if (!s?.bse_code) continue;
      const code = String(parseInt(s.bse_code));

      if (!updated[code]) updated[code] = { ticker: s.ticker, stockId: s.id, chatIds: new Set() };

      const chatId = chatIdByUser[row.user_id];
      if (chatId) updated[code].chatIds.add(chatId);
    }

    // Convert Sets to arrays
    for (const code of Object.keys(updated)) {
      updated[code].chatIds = [...updated[code].chatIds];
    }

    bseMap = updated;
    console.log(`[filingWatcher] Watching ${Object.keys(bseMap).length} stocks with BSE codes`);
  } catch (err) {
    console.error('[filingWatcher] Load error:', err.message);
  }
}

async function poll() {
  if (!Object.keys(bseMap).length) return;
  try {
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
      const scrip  = String(parseInt(f.SCRIP_CD ?? '0'));
      const id     = f.NEWSID ?? f.DT_TM ?? `${scrip}-${f.HEADLINE}`;
      const entry  = bseMap[scrip];

      if (!entry || seenIds.has(id)) continue;
      seenIds.add(id);

      if (initialLoad) continue;

      const chatIds = entry.chatIds;

      const headline = f.HEADLINE ?? 'New Filing';
      const category = f.SUBCATNAME || f.CATEGORYNAME || 'Filing';
      const dt       = f.DT_TM ? f.DT_TM.replace('T', ' ').substring(0, 16) : new Date().toISOString().replace('T', ' ').substring(0, 16);
      const link     = f.NEWSID
        ? `https://www.bseindia.com/markets/MarketInfo/DispNewSearchAnnouncement.aspx?newsid=${f.NEWSID}`
        : `https://www.bseindia.com/corporates/ann.html?scrip=${scrip}&dur=TD&type=C`;

      if (chatIds.length) {
        await sendToMany(chatIds, `📋 *${entry.ticker}* — BSE Filing\n${headline}\n[View on BSE](${link})`);
        console.log(`[filingWatcher] Alert: ${entry.ticker} — ${headline} → ${chatIds.length} user(s)`);
      }

      // Write filing to DB so dashboard reflects it immediately (no wait until morning engine)
      try {
        const detectedAt  = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
        const newBlock    = `━━ LIVE FILING (detected ${detectedAt} IST) ━━\n\n[1] ${category}\n📅 ${dt}\n📌 ${headline}\n🔗 ${link}\n\n`;
        const { data: row } = await supabase.from('stocks').select('latest_headlines').eq('id', entry.stockId).single();
        const existing    = row?.latest_headlines ?? '';
        const updated     = newBlock + existing;
        const today       = new Date().toISOString().slice(0, 10);
        await supabase.from('stocks').update({ latest_headlines: updated, last_news_update: today }).eq('id', entry.stockId);
        console.log(`[filingWatcher] DB updated: ${entry.ticker} — ${headline}`);
      } catch (dbErr) {
        console.error(`[filingWatcher] DB write failed for ${entry.ticker}:`, dbErr.message);
      }
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
  await userCache.ensureLoaded();
  loadBSECodes();
  setInterval(loadBSECodes, REFRESH_STOCKS_MS);
  await poll(); // initial load to seed seenIds
  setInterval(poll, POLL_INTERVAL_MS);
  console.log('[filingWatcher] Started — polling BSE every 10 min');
}

module.exports = { start };
