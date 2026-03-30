// heartbeatMonitor.js
// Runs at 09:30 PM IST — after evening digest.
// Checks: pipeline cron jobs, Railway listener, Supabase DB health.
// Sends a formatted Telegram status card (always, not just on error).
// Writes result to agent_reports table.

require('dotenv').config({ path: '../.env.local' });
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL     = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY     = process.env.SUPABASE_SERVICE_KEY;
const TELEGRAM_BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_CHAT = process.env.TELEGRAM_ADMIN_CHAT_ID;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_CHAT) { console.log('[telegram]', text); return; }
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_ADMIN_CHAT, text, parse_mode: 'Markdown' }),
  }).catch(e => console.error('Telegram error:', e.message));
}

function ageLabel(secs) {
  if (secs == null) return 'Never';
  if (secs < 60)    return `${secs}s ago`;
  if (secs < 3600)  return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

// Returns midnight IST of the most recent weekday (Mon–Fri).
// Used so weekend-only jobs aren't flagged as stale on Sat/Sun/Mon.
function lastWeekdayMidnightIST() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() - 1);
  }
  return d;
}

async function main() {
  console.log('[heartbeatMonitor] Starting...');

  const nowMs = Date.now();

  // ── 1. Supabase health ping ────────────────────────────────────────────────
  const sbStart = Date.now();
  const { data: settingsRows, error: sbError } = await supabase
    .from('app_settings')
    .select('key, value');
  const sbLatencyMs = Date.now() - sbStart;
  const supabaseOk  = !sbError && sbLatencyMs < 5000;

  if (sbError) console.error('[heartbeatMonitor] Supabase error:', sbError.message);

  const valMap = {};
  for (const row of settingsRows ?? []) valMap[row.key] = row.value;

  // ── 2. Cron job heartbeats ─────────────────────────────────────────────────
  const nowIST    = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const dowIST    = nowIST.getDay(); // 0=Sun, 6=Sat
  const isWeekend = dowIST === 0 || dowIST === 6;
  const lastWDMidnight = lastWeekdayMidnightIST();

  const CRON_JOBS = [
    { key: 'cron_token_last_run',        label: 'Token Refresh',    staleAfterSecs: 26 * 3600,  critical: true,  weekdayOnly: false },
    { key: 'cron_pipeline_last_run',     label: 'Daily Pipeline',   staleAfterSecs: 26 * 3600,  critical: true,  weekdayOnly: true  },
    { key: 'cron_digest_last_run',       label: 'Evening Digest',   staleAfterSecs: 26 * 3600,  critical: false, weekdayOnly: true  },
    { key: 'cron_fundamentals_last_run', label: 'Fundamentals',     staleAfterSecs: 168 * 3600, critical: false, weekdayOnly: false },
  ];

  const cronResults = CRON_JOBS.map(j => {
    const v       = valMap[j.key];
    const lastRun = v ? new Date(v) : null;
    const ageSecs = lastRun ? Math.floor((nowMs - lastRun.getTime()) / 1000) : null;

    let ok, skipped = false;
    if (j.weekdayOnly && isWeekend) {
      // On weekends, these jobs don't run — skip staleness check
      skipped = true;
      ok = true;
    } else if (j.weekdayOnly) {
      // Weekday-only: must have run since midnight of the most recent weekday
      // (handles Monday correctly — last run was Friday, not "26h ago")
      ok = lastRun != null && lastRun >= lastWDMidnight;
    } else {
      ok = ageSecs != null && ageSecs < j.staleAfterSecs;
    }

    return { ...j, lastRun, ageSecs, ok, skipped };
  });

  // ── 3. Railway listener heartbeat ──────────────────────────────────────────
  // listener.js writes railway_heartbeat every ~60s; stale if >3 minutes
  const railwayVal  = valMap['railway_heartbeat'];
  const railwayLast = railwayVal ? new Date(railwayVal) : null;
  const railwayAge  = railwayLast ? Math.floor((nowMs - railwayLast.getTime()) / 1000) : null;
  const railwayOk   = railwayAge != null && railwayAge < 180;

  const railwayResult = {
    key:      'railway_heartbeat',
    label:    'Railway Listener',
    critical: true,
    lastRun:  railwayLast,
    ageSecs:  railwayAge,
    ok:       railwayOk,
  };

  // ── 4. Supabase result object ──────────────────────────────────────────────
  const supabaseResult = {
    key:      'supabase_db',
    label:    `Supabase DB`,
    critical: true,
    lastRun:  null,
    ageSecs:  null,
    ok:       supabaseOk,
    detail:   supabaseOk ? `${sbLatencyMs}ms` : (sbError?.message ?? 'timeout'),
  };

  // ── 5. Aggregate ──────────────────────────────────────────────────────────
  const allResults   = [...cronResults, railwayResult, supabaseResult];
  const critFailed   = allResults.filter(r => r.critical && !r.ok);
  const anyFailed    = allResults.filter(r => !r.ok);
  const allOk        = anyFailed.length === 0;
  const overallStatus = allOk ? 'ok' : critFailed.length > 0 ? 'error' : 'warning';

  // ── 6. Telegram message ───────────────────────────────────────────────────
  const statusLine = allOk
    ? '✅ *All systems healthy*'
    : critFailed.length > 0
      ? `🔴 *${critFailed.length} critical issue(s) detected*`
      : `🟡 *${anyFailed.length} warning(s)*`;

  const nowISTLabel = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
    .toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  const lines = allResults.map(r => {
    const icon   = r.ok ? '✅' : r.critical ? '🔴' : '🟡';
    const detail = r.detail ?? (r.ageSecs != null ? ageLabel(r.ageSecs) : 'Never run');
    return `${icon} ${r.label}: ${detail}`;
  });

  const message = [
    `💓 *Heartbeat Monitor · ${nowISTLabel} IST*`,
    '',
    statusLine,
    '',
    '📋 *Pipeline Jobs*',
    ...cronResults.map(r => {
      const icon   = r.ok ? '✅' : r.critical ? '🔴' : '🟡';
      const detail = r.skipped ? 'Weekend — skipped' : ageLabel(r.ageSecs);
      return `${icon} ${r.label}: ${detail}`;
    }),
    '',
    '🛠 *Infrastructure*',
    (() => {
      const icon = railwayOk ? '✅' : '🔴';
      return `${icon} Railway Listener: ${ageLabel(railwayAge)}`;
    })(),
    (() => {
      const icon = supabaseOk ? '✅' : '🔴';
      return `${icon} Supabase DB: ${supabaseOk ? `online (${sbLatencyMs}ms)` : (sbError?.message ?? 'unreachable')}`;
    })(),
  ].join('\n');

  console.log(message.replace(/\*/g, ''));
  await sendTelegram(message);

  const summary = [
    ...cronResults.map(r => `${r.label}: ${r.ok ? 'ok' : 'stale'}`),
    `Railway: ${railwayOk ? 'online' : 'offline'}`,
    `Supabase: ${supabaseOk ? `ok (${sbLatencyMs}ms)` : 'error'}`,
  ].join(', ');

  const { error: reportErr } = await supabase.from('agent_reports').insert({
    agent_name: 'heartbeat_monitor',
    status:     overallStatus,
    summary,
    report: {
      cron_jobs:  cronResults.map(r => ({ label: r.label, ok: r.ok, age_secs: r.ageSecs, last_run: r.lastRun, skipped: r.skipped ?? false })),
      railway:    { ok: railwayOk, age_secs: railwayAge, last_heartbeat: railwayLast },
      supabase:   { ok: supabaseOk, latency_ms: sbLatencyMs, error: sbError?.message ?? null },
    },
    ran_at: new Date().toISOString(),
  });

  if (reportErr) console.error('[heartbeatMonitor] agent_reports insert failed:', reportErr.message);
  else console.log('[heartbeatMonitor] Report written:', overallStatus);
  console.log(`[heartbeatMonitor] Done — status: ${overallStatus}`);
}

main();
