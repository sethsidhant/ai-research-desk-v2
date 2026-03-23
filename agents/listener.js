// listener.js
// Polls Supabase every 30s for watchlist stocks that need onboarding.
// Also polls Telegram bot for /link commands to connect user accounts.

require('dotenv').config({ path: '../.env.local' });
const { execSync }     = require('child_process');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const POLL_INTERVAL_MS     = 30000;
const BOT_POLL_INTERVAL_MS = 10000;
const processing = new Set();

// ── Onboarding ────────────────────────────────────────────────────────────────

function onboard(ticker) {
  if (processing.has(ticker)) {
    console.log(`[listener] ${ticker} already processing — skipping`);
    return;
  }
  processing.add(ticker);
  console.log(`[listener] Onboarding ${ticker}...`);
  try {
    execSync(`node onboardStock.js ${ticker}`, {
      cwd: __dirname,
      stdio: 'inherit',
      timeout: 5 * 60 * 1000,
    });
    console.log(`[listener] ✓ ${ticker} done`);
  } catch (err) {
    console.error(`[listener] ✗ ${ticker} failed:`, err.message);
  } finally {
    processing.delete(ticker);
  }
}

async function poll() {
  try {
    const { data } = await supabase
      .from('user_stocks')
      .select('stocks(ticker, fundamentals_updated_at)');

    const pending = [...new Set(
      (data ?? [])
        .map(r => r.stocks)
        .filter(s => s && !s.fundamentals_updated_at)
        .map(s => s.ticker)
    )];

    console.log(`[listener] Poll: ${(data ?? []).length} watchlist entries, ${pending.length} need onboarding${pending.length ? ': ' + pending.join(', ') : ''}`)
    for (const ticker of pending) onboard(ticker);
  } catch (err) {
    console.error(`[listener] Poll error:`, err.message);
  }
}

// ── Telegram bot ──────────────────────────────────────────────────────────────

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
let botOffset   = 0;

async function botReply(chatId, text) {
  if (!BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    });
  } catch (err) {
    console.error('[bot] Reply error:', err.message);
  }
}

async function handleLinkCode(chatId, code) {
  const key = `telegram_link_${code.toUpperCase()}`;
  const { data } = await supabase.from('app_settings').select('value').eq('key', key).single();

  if (!data?.value) {
    await botReply(chatId, '❌ Invalid or expired code. Generate a new one from Settings.');
    return;
  }

  let payload;
  try { payload = JSON.parse(data.value); } catch {
    await botReply(chatId, '❌ Invalid code.');
    return;
  }

  if (new Date(payload.expires) < new Date()) {
    await botReply(chatId, '❌ Code expired. Generate a new one from Settings.');
    await supabase.from('app_settings').delete().eq('key', key);
    return;
  }

  await supabase.from('user_alert_preferences').upsert(
    { user_id: payload.user_id, telegram_chat_id: String(chatId) },
    { onConflict: 'user_id' }
  );
  await supabase.from('app_settings').delete().eq('key', key);

  await botReply(chatId, '✅ Linked! You\'ll now receive alerts for your watchlist stocks and market moves.');
  console.log(`[bot] Linked chat ${chatId} to user ${payload.user_id}`);
}

async function seedBotOffset() {
  if (!BOT_TOKEN) return;
  try {
    const res  = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?limit=1&offset=-1`);
    const json = await res.json();
    const updates = json.result ?? [];
    if (updates.length) botOffset = updates[updates.length - 1].update_id + 1;
    console.log(`[bot] Offset seeded at ${botOffset}`);
  } catch (err) {
    console.error('[bot] Seed offset error:', err.message);
  }
}

async function pollBot() {
  if (!BOT_TOKEN) return;
  try {
    const res  = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${botOffset}&limit=10&timeout=0`, { signal: AbortSignal.timeout(8000) });
    const json = await res.json();
    for (const update of json.result ?? []) {
      botOffset = update.update_id + 1;
      const msg = update.message;
      if (!msg?.text) continue;
      const chatId = String(msg.chat.id);
      const text   = msg.text.trim();

      if (text.startsWith('/link ')) {
        const code = text.slice(6).trim();
        await handleLinkCode(chatId, code);
      } else if (text.startsWith('/start')) {
        await botReply(chatId,
          '👋 Welcome to *AI Research Desk*!\n\nTo connect your account:\n1. Go to Settings on the dashboard\n2. Click *Generate Code*\n3. Send `/link YOUR_CODE` here\n\nYou\'ll then receive stock move and market alerts directly here.'
        );
      }
    }
  } catch (err) {
    console.error('[bot] Poll error:', err.message);
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

async function start() {
  console.log(`[listener] Starting — ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);
  await seedBotOffset();
  await poll();
  setInterval(poll, POLL_INTERVAL_MS);
  if (BOT_TOKEN) {
    setInterval(pollBot, BOT_POLL_INTERVAL_MS);
    console.log('[listener] Telegram bot polling started');
  }
}

start();

module.exports = {};
