// Shared Telegram sender for all watchers
require('dotenv').config({ path: '../.env.local' });

const TOKEN        = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;

async function sendToUser(chatId, text) {
  if (!TOKEN || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    });
  } catch (err) {
    console.error(`[telegram] Send error to ${chatId}:`, err.message);
  }
}

// Send to a list of chat IDs sequentially
async function sendToMany(chatIds, text) {
  for (const chatId of chatIds) {
    await sendToUser(chatId, text);
  }
}

// Admin broadcast — used for index alerts and failures
async function sendAlert(text) {
  await sendToUser(ADMIN_CHAT_ID, text);
}

module.exports = { sendAlert, sendToUser, sendToMany };
