// Shared Kite client with hourly token refresh from Supabase
require('dotenv').config({ path: '../.env.local' });

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

let accessToken = process.env.KITE_ACCESS_TOKEN ?? '';
const API_KEY   = process.env.KITE_API_KEY ?? '';

async function refreshToken() {
  try {
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'kite_access_token')
      .single();
    if (data?.value) { accessToken = data.value; }
  } catch (err) {
    console.error('[kiteClient] Token refresh error:', err.message);
  }
}

// Refresh token every hour
refreshToken();
setInterval(refreshToken, 60 * 60 * 1000);

async function quoteMultiple(instruments) {
  if (!instruments.length) return {};
  const query = instruments.map(i => `i=${encodeURIComponent(i)}`).join('&');
  const res = await fetch(`https://api.kite.trade/quote?${query}`, {
    headers: { 'X-Kite-Version': '3', 'Authorization': `token ${API_KEY}:${accessToken}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Kite error: ${res.status}`);
  const json = await res.json();
  return json.data ?? {};
}

module.exports = { quoteMultiple, refreshToken };
