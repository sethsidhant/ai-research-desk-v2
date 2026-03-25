// seedMFHistory.js — imports MF-MoM-marc2025-feb2026.xlsx into mf_sebi_daily
require('dotenv').config({ path: '../.env.local' });
const XLSX      = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Convert Excel serial date → 'YYYY-MM-DD'
function excelDateToISO(serial) {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}

// Parse "(3534.66)" → -3534.66, 7229.16 → 7229.16
function parseNum(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const s = v.trim();
    if (s.startsWith('(') && s.endsWith(')')) return -parseFloat(s.slice(1, -1));
    return parseFloat(s) || 0;
  }
  return 0;
}

async function main() {
  const wb = XLSX.readFile('../MF-MoM-marc2025-feb2026.xlsx');
  console.log(`Sheets: ${wb.SheetNames.join(', ')}\n`);

  const allRows = [];

  for (const sheetName of wb.SheetNames) {
    const ws   = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // Skip header row; group equity+debt row pairs
    let currentDate = null;
    let equityRow   = null;

    for (const row of rows.slice(1)) {
      const col0 = row[0];
      const type = String(row[1]).trim();

      // Skip total/blank rows
      if (!type || type === 'Debt/Equity') continue;
      if (String(col0).toLowerCase().includes('total')) continue;

      if (type === 'Equity') {
        // New date — could be serial number or already a string date
        if (col0 && col0 !== '') {
          currentDate = typeof col0 === 'number' ? excelDateToISO(col0) : String(col0).trim();
        }
        equityRow = row;
      } else if (type === 'Debt' && equityRow && currentDate) {
        allRows.push({
          date:     currentDate,
          eq_buy:   parseNum(equityRow[2]),
          eq_sell:  parseNum(equityRow[3]),
          eq_net:   parseNum(equityRow[4]),
          dbt_buy:  parseNum(row[2]),
          dbt_sell: parseNum(row[3]),
          dbt_net:  parseNum(row[4]),
        });
        equityRow = null;
      }
    }

    console.log(`  ${sheetName}: ${allRows.length} rows so far`);
  }

  console.log(`\nTotal rows parsed: ${allRows.length}`);
  if (!allRows.length) { console.error('No rows parsed — check sheet structure'); process.exit(1); }

  // Sample check
  console.log('Sample:', JSON.stringify(allRows[0]));
  console.log('Sample:', JSON.stringify(allRows[allRows.length - 1]));

  // Upsert in batches of 100
  let inserted = 0;
  for (let i = 0; i < allRows.length; i += 100) {
    const batch = allRows.slice(i, i + 100);
    const { error } = await supabase.from('mf_sebi_daily').upsert(batch, { onConflict: 'date' });
    if (error) { console.error(`Batch ${i} error:`, error.message); process.exit(1); }
    inserted += batch.length;
  }

  console.log(`\n✓ Inserted/updated ${inserted} rows into mf_sebi_daily`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
