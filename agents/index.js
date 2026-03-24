// index.js — main entry point for Railway
// Runs all watchers in a single process
require('dotenv').config({ path: '../.env.local' });

const listener          = require('./listener');
const indexWatcher      = require('./indexWatcher');
const stockWatcher      = require('./stockWatcher');
const filingWatcher     = require('./filingWatcher');
const technicalWatcher  = require('./technicalWatcher');

const { ready }    = require('./kiteClient');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function heartbeat() {
  try {
    await supabase.from('app_settings').upsert(
      { key: 'railway_heartbeat', value: new Date().toISOString() },
      { onConflict: 'key' }
    );
  } catch (err) {
    console.error('[heartbeat] Error:', err.message);
  }
}

async function main() {
  console.log('[main] Starting all watchers...');
  await ready; // wait for fresh Kite token before first poll
  indexWatcher.start();
  stockWatcher.start();
  filingWatcher.start();
  technicalWatcher.start();
  // listener.js starts itself on require
  heartbeat();
  setInterval(heartbeat, 60 * 1000); // update every 60s
}

main();
