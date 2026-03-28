// setScids.js — Set mc_scid for a stock and immediately fetch MC analyst + earnings data
// Usage: node setScids.js TICKER SCID
// Example: node setScids.js SAGILITY SC16
//
// How to find the scId:
//   1. Go to moneycontrol.com and search for the stock
//   2. The URL will be like: /india/stockpricequote/it-software/infosys/IT
//   3. The last segment ("IT") is the scId

require('dotenv').config({ path: '../.env.local' });
const { createClient } = require('@supabase/supabase-js');
const { fetchMCData }  = require('./fetchMCData');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function main() {
  const [ticker, scid] = process.argv.slice(2);
  if (!ticker || !scid) {
    console.error('Usage:   node setScids.js TICKER SCID');
    console.error('Example: node setScids.js SAGILITY SC16');
    console.error('\nHow to find scId: moneycontrol.com stock URL — last path segment');
    process.exit(1);
  }

  const t = ticker.toUpperCase();
  console.log(`[setScids] Setting mc_scid="${scid}" for ${t}...`);

  const { data: stock, error: fetchErr } = await supabase
    .from('stocks')
    .select('id, ticker, mc_scid')
    .eq('ticker', t)
    .single();

  if (fetchErr || !stock) {
    console.error(`[setScids] Stock "${t}" not found in DB`);
    process.exit(1);
  }

  if (stock.mc_scid && stock.mc_scid !== scid) {
    console.log(`[setScids] Note: replacing existing scId "${stock.mc_scid}" with "${scid}"`);
  }

  const { error: updateErr } = await supabase
    .from('stocks')
    .update({ mc_scid: scid })
    .eq('id', stock.id);

  if (updateErr) {
    console.error('[setScids] Failed to update mc_scid:', updateErr.message);
    process.exit(1);
  }

  console.log(`[setScids] ✅ mc_scid saved. Fetching MC data...`);

  const mc = await fetchMCData(scid);
  if (!mc || Object.keys(mc).length === 0) {
    console.log(`[setScids] ⚠️  MC returned no data — double-check the scId is correct.`);
    console.log(`[setScids] mc_scid has been saved. Data will retry on Saturday engine run.`);
    process.exit(0);
  }

  const { error: mcErr } = await supabase
    .from('stocks')
    .update(mc)
    .eq('id', stock.id);

  if (mcErr) {
    console.error('[setScids] Failed to save MC data:', mcErr.message);
    process.exit(1);
  }

  console.log(`[setScids] ✅ MC data saved for ${t}:`);
  if (mc.analyst_rating != null) console.log(`   Analyst rating : ${mc.analyst_rating} / 5 (${mc.analyst_count ?? '?'} analysts)`);
  if (mc.analyst_buy_pct != null) console.log(`   Buy/Hold/Sell  : ${mc.analyst_buy_pct}% / ${mc.analyst_hold_pct}% / ${mc.analyst_sell_pct}%`);
  if (mc.target_mean != null)    console.log(`   Target price   : ₹${mc.target_mean} (low ₹${mc.target_low} / high ₹${mc.target_high})`);
  if (mc.mc_earnings_json)       console.log(`   Earnings forecast: loaded`);
  else                           console.log(`   Earnings forecast: not available for this stock`);
}

main().catch(e => { console.error(e); process.exit(1); });
