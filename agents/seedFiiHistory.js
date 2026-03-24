// seedFiiHistory.js — one-off: backfill 5 years of FII cumulative flow from Screener
// Run once: node seedFiiHistory.js
require('dotenv').config({ path: '../.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function getScreenerSession() {
  const loginPage = await fetch('https://www.screener.in/login/', { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const html = await loginPage.text();
  const csrf = html.match(/name="csrfmiddlewaretoken" value="([^"]+)"/)?.[1];
  const cookies = loginPage.headers.get('set-cookie')?.split(',').map(c => c.split(';')[0].trim()).join('; ');
  const loginRes = await fetch('https://www.screener.in/login/', {
    method: 'POST',
    headers: { 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': 'https://www.screener.in/login/', 'Cookie': cookies },
    body: new URLSearchParams({ csrfmiddlewaretoken: csrf, username: process.env.SCREENER_EMAIL, password: process.env.SCREENER_PASSWORD, next: '/' }),
    redirect: 'manual',
  });
  return [...(cookies?.split('; ') || []), ...(loginRes.headers.get('set-cookie')?.split(',').map(c => c.split(';')[0].trim()) || [])].join('; ');
}

async function main() {
  console.log('Logging into Screener...');
  const session = await getScreenerSession();
  const headers = { 'User-Agent': 'Mozilla/5.0', 'Cookie': session, 'X-Requested-With': 'XMLHttpRequest' };

  console.log('Fetching 5-year FII flow (days=1825)...');
  const data = await fetch('https://www.screener.in/api/fii/?days=1825', { headers }).then(r => r.json());

  const rows = data.labels.map((date, i) => ({
    date,
    cumulative_net: parseFloat(data.values[i]) || null,
  }));

  console.log(`Saving ${rows.length} rows (${rows[0].date} → ${rows[rows.length-1].date})...`);
  const { error } = await supabase
    .from('fii_flow')
    .upsert(rows, { onConflict: 'date', ignoreDuplicates: true });

  if (error) { console.error('❌ Error:', error.message); process.exit(1); }
  console.log('✅ Done.');
  process.exit(0);
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
