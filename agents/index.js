// index.js — main entry point for Railway
// Runs all watchers in a single process
require('dotenv').config({ path: '../.env.local' });

const userCache         = require('./userCache');
const listener          = require('./listener');
const indexWatcher      = require('./indexWatcher');
const stockWatcher      = require('./stockWatcher');
const filingWatcher     = require('./filingWatcher');
const technicalWatcher  = require('./technicalWatcher');
const telegramWatcher   = require('./telegramWatcher');

const { ready }       = require('./kiteClient');
const { createClient } = require('@supabase/supabase-js');
const { spawn }        = require('child_process');
const path             = require('path');

// ── Earnings season windows (±7 days buffer around bulk results period) ───────
// Q4 (Jan-Mar results): Apr 8 – May 27
// Q1 (Apr-Jun results): Jul 8  – Aug 27
// Q2 (Jul-Sep results): Oct 8  – Nov 27
// Q3 (Oct-Dec results): Jan 8  – Feb 27
const EARNINGS_WINDOWS = [
  { start: { m: 4,  d: 8  }, end: { m: 5,  d: 27 } },  // Q4
  { start: { m: 7,  d: 8  }, end: { m: 8,  d: 27 } },  // Q1
  { start: { m: 10, d: 8  }, end: { m: 11, d: 27 } },  // Q2
  { start: { m: 1,  d: 8  }, end: { m: 2,  d: 27 } },  // Q3
];

function isEarningsSeason() {
  const now   = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const month = now.getMonth() + 1; // 1-12
  const day   = now.getDate();
  return EARNINGS_WINDOWS.some(w => {
    if (month === w.start.m) return day >= w.start.d;
    if (month === w.end.m)   return day <= w.end.d;
    // handle windows that don't span month boundaries (all ours are within 2 months)
    return month > w.start.m && month < w.end.m;
  });
}

// ── Forex Reserves scheduler (Fridays 7–11 PM IST — RBI blocks GH Actions IPs) ─
let forexAgentRunning = false;

async function maybeRunForexAgent(supabase) {
  const now  = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day  = now.getDay();   // 5 = Friday
  const hour = now.getHours(); // 0–23 IST

  if (day !== 5)              return; // Fridays only
  if (hour < 19 || hour > 23) return; // 7–11 PM IST window
  if (forexAgentRunning)      { console.log('[forexScheduler] Previous run still in progress — skipping.'); return; }

  const todayIST = now.toISOString().slice(0, 10);
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'forex_agent_last_run')
    .single();

  if (data?.value && data.value.slice(0, 10) === todayIST) {
    console.log('[forexScheduler] Already ran today — skipping.');
    return;
  }

  forexAgentRunning = true;
  console.log('[forexScheduler] Friday evening — spawning forexAgent...');
  const child = spawn('node', [path.join(__dirname, 'forexAgent.js')], {
    stdio: 'inherit',
    env: process.env,
  });
  child.on('exit', code => {
    console.log(`[forexScheduler] forexAgent exited with code ${code}`);
    forexAgentRunning = false;
  });
}

// ── Earnings alert scheduler (every 4h, earnings season only, incl. Saturdays) ─
let earningsAlertRunning = false;

async function maybeRunEarningsAlert() {
  if (!isEarningsSeason())       return;
  if (earningsAlertRunning)      { console.log('[earningsAlert] Previous run still in progress — skipping.'); return; }

  earningsAlertRunning = true;
  console.log('[earningsAlert] Earnings season active — spawning earningsAlertAgent...');
  const child = spawn('node', [path.join(__dirname, 'earningsAlertAgent.js')], {
    stdio: 'inherit',
    env: process.env,
  });
  child.on('exit', code => {
    console.log(`[earningsAlert] earningsAlertAgent exited with code ${code}`);
    earningsAlertRunning = false;
  });
}

async function maybeRunHistoryRefresh(supabase) {
  if (!isEarningsSeason()) return;

  // Check if already ran today (IST)
  const todayIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
    .toISOString().slice(0, 10);

  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'cron_history_refresh_last_run')
    .single();

  if (data?.value && data.value.slice(0, 10) === todayIST) {
    console.log('[historyScheduler] Already ran today — skipping.');
    return;
  }

  console.log('[historyScheduler] Earnings season active — spawning historyRefreshAgent...');
  const child = spawn('node', [path.join(__dirname, 'historyRefreshAgent.js')], {
    stdio: 'inherit',
    env: process.env,
  });
  child.on('exit', code => {
    console.log(`[historyScheduler] historyRefreshAgent exited with code ${code}`);
  });
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function pruneMacroAlerts() {
  try {
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    const { error, count } = await supabase
      .from('macro_alerts')
      .delete({ count: 'exact' })
      .lt('created_at', cutoff);
    if (error) console.error('[prune] macro_alerts error:', error.message);
    else if (count > 0) console.log(`[prune] Deleted ${count} macro_alerts older than 30 days`);
  } catch (err) {
    console.error('[prune] Error:', err.message);
  }
}

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
  if (process.env.AGENTS_PAUSED === 'true') {
    console.log('[main] AGENTS_PAUSED=true — exiting immediately. Set AGENTS_PAUSED=false in Railway env to resume.');
    process.exit(0);
  }

  console.log('[main] Starting all watchers...');
  userCache.start(); // start shared cache refresh (5 min cycle)
  try {
    await ready; // wait for fresh Kite token before first poll
  } catch (err) {
    // Don't crash if Supabase is temporarily down or Kite token unavailable on startup.
    // Each watcher retries independently — they'll recover once DB is reachable.
    console.warn('[main] Kite token unavailable at startup — watchers will retry:', err.message);
  }
  indexWatcher.start();
  stockWatcher.start();
  filingWatcher.start();
  technicalWatcher.start();
  telegramWatcher.start();
  // listener.js starts itself on require
  heartbeat();
  setInterval(heartbeat, 60 * 60 * 1000); // update every 60 min — purely for monitoring

  // Earnings season: run history refresh daily (check now + every 24h)
  await maybeRunHistoryRefresh(supabase);
  setInterval(() => maybeRunHistoryRefresh(supabase), 24 * 60 * 60 * 1000);

  // Earnings season: run alert agent every 4h incl. Saturdays (staggered 2min after startup)
  setTimeout(() => {
    maybeRunEarningsAlert();
    setInterval(maybeRunEarningsAlert, 4 * 60 * 60 * 1000);
  }, 2 * 60 * 1000);

  // Forex: check every 30 min — runs only Friday 7–11 PM IST (RBI blocks GH Actions IPs)
  maybeRunForexAgent(supabase);
  setInterval(() => maybeRunForexAgent(supabase), 30 * 60 * 1000);

  // Prune macro_alerts older than 30 days — keeps GIN index small, reduces insert WAL cost
  pruneMacroAlerts();
  setInterval(pruneMacroAlerts, 24 * 60 * 60 * 1000);
}

process.on('uncaughtException',  err => console.error('[main] Uncaught exception:', err.message));
process.on('unhandledRejection', err => console.error('[main] Unhandled rejection:', err?.message ?? err));

main();
