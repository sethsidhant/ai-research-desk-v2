// trumpWatcher.js — monitors Trump posts via Telegram MTProto (gramjs)
// Requires: TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_PHONE in .env.local
// Setup: get API credentials from https://my.telegram.org
require('dotenv').config({ path: '../.env.local' });

const READY = !!(
  process.env.TELEGRAM_API_ID &&
  process.env.TELEGRAM_API_HASH &&
  process.env.TELEGRAM_PHONE
);

function start() {
  if (!READY) {
    console.log('[trumpWatcher] Skipped — TELEGRAM_API_ID/HASH/PHONE not configured yet');
    return;
  }
  // Full implementation added once credentials are available
  console.log('[trumpWatcher] Credentials found — ready to implement');
}

module.exports = { start };
