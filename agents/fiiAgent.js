// fiiAgent.js — FII cumulative flow + sector (Screener) + FII/DII daily (NSE)
// Runs twice:
//   1. ~7 PM IST via Task Scheduler — provisional NSE data + same-day Screener snapshot
//   2. Via daily-pipeline.yml (morning engine run) — Screener final data overwrites provisional
require('dotenv').config({ path: '../.env.local' });
const { createClient }   = require('@supabase/supabase-js');
const { sendToMany }     = require('./telegramAlert');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ── Screener login ────────────────────────────────────────────────────────────

async function getScreenerSession() {
  const loginPage = await fetch('https://www.screener.in/login/', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  const html = await loginPage.text();
  const csrf = html.match(/name="csrfmiddlewaretoken" value="([^"]+)"/)?.[1];
  const cookies = loginPage.headers.get('set-cookie')?.split(',').map(c => c.split(';')[0].trim()).join('; ');
  const loginRes = await fetch('https://www.screener.in/login/', {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': 'https://www.screener.in/login/',
      'Cookie': cookies,
    },
    body: new URLSearchParams({
      csrfmiddlewaretoken: csrf,
      username: process.env.SCREENER_EMAIL,
      password: process.env.SCREENER_PASSWORD,
      next: '/',
    }),
    redirect: 'manual',
  });
  return [...(cookies?.split('; ') || []), ...(loginRes.headers.get('set-cookie')?.split(',').map(c => c.split(';')[0].trim()) || [])].join('; ');
}

// ── NSE session ───────────────────────────────────────────────────────────────

async function getNSESession() {
  const r = await fetch('https://www.nseindia.com', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,*/*',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  return r.headers.get('set-cookie')?.split(',').map(c => c.split(';')[0].trim()).join('; ');
}

// ── 1. FII cumulative flow (Screener) ─────────────────────────────────────────

async function fetchFIIFlow(session, days = 365) {
  const headers = { 'User-Agent': 'Mozilla/5.0', 'Cookie': session, 'X-Requested-With': 'XMLHttpRequest' };
  const data = await fetch(`https://www.screener.in/api/fii/?days=${days}`, { headers }).then(r => r.json());

  const rows = data.labels.map((date, i) => ({
    date,
    cumulative_net: parseFloat(data.values[i]) || null,
  }));

  const { error } = await supabase
    .from('fii_flow')
    .upsert(rows, { onConflict: 'date', ignoreDuplicates: false });
  if (error) throw new Error('fii_flow upsert: ' + error.message);
  console.log(`  ✓ FII flow: ${rows.length} rows (days=${days})`);
}

// ── 2. FII sector data (Screener HTML) ───────────────────────────────────────

async function fetchFIISectors(session) {
  const html = await fetch('https://www.screener.in/fii/', {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Cookie': session },
  }).then(r => r.text());

  // Extract sparkline labels from grid container
  const sparklineLabels = html.match(/id="fii-sector-box-grid"[^>]*data-sparkline-labels="([^"]+)"/)?.[1] ?? '';

  // Extract each sector article
  const articles = [...html.matchAll(/<article class="box"[^>]*data-aum="([^"]+)"[^>]*data-fortnight-flow="([^"]+)"[^>]*data-oneyear-flow="([^"]+)"[^>]*>([\s\S]*?)<\/article>/g)];

  const rows = [];
  for (const m of articles) {
    const [, aum, fortnightFlow, oneyearFlow, inner] = m;
    const sectorName = inner.match(/<div class="box-title[^"]*"[^>]*>\s*(?:<a[^>]*>)?([^<\n]+)(?:<\/a>)?\s*<\/div>/)?.[1]?.trim();
    const aumPct     = inner.match(/(\d+\.?\d*)% of AUM/)?.[1];
    const sparkVals  = inner.match(/data-sparkline-values="([^"]+)"/)?.[1] ?? '';
    if (!sectorName) continue;
    rows.push({
      sector:           sectorName,
      aum:              parseFloat(aum) || null,
      aum_pct:          aumPct ? parseFloat(aumPct) : null,
      fortnight_flow:   parseFloat(fortnightFlow) || null,
      oneyear_flow:     parseFloat(oneyearFlow) || null,
      sparkline_values: sparkVals,
      sparkline_labels: sparklineLabels,
      updated_at:       new Date().toISOString(),
    });
  }

  const { error } = await supabase
    .from('fii_sector')
    .upsert(rows, { onConflict: 'sector' });
  if (error) throw new Error('fii_sector upsert: ' + error.message);
  console.log(`  ✓ FII sectors: ${rows.length} sectors`);
}

// ── 3. FII + DII daily (NSE) ─────────────────────────────────────────────────

async function fetchFIIDIIDaily(nseCookies) {
  await new Promise(r => setTimeout(r, 2000)); // let session warm up
  const res = await fetch('https://www.nseindia.com/api/fiidiiTradeReact', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Referer': 'https://www.nseindia.com/reports/fii-dii',
      'Cookie': nseCookies,
    },
  });
  if (!res.ok) throw new Error('NSE FII/DII API: ' + res.status);
  const data = await res.json();

  const fii = data.find(d => d.category === 'FII/FPI');
  const dii = data.find(d => d.category === 'DII');
  if (!fii || !dii) throw new Error('NSE: missing FII or DII entry');

  const parseDate = (s) => {
    const [d, m, y] = s.split('-');
    const months = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
    return `${y}-${months[m]}-${d.padStart(2,'0')}`;
  };

  const row = {
    date:      parseDate(fii.date),
    fii_buy:   parseFloat(fii.buyValue),
    fii_sell:  parseFloat(fii.sellValue),
    fii_net:   parseFloat(fii.netValue),
    dii_buy:   parseFloat(dii.buyValue),
    dii_sell:  parseFloat(dii.sellValue),
    dii_net:   parseFloat(dii.netValue),
  };

  const { error } = await supabase
    .from('fii_dii_daily')
    .upsert(row, { onConflict: 'date' });
  if (error) throw new Error('fii_dii_daily upsert: ' + error.message);
  console.log(`  ✓ FII/DII daily: ${row.date} | FII net ₹${row.fii_net} Cr | DII net ₹${row.dii_net} Cr`);
  return row;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n[fiiAgent] ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST\n`);

  console.log('Logging into Screener...');
  const screenerSession = await getScreenerSession();

  console.log('Fetching FII cumulative flow (1Y daily)...');
  await fetchFIIFlow(screenerSession, 365);

  console.log('Fetching FII sector data...');
  await fetchFIISectors(screenerSession);

  console.log('Fetching NSE FII/DII daily...');
  const nseSession = await getNSESession();
  const fiiDiiRow  = await fetchFIIDIIDaily(nseSession);

  // Push FII/DII update to all users who have Telegram connected
  try {
    const { data: prefs } = await supabase
      .from('user_alert_preferences')
      .select('telegram_chat_id')
      .not('telegram_chat_id', 'is', null);
    const chatIds = (prefs ?? []).map(p => p.telegram_chat_id).filter(Boolean);
    if (chatIds.length && fiiDiiRow) {
      const fmt    = v => `₹${Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })} Cr`;
      const fiiUp  = fiiDiiRow.fii_net >= 0;
      const diiUp  = fiiDiiRow.dii_net >= 0;
      const msg = [
        `🌍 *FII / DII Update · ${fiiDiiRow.date}*`,
        '',
        `${fiiUp ? '🟢' : '🔴'} FII: ${fiiUp ? '+' : '-'}${fmt(fiiDiiRow.fii_net)} net ${fiiUp ? 'buying' : 'selling'}`,
        `${diiUp ? '🟢' : '🔴'} DII: ${diiUp ? '+' : '-'}${fmt(fiiDiiRow.dii_net)} net ${diiUp ? 'buying' : 'selling'}`,
      ].join('\n');
      await sendToMany(chatIds, msg);
      console.log(`  ✓ FII/DII push sent to ${chatIds.length} user(s)`);
    }
  } catch (e) {
    console.log(`  ⚠ FII/DII push failed: ${e.message}`);
  }

  console.log('\n✅ fiiAgent complete.');
}

main().catch(err => { console.error('❌ fiiAgent error:', err.message); process.exit(1); });
