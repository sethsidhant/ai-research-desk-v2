// indexWatcher.js — alerts when broad indices move ±1% steps; broadcasts to all linked users
require('dotenv').config({ path: '../.env.local' });

const { createClient } = require('@supabase/supabase-js');
const { quoteMultiple } = require('./kiteClient');
const { sendAlert, sendToMany } = require('./telegramAlert');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const INDICES = [
  { key: 'NSE:NIFTY 50',    label: 'NIFTY 50',    gift: false },
  { key: 'NSE:NIFTY BANK',  label: 'BANK NIFTY',  gift: false },
  { key: 'NSE:NIFTY 500',   label: 'NIFTY 500',   gift: false },
  { key: 'NSEIX:GIFT NIFTY',label: 'GIFT NIFTY',  gift: true  },
];

const THRESHOLD_PCT    = 1.0;
const POLL_INTERVAL_MS = 60000;
const REFRESH_USERS_MS = 5 * 60 * 1000;

const alerted = {};
for (const idx of INDICES) alerted[idx.label] = { up: 0, down: 0 };
let initialized = false;
let userChatIds = []; // all users with telegram linked

async function loadUserChats() {
  try {
    const { data } = await supabase
      .from('user_alert_preferences')
      .select('telegram_chat_id')
      .not('telegram_chat_id', 'is', null);
    userChatIds = (data ?? []).map(r => r.telegram_chat_id);
  } catch (err) {
    console.error('[indexWatcher] Load user chats error:', err.message);
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
    for (const idx of INDICES) alerted[idx.label] = { up: 0, down: 0 };
    console.log('[indexWatcher] Alert thresholds reset for new day');
    resetAtMidnight();
  }, msToMidnight);
}

async function poll() {
  try {
    const keys = INDICES.map(i => i.key);
    const data = await quoteMultiple(keys);

    for (const idx of INDICES) {
      if (!idx.gift && !isMarketHours()) continue;

      const d         = data[idx.key];
      if (!d) continue;
      const last      = d.last_price ?? 0;
      const prevClose = d.ohlc?.close ?? 0;
      const change    = (d.net_change && d.net_change !== 0) ? d.net_change : (prevClose > 0 ? last - prevClose : 0);
      const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;

      const step = Math.floor(Math.abs(changePct) / THRESHOLD_PCT);
      if (step === 0) continue;

      const dir = changePct >= 0 ? 'up' : 'down';
      if (alerted[idx.label][dir] >= step) continue;

      alerted[idx.label][dir] = step;
      if (!initialized) continue;

      const arrow = dir === 'up' ? '📈' : '📉';
      const sign  = dir === 'up' ? '+' : '';
      const msg   = `${arrow} *${idx.label}* ${sign}${changePct.toFixed(2)}% today\n${prevClose.toLocaleString('en-IN')} → ${last.toLocaleString('en-IN')}`;

      // Admin always gets index alerts; also broadcast to all linked users
      await sendAlert(msg);
      if (userChatIds.length) await sendToMany(userChatIds, msg);
      console.log(`[indexWatcher] Alert: ${idx.label} ${sign}${changePct.toFixed(2)}% → admin + ${userChatIds.length} user(s)`);
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
  loadUserChats();
  setInterval(loadUserChats, REFRESH_USERS_MS);
  resetAtMidnight();
  poll();
  setInterval(poll, POLL_INTERVAL_MS);
}

module.exports = { start };
