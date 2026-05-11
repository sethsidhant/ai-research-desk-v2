// screenerMarketAgent.js — Scrapes Screener.in/market/ industry overview
// Run: node screenerMarketAgent.js
// No login required — data is publicly accessible.

require('dotenv').config({ path: '../.env.local' });

const https = require('https');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 20000 }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function parseNum(s) {
  if (!s || s === '-' || s === '') return null;
  const n = parseFloat(s.replace(/,/g, '').replace('%', ''));
  return isNaN(n) ? null : n;
}

async function fetchIndustries() {
  const html = await get('https://www.screener.in/market/');

  const rows = [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].map(m => {
    const urlMatch = m[1].match(/href="(\/market\/[^"]+)"/);
    const cells = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map(c => c[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim())
      .filter(Boolean);
    return { cells, url: urlMatch?.[1] ?? null };
  }).filter(r => r.cells.length >= 9 && r.url);

  return rows.map(r => ({
    industry:         r.cells[1],
    screener_url:     r.url,
    company_count:    parseNum(r.cells[2]),
    total_mcap_cr:    parseNum(r.cells[3]),
    median_mcap_cr:   parseNum(r.cells[4]),
    median_pe:        parseNum(r.cells[5]),
    avg_sales_growth: parseNum(r.cells[6]),
    avg_opm:          parseNum(r.cells[7]),
    avg_roce:         parseNum(r.cells[8]),
    median_1y_return: parseNum(r.cells[9]),
    updated_at:       new Date().toISOString(),
  }));
}

async function main() {
  console.log('[screenerMarketAgent] Fetching Screener industry overview...');

  const rows = await fetchIndustries();
  console.log(`[screenerMarketAgent] Parsed ${rows.length} industries`);

  if (!rows.length) { console.error('[screenerMarketAgent] No data — aborting'); process.exit(1); }

  const { error } = await supabase
    .from('screener_industries')
    .upsert(rows, { onConflict: 'industry' });

  if (error) {
    console.error('[screenerMarketAgent] DB error:', error.message);
    process.exit(1);
  }

  console.log(`[screenerMarketAgent] Done — ${rows.length} rows upserted`);
}

main().catch(e => { console.error('[screenerMarketAgent]', e.message); process.exit(1); });
