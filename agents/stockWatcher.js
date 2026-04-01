// stockWatcher.js — alerts each user when their watchlist stock moves ±5%, ±10%, ±15% etc intraday
// Also flushes live volume + RSI to daily_history / daily_scores every 5 min during market hours.
require('dotenv').config({ path: '../.env.local' });

const { quoteMultiple } = require('./kiteClient');
const { sendToMany }    = require('./telegramAlert');
const userCache         = require('./userCache');
const { createClient }  = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const THRESHOLD_PCT     = 5.0;
const POLL_INTERVAL_MS  = 60000;
const REFRESH_STOCKS_MS = 5 * 60 * 1000;
const FLUSH_INTERVAL_MS = 5 * 60 * 1000;

// ── RSI (Wilder's smoothed, matches TradingView) ──────────────────────────────
function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) avgGain += diff; else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff >= 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? Math.abs(diff) : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return Math.round(100 - (100 / (1 + avgGain / avgLoss)));
}

// ── State ─────────────────────────────────────────────────────────────────────
// { ticker: { instrumentKey, stockId, alerted: { up, down }, chatIds } }
let watchlist   = {};
let initialized = false;

const latestVolumes = {};   // { ticker: volume }
const latestRsi     = {};   // { ticker: rsi }
let   closesCache   = {};   // { ticker: number[] } — last 30 EOD closes, chronological

// ── Closes cache (needed for live RSI) ───────────────────────────────────────
async function loadClosesCache() {
  const tickers  = Object.keys(watchlist);
  const stockIds = tickers.map(t => watchlist[t]?.stockId).filter(Boolean);
  if (!stockIds.length) return;

  const { data } = await supabase
    .from('daily_history')
    .select('stock_id, date, closing_price')
    .in('stock_id', stockIds)
    .not('closing_price', 'is', null)
    .order('date', { ascending: false })
    .limit(30 * stockIds.length);

  const byStockId = {};
  for (const row of data ?? []) {
    if (!byStockId[row.stock_id]) byStockId[row.stock_id] = [];
    if (byStockId[row.stock_id].length < 30) byStockId[row.stock_id].push(row.closing_price);
  }

  const updated = {};
  for (const ticker of tickers) {
    const stockId = watchlist[ticker]?.stockId;
    if (stockId && byStockId[stockId]) {
      updated[ticker] = byStockId[stockId].reverse(); // oldest → newest
    }
  }
  closesCache = updated;
  console.log(`[stockWatcher] Closes cache loaded for ${Object.keys(closesCache).length} stocks`);
}

// ── Watchlist ─────────────────────────────────────────────────────────────────
function loadWatchlist() {
  try {
    const rows         = userCache.getUserStocks();
    const chatIdByUser = userCache.getChatIdByUser();

    const updated = {};
    for (const row of rows) {
      const s = row.stocks;
      if (!s?.ticker || !s?.instrument_token) continue;
      if (!updated[s.ticker]) {
        updated[s.ticker] = {
          instrumentKey: `NSE:${s.ticker}`,
          stockId:       s.id,
          alerted: watchlist[s.ticker]?.alerted ?? { up: 0, down: 0 },
          chatIds: new Set(),
        };
      }
      const chatId = chatIdByUser[row.user_id];
      if (chatId) updated[s.ticker].chatIds.add(chatId);
    }
    for (const ticker of Object.keys(updated)) {
      updated[ticker].chatIds = [...updated[ticker].chatIds];
    }
    watchlist = updated;
    console.log(`[stockWatcher] Watching ${Object.keys(watchlist).length} stocks`);
    // Reload closes for any newly added stocks
    loadClosesCache().catch(e => console.error('[stockWatcher] Closes cache reload error:', e.message));
  } catch (err) {
    console.error('[stockWatcher] Load watchlist error:', err.message);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function isMarketHours() {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day = ist.getDay();
  if (day === 0 || day === 6) return false;
  const mins = ist.getHours() * 60 + ist.getMinutes();
  return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
}

function getISTDate() {
  return new Date().toLocaleString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 10);
}

function resetAtMidnight() {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const msToMidnight = (24 * 60 * 60 * 1000)
    - (ist.getHours() * 3600 + ist.getMinutes() * 60 + ist.getSeconds()) * 1000;
  setTimeout(() => {
    for (const ticker of Object.keys(watchlist)) {
      watchlist[ticker].alerted = { up: 0, down: 0 };
    }
    console.log('[stockWatcher] Alert thresholds reset for new day');
    resetAtMidnight();
  }, msToMidnight);
}

// ── Poll (every 60s during market hours) ─────────────────────────────────────
async function poll() {
  if (!isMarketHours()) return;
  const tickers = Object.keys(watchlist);
  if (!tickers.length) return;

  try {
    const keys = tickers.map(t => watchlist[t].instrumentKey);
    const data = await quoteMultiple(keys);

    for (const ticker of tickers) {
      const d = data[watchlist[ticker].instrumentKey];
      if (!d) continue;

      // Capture volume for breakout card
      if (d.volume) latestVolumes[ticker] = d.volume;

      // Compute live RSI using EOD closes + today's live price
      const closes = closesCache[ticker];
      if (closes?.length >= 15 && d.last_price) {
        const rsi = calculateRSI([...closes, d.last_price]);
        if (rsi !== null) latestRsi[ticker] = rsi;
      }

      // Price move alerts
      const last      = d.last_price ?? 0;
      const prevClose = d.ohlc?.close ?? 0;
      if (!prevClose) continue;
      const changePct = ((last - prevClose) / prevClose) * 100;

      const step = Math.floor(Math.abs(changePct) / THRESHOLD_PCT);
      if (step === 0) continue;

      const dir = changePct >= 0 ? 'up' : 'down';
      if (watchlist[ticker].alerted[dir] >= step) continue;
      watchlist[ticker].alerted[dir] = step;
      if (!initialized) continue;

      const chatIds = watchlist[ticker].chatIds;
      if (!chatIds.length) continue;

      const arrow = dir === 'up' ? '🚀' : '🔻';
      const sign  = dir === 'up' ? '+' : '';
      const msg   = `${arrow} *${ticker}* ${sign}${changePct.toFixed(2)}% today\n₹${prevClose.toLocaleString('en-IN')} → ₹${last.toLocaleString('en-IN')}`;
      await sendToMany(chatIds, msg);
      console.log(`[stockWatcher] Alert: ${ticker} ${sign}${changePct.toFixed(2)}% → ${chatIds.length} user(s)`);
    }
    if (!initialized) initialized = true;
  } catch (err) {
    console.error('[stockWatcher] Poll error:', err.message);
  }
}

// ── Flush live volume + RSI to DB (every 5 min during market hours) ───────────
async function flushLiveData() {
  if (!isMarketHours()) return;
  const today   = getISTDate();
  const tickers = Object.keys(watchlist);

  // Volume → daily_history
  const volRows = tickers
    .filter(t => watchlist[t]?.stockId && latestVolumes[t] != null)
    .map(t => ({ stock_id: watchlist[t].stockId, date: today, volume: latestVolumes[t] }));

  if (volRows.length) {
    const { error } = await supabase
      .from('daily_history')
      .upsert(volRows, { onConflict: 'stock_id,date', ignoreDuplicates: false });
    if (error) console.error('[stockWatcher] Volume flush error:', error.message);
    else console.log(`[stockWatcher] Volume flushed for ${volRows.length} stocks`);
  }

  // RSI → daily_scores
  const rsiRows = tickers
    .filter(t => watchlist[t]?.stockId && latestRsi[t] != null)
    .map(t => ({
      stock_id:   watchlist[t].stockId,
      date:       today,
      rsi:        latestRsi[t],
      rsi_signal: latestRsi[t] <= 30 ? 'oversold' : latestRsi[t] >= 70 ? 'overbought' : null,
    }));

  if (rsiRows.length) {
    const { error } = await supabase
      .from('daily_scores')
      .upsert(rsiRows, { onConflict: 'stock_id,date', ignoreDuplicates: false });
    if (error) console.error('[stockWatcher] RSI flush error:', error.message);
    else console.log(`[stockWatcher] RSI flushed for ${rsiRows.length} stocks`);
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
async function start() {
  await userCache.ensureLoaded();
  loadWatchlist();
  await loadClosesCache();
  resetAtMidnight();
  setInterval(loadWatchlist, REFRESH_STOCKS_MS);
  poll();
  setInterval(poll, POLL_INTERVAL_MS);
  setInterval(flushLiveData, FLUSH_INTERVAL_MS);
  console.log('[stockWatcher] Started — price alerts ±5%, volume + RSI flush every 5 min');
}

module.exports = { start };
