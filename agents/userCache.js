// userCache.js — shared in-memory cache for user preferences and watchlist stocks
// Reloads from Supabase every 5 minutes. All watchers read from this instead of
// querying Supabase independently — reduces DB calls from ~4× per cycle to 1×.
require('dotenv').config({ path: '../.env.local' });

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const REFRESH_MS = 5 * 60 * 1000; // 5 minutes

// Raw rows from DB
let _prefs      = []; // user_alert_preferences rows (all columns)
let _userStocks = []; // user_stocks rows with stocks joined

let _loaded = false;
let _loadPromise = null;

async function reload() {
  try {
    const [prefsRes, stocksRes] = await Promise.all([
      supabase.from('user_alert_preferences').select('*'),
      supabase.from('user_stocks').select('user_id, stocks(id, ticker, stock_name, instrument_token, bse_code)'),
    ]);

    if (prefsRes.error)  console.error('[userCache] Prefs error:', prefsRes.error.message);
    else _prefs = prefsRes.data ?? [];

    if (stocksRes.error) console.error('[userCache] Stocks error:', stocksRes.error.message);
    else _userStocks = stocksRes.data ?? [];

    _loaded = true;
    console.log(`[userCache] Refreshed — ${_prefs.length} user prefs, ${_userStocks.length} watchlist rows`);
  } catch (err) {
    console.error('[userCache] Refresh error:', err.message);
  }
}

// Ensure cache is populated before first use (call with await in watcher start())
async function ensureLoaded() {
  if (_loaded) return;
  if (!_loadPromise) _loadPromise = reload().then(() => { _loadPromise = null; });
  return _loadPromise;
}

// ── Accessors ────────────────────────────────────────────────────────────────

/** All user_alert_preferences rows */
function getPrefs() { return _prefs; }

/** All user_stocks rows (each has .user_id and .stocks object) */
function getUserStocks() { return _userStocks; }

/** Map of user_id → telegram_chat_id for users who have linked Telegram */
function getChatIdByUser() {
  const map = {};
  for (const p of _prefs) {
    if (p.telegram_chat_id) map[p.user_id] = p.telegram_chat_id;
  }
  return map;
}

/** Flat list of all telegram_chat_ids for users who have linked Telegram */
function getAllChatIds() {
  return _prefs.filter(p => p.telegram_chat_id).map(p => p.telegram_chat_id);
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

function start() {
  reload();
  setInterval(reload, REFRESH_MS);
}

module.exports = { start, reload, ensureLoaded, getPrefs, getUserStocks, getChatIdByUser, getAllChatIds };
