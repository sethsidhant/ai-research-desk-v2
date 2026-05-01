require('dotenv').config({ path: '../.env.local' });
const { createClient } = require('@supabase/supabase-js');
const { sendMacro }    = require('./telegramAlert');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const EMOJI  = { trump:'🇺🇸', moneycontrol:'📊', et_markets:'📰', cnbctv18:'📺' };
const LABEL  = { trump:'Trump', moneycontrol:'MoneyControl', et_markets:'ET Markets', cnbctv18:'CNBC TV18' };
const sleep  = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const since = new Date(Date.now() - 40 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('macro_alerts').select('*').gte('created_at', since).order('created_at', { ascending: true });

  if (error) { console.error(error.message); process.exit(1); }
  if (!data?.length) { console.log('No alerts in last 40min.'); return; }

  console.log(`Sending ${data.length} alert(s)...`);
  for (const row of data) {
    const s = row.sentiment === 'bull' ? '🟢' : row.sentiment === 'bear' ? '🔴' : '⚪';
    const e = EMOJI[row.channel] ?? '📌';
    const l = LABEL[row.channel] ?? row.channel;
    const tag = row.forward_looking ? ' _(forward outlook)_' : '';
    await sendMacro(`${s} ${e} *Macro · ${l}*${tag}\n${row.summary}`);
    console.log(`  ✓ ${l}: ${row.summary.slice(0, 60)}…`);
    await sleep(1500);
  }
  console.log('Done.');
}

main().catch(e => { console.error(e.message); process.exit(1); });
