// heartbeatMonitor.js
// Runs at 09:30 PM IST — after evening digest.
// Checks all pipeline heartbeats in app_settings.
// Sends a formatted Telegram status card (always, not just on error).
// Writes result to agent_reports table.

require('dotenv').config({ path: '../.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const TELEGRAM_BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_CHAT = process.env.TELEGRAM_ADMIN_CHAT_ID;

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_CHAT) { console.log('[telegram]', text); return; }
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_ADMIN_CHAT, text, parse_mode: 'Markdown' }),
  }).catch(e => console.error('Telegram error:', e.message));
}

function ageLabel(secs) {
  if (secs == null) return 'Never run';
  if (secs < 3600)  return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

async function main() {
  console.log('[heartbeatMonitor] Starting...');

  const JOBS = [
    { key: 'cron_token_last_run',        label: 'Token Refresh',    staleAfterH: 26,  critical: true  },
    { key: 'cron_pipeline_last_run',     label: 'Daily Pipeline',   staleAfterH: 26,  critical: true  },
    { key: 'cron_digest_last_run',       label: 'Evening Digest',   staleAfterH: 26,  critical: false },
    { key: 'cron_fundamentals_last_run', label: 'Fundamentals',     staleAfterH: 168, critical: false },
  ];

  const keys = JOBS.map(j => j.key);
  const { data: rows, error } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', keys);

  if (error) {
    console.error('Supabase error:', error.message);
    process.exit(1);
  }

  const valMap = {};
  for (const row of rows ?? []) valMap[row.key] = row.value;

  const nowMs  = Date.now();
  const results = JOBS.map(j => {
    const v       = valMap[j.key];
    const lastRun = v ? new Date(v) : null;
    const ageSecs = lastRun ? Math.floor((nowMs - lastRun.getTime()) / 1000) : null;
    const ok      = ageSecs != null && ageSecs < j.staleAfterH * 3600;
    return { ...j, lastRun, ageSecs, ok };
  });

  const allOk      = results.every(r => r.ok);
  const critFailed = results.filter(r => r.critical && !r.ok);
  const anyFailed  = results.filter(r => !r.ok);

  const overallStatus = allOk ? 'ok' : critFailed.length > 0 ? 'error' : 'warning';

  // Build Telegram message
  const statusLine = allOk
    ? '✅ *All systems healthy*'
    : critFailed.length > 0
      ? `🔴 *${critFailed.length} critical job(s) stale*`
      : `🟡 *${anyFailed.length} job(s) stale*`;

  const rows2 = results.map(r => {
    const icon = r.ok ? '✅' : r.critical ? '🔴' : '🟡';
    return `${icon} ${r.label}: ${ageLabel(r.ageSecs)}`;
  });

  const summary = results.map(r => `${r.label}: ${r.ok ? 'ok' : 'stale'}`).join(', ');
  const nowIST  = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
    .toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  const message = [
    `💓 *Heartbeat Monitor · ${nowIST} IST*`,
    '',
    statusLine,
    '',
    ...rows2,
  ].join('\n');

  console.log(message.replace(/\*/g, ''));

  await sendTelegram(message);

  await supabase.from('agent_reports').insert({
    agent_name: 'heartbeat_monitor',
    status:     overallStatus,
    summary,
    report:     { jobs: results.map(r => ({ label: r.label, ok: r.ok, age_secs: r.ageSecs, last_run: r.lastRun })) },
    ran_at:     new Date().toISOString(),
  });

  console.log(`[heartbeatMonitor] Done — status: ${overallStatus}`);
}

main();
