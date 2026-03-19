// listener.js
// Listens for new stocks added to any user's watchlist via Supabase Realtime.
// When a stock with no fundamentals is added, immediately runs onboarding.
// Run permanently with: pm2 start listener.js --name ai-desk-listener

require('dotenv').config({ path: '../.env.local' });
const { execSync }   = require('child_process');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const processing = new Set(); // prevent duplicate concurrent runs

async function needsOnboarding(stockId) {
  const { data } = await supabase
    .from('stocks')
    .select('ticker, fundamentals_updated_at')
    .eq('id', stockId)
    .single();
  if (!data || data.fundamentals_updated_at) return null;
  return data.ticker;
}

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

async function start() {
  console.log(`[listener] Starting — ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);

  // On startup, catch any stocks added while listener was offline
  const { data } = await supabase
    .from('user_stocks')
    .select('stocks(ticker, fundamentals_updated_at)');

  const missed = [...new Set(
    (data ?? [])
      .map(r => r.stocks)
      .filter(s => s && !s.fundamentals_updated_at)
      .map(s => s.ticker)
  )];

  if (missed.length) {
    console.log(`[listener] Catching up on ${missed.length} missed stock(s): ${missed.join(', ')}`);
    for (const ticker of missed) onboard(ticker);
  }

  // Subscribe to new watchlist additions
  supabase
    .channel('user_stocks_inserts')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'user_stocks' }, async (payload) => {
      const stockId = payload.new.stock_id;
      const ticker  = await needsOnboarding(stockId);
      if (ticker) {
        console.log(`[listener] New stock detected: ${ticker}`);
        onboard(ticker);
      }
    })
    .subscribe((status) => {
      console.log(`[listener] Realtime status: ${status}`);
    });
}

start();
