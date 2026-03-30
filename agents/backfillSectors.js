// backfillSectors.js — one-time script
// For all important=true macro_alerts rows that have no affected_sectors,
// asks Haiku which sectors are impacted and writes them to DB.
// Run: node backfillSectors.js

require('dotenv').config({ path: '../.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const FII_SECTORS = [
  'Financial Services', 'Information Technology', 'Oil, Gas & Consumable Fuels',
  'Automobile and Auto Components', 'Fast Moving Consumer Goods', 'Capital Goods',
  'Healthcare', 'Consumer Services', 'Metals & Mining', 'Chemicals',
  'Telecommunication', 'Power', 'Realty', 'Construction',
  'Media Entertainment & Publication', 'Textiles', 'Transportation',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getSectors(summary) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 60,
      messages: [{
        role:    'user',
        content: `Which Indian equity sectors are DIRECTLY impacted by this news? Pick 1-3 from the list below. Reply with a JSON array only, e.g. ["Financial Services","Oil, Gas & Consumable Fuels"]. If none clearly apply, reply [].

Sectors: ${FII_SECTORS.join(', ')}

News: ${summary}`,
      }],
    }),
  });
  const json = await res.json();
  const text = (json.content?.[0]?.text ?? '').trim();
  try {
    const arr = JSON.parse(text);
    return Array.isArray(arr) ? arr.filter(s => FII_SECTORS.includes(s)) : [];
  } catch {
    return [];
  }
}

async function main() {
  const { data: rows, error } = await supabase
    .from('macro_alerts')
    .select('id, summary, affected_sectors')
    .eq('important', true)
    .order('created_at', { ascending: false });

  if (error) { console.error('Fetch error:', error.message); process.exit(1); }

  // Only process rows with null/empty sectors
  const toProcess = (rows ?? []).filter(r => !r.affected_sectors || r.affected_sectors.length === 0);
  console.log(`${rows.length} important rows total, ${toProcess.length} need sector tagging\n`);

  let updated = 0;
  for (const row of toProcess) {
    try {
      const sectors = await getSectors(row.summary);
      const { error: upErr } = await supabase
        .from('macro_alerts')
        .update({ affected_sectors: sectors })
        .eq('id', row.id);

      if (upErr) {
        console.error(`  ✗ ${row.id}: ${upErr.message}`);
      } else {
        updated++;
        const tag = sectors.length ? sectors.join(', ') : '(none)';
        console.log(`  ✓ [${tag}] ${row.summary.slice(0, 75)}`);
      }
      await sleep(300);
    } catch (e) {
      console.error(`  Error on ${row.id}: ${e.message}`);
    }
  }

  console.log(`\nDone. ${updated} / ${toProcess.length} rows updated with sector tags.`);
}

main();
