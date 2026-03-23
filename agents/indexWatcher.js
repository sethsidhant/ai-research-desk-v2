// indexWatcher.js — alerts when broad indices move ±1% (each 1% step triggers once, resets midnight IST)
require('dotenv').config({ path: '../.env.local' });

const { quoteMultiple } = require('./kiteClient');
const { sendAlert }     = require('./telegramAlert');

const INDICES = [
  { key: 'NSE:NIFTY 50',    label: 'NIFTY 50',    gift: false },
  { key: 'NSE:NIFTY BANK',  label: 'BANK NIFTY',  gift: false },
  { key: 'NSE:NIFTY 500',   label: 'NIFTY 500',   gift: false },
  { key: 'NSEIX:GIFT NIFTY',label: 'GIFT NIFTY',  gift: true  },
];

const THRESHOLD_PCT    = 1.0;   // alert every 1% step
const POLL_INTERVAL_MS = 60000;

// Track highest alerted step per index: e.g. { 'NIFTY 50': { up: 1, down: 0 } }
const alerted = {};
for (const idx of INDICES) alerted[idx.label] = { up: 0, down: 0 };
let initialized = false;

function isMarketHours() {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day = ist.getDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false;
  const h = ist.getHours(), m = ist.getMinutes();
  const mins = h * 60 + m;
  return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
}

function resetAtMidnight() {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const msToMidnight = (24 * 60 * 60 * 1000)
    - (ist.getHours() * 3600 + ist.getMinutes() * 60 + ist.getSeconds()) * 1000;
  setTimeout(() => {
    for (const idx of INDICES) alerted[idx.label] = { up: 0, down: 0 };
    console.log('[indexWatcher] Alert thresholds reset for new day');
    resetAtMidnight();
  }, msToMidnight);
}

async function poll() {
  try {
    const keys    = INDICES.map(i => i.key);
    const data    = await quoteMultiple(keys);

    for (const idx of INDICES) {
      if (!idx.gift && !isMarketHours()) continue; // non-GIFT only during market hours

      const d         = data[idx.key];
      if (!d) continue;
      const last      = d.last_price ?? 0;
      const prevClose = d.ohlc?.close ?? 0;
      const change    = (d.net_change && d.net_change !== 0) ? d.net_change : (prevClose > 0 ? last - prevClose : 0);
      const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;

      const step = Math.floor(Math.abs(changePct) / THRESHOLD_PCT); // 0=<1%, 1=1-2%, 2=2-3%...
      if (step === 0) continue;

      const dir = changePct >= 0 ? 'up' : 'down';
      if (alerted[idx.label][dir] >= step) continue; // already alerted this step

      alerted[idx.label][dir] = step;
      if (!initialized) continue; // seed state on first poll without alerting

      const arrow = dir === 'up' ? '📈' : '📉';
      const sign  = dir === 'up' ? '+' : '';
      await sendAlert(`${arrow} *${idx.label}* ${sign}${changePct.toFixed(2)}% today\n${prevClose.toLocaleString('en-IN')} → ${last.toLocaleString('en-IN')}`);
      console.log(`[indexWatcher] Alert sent: ${idx.label} ${sign}${changePct.toFixed(2)}%`);
    }
    if (!initialized) {
      initialized = true;
      console.log('[indexWatcher] Initial state seeded — will alert on new moves only');
    }
  } catch (err) {
    console.error('[indexWatcher] Poll error:', err.message);
  }
}

function start() {
  console.log('[indexWatcher] Started — monitoring NIFTY 50, BANK NIFTY, NIFTY 500, GIFT NIFTY at ±1% steps');
  resetAtMidnight();
  poll();
  setInterval(poll, POLL_INTERVAL_MS);
}

module.exports = { start };
