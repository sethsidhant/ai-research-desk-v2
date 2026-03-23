// Shared Telegram sender for all watchers
require('dotenv').config({ path: '../.env.local' });

const TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;

async function sendAlert(text) {
  if (!TOKEN || !CHAT_ID) { console.warn('[telegram] Missing TOKEN or CHAT_ID'); return; }
  try {
    await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'Markdown' }),
    });
  } catch (err) {
    console.error('[telegram] Send error:', err.message);
  }
}

module.exports = { sendAlert };
