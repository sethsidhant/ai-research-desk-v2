// listener.js
// Polls Supabase every 30s for watchlist stocks that need onboarding.
// Replaces Realtime WebSocket approach which is unreliable on Railway.
// Run permanently with: pm2 start listener.js --name ai-desk-listener

require('dotenv').config({ path: '../.env.local' });
const { execSync }     = require('child_process');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const POLL_INTERVAL_MS = 30000;
const processing = new Set();

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

async function start() {
  console.log(`[listener] Starting — ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);
  console.log(`[listener] Polling every ${POLL_INTERVAL_MS / 1000}s for stocks needing onboarding`);
  await poll();
  setInterval(poll, POLL_INTERVAL_MS);
}

// Auto-start when run directly; also start when required (index.js)
start();

module.exports = {};
