// technicalWatcher.js — live RSI + DMA crossover alerts per user
// RSI: checked once per day after market open using daily_scores
// DMA: polled every 5 min via Kite, alerts on intraday price crossover
require('dotenv').config({ path: '../.env.local' });

const { createClient } = require('@supabase/supabase-js');
const { quoteMultiple } = require('./kiteClient');
const { sendToMany }    = require('./telegramAlert');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const DMA_POLL_INTERVAL_MS  = 5 * 60 * 1000;  // 5 min
const REFRESH_USERS_MS      = 10 * 60 * 1000; // 10 min
const RSI_CHECK_HOUR_IST    = 10;              // check RSI at 10 AM after engine runs

// Per-stock DMA state: { instrumentKey, dma50, dma200, wasAbove50, wasAbove200, alerted50Up, alerted50Down, alerted200Up, alerted200Down }
let dmaState  = {}; // keyed by ticker
let userPrefs = []; // [{ user_id, telegram_chat_id, dma_cross_alert, rsi_oversold_threshold, rsi_overbought_threshold, stockIds: [] }]
let stockMap  = {}; // ticker -> { stockId, instrumentKey, dma50, dma200 }

let rsiAlertedDate = ''; // YYYY-MM-DD, reset daily
let dmaInitialized = false;

// ── Helpers ───────────────────────────────────────────────────────────────────

function istNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
}

function isMarketHours() {
  const ist  = istNow();
  const day  = ist.getDay();
  if (day === 0 || day === 6) return false;
  const mins = ist.getHours() * 60 + ist.getMinutes();
  return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
}

function todayIST() {
  return istNow().toISOString().slice(0, 10);
}

// ── Load user prefs + watchlists ──────────────────────────────────────────────

async function loadUsers() {
  try {
    const { data: prefs } = await supabase
      .from('user_alert_preferences')
      .select('user_id, telegram_chat_id, dma_cross_alert, rsi_oversold_threshold, rsi_overbought_threshold')
      .not('telegram_chat_id', 'is', null);

    if (!prefs?.length) { userPrefs = []; return; }

    // Load all user_stocks with instrument tokens in one query
    const { data: rows } = await supabase
      .from('user_stocks')
      .select('user_id, stocks(id, ticker, instrument_token)')
      .in('user_id', prefs.map(p => p.user_id));

    // Map user_id -> stockIds
    const userStockMap = {};
    for (const r of rows ?? []) {
      const s = r.stocks;
      if (!s?.ticker || !s?.instrument_token) continue;
      if (!userStockMap[r.user_id]) userStockMap[r.user_id] = [];
      userStockMap[r.user_id].push({ stockId: s.id, ticker: s.ticker, instrumentKey: `NSE:${s.ticker}` });
    }

    userPrefs = prefs.map(p => ({
      ...p,
      stocks: userStockMap[p.user_id] ?? [],
    })).filter(p => p.stocks.length > 0);

    console.log(`[technicalWatcher] Loaded ${userPrefs.length} user(s)`);
  } catch (err) {
    console.error('[technicalWatcher] Load users error:', err.message);
  }
}

// ── Load DMA values from daily_scores ─────────────────────────────────────────

async function loadDMAValues() {
  try {
    // Get all unique stock IDs across all users
    const allStockIds = [...new Set(userPrefs.flatMap(p => p.stocks.map(s => s.stockId)))];
    if (!allStockIds.length) return;

    const { data: scores } = await supabase
      .from('daily_scores')
      .select('stock_id, dma_50, dma_200, date')
      .in('stock_id', allStockIds)
      .order('date', { ascending: false });

    // Keep only latest score per stock
    const latestByStock = {};
    for (const s of scores ?? []) {
      if (!latestByStock[s.stock_id]) latestByStock[s.stock_id] = s;
    }

    // Rebuild stockMap
    stockMap = {};
    for (const p of userPrefs) {
      for (const s of p.stocks) {
        if (stockMap[s.ticker]) continue;
        const score = latestByStock[s.stockId];
        stockMap[s.ticker] = {
          stockId:       s.stockId,
          instrumentKey: s.instrumentKey,
          dma50:         score?.dma_50  ?? null,
          dma200:        score?.dma_200 ?? null,
        };
      }
    }

    console.log(`[technicalWatcher] DMA values loaded for ${Object.keys(stockMap).length} stock(s)`);
  } catch (err) {
    console.error('[technicalWatcher] Load DMA error:', err.message);
  }
}

// ── RSI check (once per day at 10 AM IST) ────────────────────────────────────

async function checkRSI() {
  const today = todayIST();
  if (rsiAlertedDate === today) return; // already done today
  const ist = istNow();
  if (!isMarketHours()) return;
  if (ist.getHours() < RSI_CHECK_HOUR_IST) return; // wait until 10 AM

  rsiAlertedDate = today;
  console.log('[technicalWatcher] Running RSI check...');

  try {
    for (const p of userPrefs) {
      if (!p.telegram_chat_id || !p.stocks.length) continue;

      const oversoldThreshold   = p.rsi_oversold_threshold   ?? 30;
      const overboughtThreshold = p.rsi_overbought_threshold ?? 70;

      const stockIds = p.stocks.map(s => s.stockId);
      const { data: scores } = await supabase
        .from('daily_scores')
        .select('stock_id, rsi')
        .in('stock_id', stockIds)
        .eq('date', today);

      const alerts = [];
      for (const score of scores ?? []) {
        if (score.rsi == null) continue;
        const s = p.stocks.find(x => x.stockId === score.stock_id);
        if (!s) continue;

        if (score.rsi <= oversoldThreshold) {
          alerts.push(`🟢 *${s.ticker}* RSI ${score.rsi.toFixed(0)} — oversold (<${oversoldThreshold})`)
        } else if (score.rsi >= overboughtThreshold) {
          alerts.push(`🔴 *${s.ticker}* RSI ${score.rsi.toFixed(0)} — overbought (>${overboughtThreshold})`)
        }
      }

      if (alerts.length) {
        const msg = `📊 *RSI Alert — ${today}*\n\n` + alerts.join('\n');
        await sendToMany([p.telegram_chat_id], msg);
        console.log(`[technicalWatcher] RSI alert → ${p.telegram_chat_id}: ${alerts.length} stock(s)`);
      }
    }
  } catch (err) {
    console.error('[technicalWatcher] RSI check error:', err.message);
  }
}

// ── DMA crossover check (live, every 5 min) ───────────────────────────────────

function resetDMAAlerts() {
  for (const ticker of Object.keys(dmaState)) {
    dmaState[ticker].alerted50Up   = false;
    dmaState[ticker].alerted50Down = false;
    dmaState[ticker].alerted200Up   = false;
    dmaState[ticker].alerted200Down = false;
  }
  console.log('[technicalWatcher] DMA alert flags reset for new day');
}

function resetAtMidnight() {
  const ist = istNow();
  const msToMidnight = (24 * 60 * 60 * 1000)
    - (ist.getHours() * 3600 + ist.getMinutes() * 60 + ist.getSeconds()) * 1000;
  setTimeout(() => {
    rsiAlertedDate = '';
    resetDMAAlerts();
    resetAtMidnight();
  }, msToMidnight);
}

async function checkDMA() {
  if (!isMarketHours()) return;

  const tickers = Object.keys(stockMap).filter(t => stockMap[t].dma50 || stockMap[t].dma200);
  if (!tickers.length) return;

  try {
    const keys  = tickers.map(t => stockMap[t].instrumentKey);
    const data  = await quoteMultiple(keys);

    for (const ticker of tickers) {
      const { instrumentKey, dma50, dma200 } = stockMap[ticker];
      const d = data[instrumentKey];
      if (!d?.last_price) continue;
      const price = d.last_price;

      // Init state on first poll (seed without alerting)
      if (!dmaState[ticker]) {
        dmaState[ticker] = {
          wasAbove50:    dma50  ? price > dma50  : null,
          wasAbove200:   dma200 ? price > dma200 : null,
          alerted50Up:   false, alerted50Down:  false,
          alerted200Up:  false, alerted200Down: false,
        };
        continue;
      }

      const state = dmaState[ticker];

      // Find users watching this stock with DMA alert enabled
      const chatIds = userPrefs
        .filter(p => p.dma_cross_alert !== false && p.telegram_chat_id && p.stocks.some(s => s.ticker === ticker))
        .map(p => p.telegram_chat_id);

      if (!chatIds.length) { state.wasAbove50 = dma50 ? price > dma50 : null; state.wasAbove200 = dma200 ? price > dma200 : null; continue; }

      // 50 DMA crossover
      if (dma50 && state.wasAbove50 !== null) {
        const nowAbove = price > dma50;
        if (!state.wasAbove50 && nowAbove && !state.alerted50Up) {
          state.alerted50Up = true;
          await sendToMany(chatIds, `📈 *${ticker}* crossed *above* 50D MA\n₹${price.toLocaleString('en-IN')} > ₹${dma50.toLocaleString('en-IN')}`);
          console.log(`[technicalWatcher] ${ticker} crossed above 50D → ${chatIds.length} user(s)`);
        } else if (state.wasAbove50 && !nowAbove && !state.alerted50Down) {
          state.alerted50Down = true;
          await sendToMany(chatIds, `📉 *${ticker}* crossed *below* 50D MA\n₹${price.toLocaleString('en-IN')} < ₹${dma50.toLocaleString('en-IN')}`);
          console.log(`[technicalWatcher] ${ticker} crossed below 50D → ${chatIds.length} user(s)`);
        }
        state.wasAbove50 = nowAbove;
      }

      // 200 DMA crossover
      if (dma200 && state.wasAbove200 !== null) {
        const nowAbove = price > dma200;
        if (!state.wasAbove200 && nowAbove && !state.alerted200Up) {
          state.alerted200Up = true;
          await sendToMany(chatIds, `🚀 *${ticker}* crossed *above* 200D MA\n₹${price.toLocaleString('en-IN')} > ₹${dma200.toLocaleString('en-IN')}`);
          console.log(`[technicalWatcher] ${ticker} crossed above 200D → ${chatIds.length} user(s)`);
        } else if (state.wasAbove200 && !nowAbove && !state.alerted200Down) {
          state.alerted200Down = true;
          await sendToMany(chatIds, `⚠️ *${ticker}* crossed *below* 200D MA\n₹${price.toLocaleString('en-IN')} < ₹${dma200.toLocaleString('en-IN')}`);
          console.log(`[technicalWatcher] ${ticker} crossed below 200D → ${chatIds.length} user(s)`);
        }
        state.wasAbove200 = nowAbove;
      }
    }

    if (!dmaInitialized) {
      dmaInitialized = true;
      console.log('[technicalWatcher] DMA state seeded — will alert on new crossovers only');
    }
  } catch (err) {
    console.error('[technicalWatcher] DMA poll error:', err.message);
  }
}

// ── Combined poll ─────────────────────────────────────────────────────────────

async function poll() {
  await checkRSI();
  await checkDMA();
}

// ── Start ─────────────────────────────────────────────────────────────────────

async function start() {
  await loadUsers();
  await loadDMAValues();
  resetAtMidnight();
  setInterval(loadUsers,    REFRESH_USERS_MS);
  setInterval(loadDMAValues, REFRESH_USERS_MS);
  await poll();
  setInterval(poll, DMA_POLL_INTERVAL_MS);
  console.log('[technicalWatcher] Started — RSI daily + DMA crossover every 5 min');
}

module.exports = { start };
