// mfSebiAgent.js — Fetches daily MF equity/debt flow from SEBI
// SEBI updates with ~3-5 day lag. Run daily via pipeline.
// Data: https://www.sebi.gov.in/sebiweb/other/OtherAction.do?doMfd=yes&type=1
require('dotenv').config({ path: '../.env.local' });

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Parse "20 Mar, 2026" → "2026-03-20"
function parseSebiDate(s) {
  const months = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
  const m = s.trim().match(/(\d+)\s+(\w+),\s+(\d+)/);
  if (!m) return null;
  return `${m[3]}-${months[m[2]]}-${m[1].padStart(2,'0')}`;
}

// Parse "(4444.36)" → -4444.36, "4298.61" → 4298.61
function parseNum(s) {
  const clean = s.trim();
  if (clean.startsWith('(') && clean.endsWith(')')) {
    return -parseFloat(clean.slice(1, -1));
  }
  return parseFloat(clean) || 0;
}

async function fetchMFData() {
  const res = await fetch(
    'https://www.sebi.gov.in/sebiweb/other/OtherAction.do?doMfd=yes&type=1',
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,*/*',
      },
      signal: AbortSignal.timeout(15000),
    }
  );
  if (!res.ok) throw new Error(`SEBI fetch failed: ${res.status}`);
  const html = await res.text();

  // Extract rows with Equity/Debt data
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  const parsed = [];
  for (const row of rows) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
      .map(c => c[1].replace(/<[^>]+>/g,'').replace(/&[^;]+;/g,'').replace(/\s+/g,' ').trim())
      .filter(Boolean);
    if (cells.length >= 4 && (cells.some(c => c === 'Equity' || c === 'Debt'))) {
      parsed.push(cells);
    }
  }

  // Daily equity row has full date in first cell; debt row follows with 'Debt' as first cell
  const equityIdx = parsed.findIndex(r => r.includes('Equity') && r[0] !== 'Equity');
  const equityRow = parsed[equityIdx];
  const debtRow   = parsed[equityIdx + 1]; // always immediately after equity row

  if (!equityRow) throw new Error('Could not find equity row in SEBI data');

  const date = parseSebiDate(equityRow[0]);
  if (!date) throw new Error(`Could not parse date: ${equityRow[0]}`);

  const eqIdx  = equityRow.indexOf('Equity');
  return {
    date,
    eq_buy:   parseNum(equityRow[eqIdx + 1]),
    eq_sell:  parseNum(equityRow[eqIdx + 2]),
    eq_net:   parseNum(equityRow[eqIdx + 3]),
    dbt_buy:  debtRow?.[1] ? parseNum(debtRow[1]) : null,
    dbt_sell: debtRow?.[2] ? parseNum(debtRow[2]) : null,
    dbt_net:  debtRow?.[3] ? parseNum(debtRow[3]) : null,
  };
}

async function main() {
  console.log(`\n[mfSebiAgent] ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST\n`);

  const data = await fetchMFData();
  console.log(`  Date:   ${data.date}`);
  console.log(`  Equity: buy ₹${data.eq_buy} | sell ₹${data.eq_sell} | net ₹${data.eq_net}`);
  console.log(`  Debt:   buy ₹${data.dbt_buy} | sell ₹${data.dbt_sell} | net ₹${data.dbt_net}`);

  const { error } = await supabase
    .from('mf_sebi_daily')
    .upsert({
      date:     data.date,
      eq_buy:   data.eq_buy,
      eq_sell:  data.eq_sell,
      eq_net:   data.eq_net,
      dbt_buy:  data.dbt_buy,
      dbt_sell: data.dbt_sell,
      dbt_net:  data.dbt_net,
    }, { onConflict: 'date' });

  if (error) throw new Error('DB upsert failed: ' + error.message);
  console.log(`  ✓ Saved to mf_sebi_daily`);
}

main().catch(err => { console.error('❌ mfSebiAgent error:', err.message); process.exit(1); });
