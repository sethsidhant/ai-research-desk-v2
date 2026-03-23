// stockWatcher.js — alerts when any watchlist stock moves ±5%, ±10%, ±15% etc intraday
require('dotenv').config({ path: '../.env.local' });

const { createClient } = require('@supabase/supabase-js');
const { quoteMultiple } = require('./kiteClient');
const { sendAlert }     = require('./telegramAlert');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const THRESHOLD_PCT     = 5.0;   // alert every 5% step
const POLL_INTERVAL_MS  = 60000;
const REFRESH_STOCKS_MS = 5 * 60 * 1000;

// { ticker: { instrumentKey, prevClose, alerted: { up: step, down: step } } }
let watchlist = {};
let initialized = false;

async function loadWatchlist() {
  try {
    const { data } = await supabase
      .from('user_stocks')
      .select('stocks(ticker, instrument_token)');

    const updated = {};
    for (const row of data ?? []) {
      const s = row.stocks;
      if (!s?.ticker || !s?.instrument_token) continue;
      const key = `NSE:${s.ticker}`;
      updated[s.ticker] = {
        instrumentKey: key,
        alerted: watchlist[s.ticker]?.alerted ?? { up: 0, down: 0 },
      };
    }
    watchlist = updated;
    console.log(`[stockWatcher] Watching ${Object.keys(watchlist).length} stocks`);
  } catch (err) {
    console.error('[stockWatcher] Load watchlist error:', err.message);
  }
}

function isMarketHours() {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day = ist.getDay();
  if (day === 0 || day === 6) return false;
  const mins = ist.getHours() * 60 + ist.getMinutes();
  return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
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

      const last      = d.last_price ?? 0;
      const prevClose = d.ohlc?.close ?? 0;
      if (!prevClose) continue;
      const changePct = ((last - prevClose) / prevClose) * 100;

      const step = Math.floor(Math.abs(changePct) / THRESHOLD_PCT);
      if (step === 0) continue;

      const dir = changePct >= 0 ? 'up' : 'down';
      if (watchlist[ticker].alerted[dir] >= step) continue;

      watchlist[ticker].alerted[dir] = step;
      if (!initialized) continue; // seed state on first poll without alerting

      const arrow = dir === 'up' ? '🚀' : '🔻';
      const sign  = dir === 'up' ? '+' : '';
      await sendAlert(`${arrow} *${ticker}* ${sign}${changePct.toFixed(2)}% today\n₹${prevClose.toLocaleString('en-IN')} → ₹${last.toLocaleString('en-IN')}`);
      console.log(`[stockWatcher] Alert: ${ticker} ${sign}${changePct.toFixed(2)}%`);
    }
    if (!initialized) initialized = true;
  } catch (err) {
    console.error('[stockWatcher] Poll error:', err.message);
  }
}

async function start() {
  await loadWatchlist();
  resetAtMidnight();
  setInterval(loadWatchlist, REFRESH_STOCKS_MS);
  poll();
  setInterval(poll, POLL_INTERVAL_MS);
  console.log('[stockWatcher] Started — alerting at ±5% steps during market hours');
}

module.exports = { start };
