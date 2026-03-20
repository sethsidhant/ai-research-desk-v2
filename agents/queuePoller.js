// queuePoller.js
// Runs every 15 minutes via Task Scheduler during market hours.
// Finds any watchlisted stocks with no fundamentals and onboards them.
// This gives users data within ~15 minutes of adding a stock.

require('dotenv').config({ path: '../.env.local' });
const { execSync }   = require('child_process');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function main() {
  console.log(`\n[queuePoller] ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);

  const { data, error } = await supabase
    .from('user_stocks')
    .select('stocks(ticker, fundamentals_updated_at)');

  if (error) {
    console.error('Supabase error:', error.message);
    process.exit(1);
  }

  const pending = [...new Set(
    (data ?? [])
      .map(r => r.stocks)
      .filter(s => s && !s.fundamentals_updated_at)
      .map(s => s.ticker)
  )];

  if (!pending.length) {
    console.log('No pending stocks — nothing to do.');
    process.exit(0);
  }

  console.log(`Found ${pending.length} pending stock(s): ${pending.join(', ')}`);

  for (const ticker of pending) {
    console.log(`\n▶ Onboarding ${ticker}...`);
    try {
      execSync(`node onboardStock.js ${ticker}`, {
        cwd: __dirname,
        stdio: 'inherit',
        timeout: 5 * 60 * 1000,
      });
    } catch (err) {
      console.error(`✗ ${ticker} failed:`, err.message);
    }
  }

  console.log('\n[queuePoller] Done.');
  process.exit(0);
}

main();
