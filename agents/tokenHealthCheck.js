// tokenHealthCheck.js
// Runs at 07:00 AM IST — 75 minutes before daily pipeline fires.
// Makes a live test call to Kite API with the stored token.
// Alerts via Telegram immediately if token is expired.
// Writes result to agent_reports table.

require('dotenv').config({ path: '../.env.local' });
const fs           = require('fs');
const path         = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const TELEGRAM_BOT_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_CHAT  = process.env.TELEGRAM_ADMIN_CHAT_ID;
const KITE_API_KEY         = process.env.KITE_API_KEY;

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_CHAT) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_ADMIN_CHAT, text, parse_mode: 'Markdown' }),
  }).catch(() => {});
}

async function writeReport(status, summary, report = {}) {
  await supabase.from('agent_reports').insert({
    agent_name: 'token_health_check',
    status,
    summary,
    report,
    ran_at: new Date().toISOString(),
  });
}

async function getAccessToken() {
  // Try .kite_token file first (written by refreshKiteToken.js in GH Actions)
  const tokenFile = path.join(__dirname, '../.kite_token');
  if (fs.existsSync(tokenFile)) {
    const token = fs.readFileSync(tokenFile, 'utf8').trim();
    if (token) return token;
  }
  // Fall back to Supabase app_settings
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'kite_access_token')
    .single();
  return data?.value ?? null;
}

async function main() {
  console.log('[tokenHealthCheck] Starting...');

  const token = await getAccessToken();

  if (!token) {
    const summary = 'No access token found in .kite_token or app_settings';
    console.error(`❌ ${summary}`);
    await writeReport('error', summary, { error: 'missing_token' });
    await sendTelegram(`🔴 *Token Health Check FAILED*\n\n${summary}\n\nPipeline will fail at 8:35 AM IST.`);
    process.exit(1);
  }

  console.log(`[tokenHealthCheck] Testing token: ${token.slice(0, 8)}...`);

  try {
    const res = await fetch('https://api.kite.trade/user/profile', {
      headers: {
        'X-Kite-Version': '3',
        'Authorization': `token ${KITE_API_KEY}:${token}`,
      },
    });

    const json = await res.json().catch(() => ({}));

    if (res.ok && json?.status === 'success') {
      const userName = json?.data?.user_name ?? 'Unknown';
      const summary  = `Token valid · ${userName} · Kite API responding`;
      console.log(`✅ ${summary}`);
      await writeReport('ok', summary, { user: json?.data, http_status: res.status });
    } else {
      const errMsg = json?.message ?? json?.error_type ?? `HTTP ${res.status}`;
      const summary = `Token invalid or expired: ${errMsg}`;
      console.error(`❌ ${summary}`);
      await writeReport('error', summary, { http_status: res.status, kite_error: json });
      await sendTelegram(
        `🔴 *Kite Token EXPIRED*\n\n` +
        `Error: ${errMsg}\n\n` +
        `⚠️ Daily pipeline fires at 8:35 AM IST and will fail.\n` +
        `Refresh token manually at Kite console.`
      );
      process.exit(1);
    }
  } catch (err) {
    const summary = `Network error testing Kite API: ${err.message}`;
    console.error(`❌ ${summary}`);
    await writeReport('error', summary, { error: err.message });
    await sendTelegram(`🔴 *Token Health Check ERROR*\n\n${summary}`);
    process.exit(1);
  }
}

main();
