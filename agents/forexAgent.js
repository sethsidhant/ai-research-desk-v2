// forexAgent.js — Fetches India forex reserves from RBI Weekly Statistical Supplement
// Run: node forexAgent.js          → fetch latest week only (idempotent)
// Run: node forexAgent.js backfill → fetch all available weeks (2025–2026)

require('dotenv').config({ path: '../.env.local' });

const https      = require('https');
const { createClient } = require('@supabase/supabase-js');
const { sendMacro }    = require('./telegramAlert');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const BACKFILL = process.argv[2] === 'backfill';

// ── HTTP helper ───────────────────────────────────────────────────────────────

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ── Parse WSS listing page → [{date, id}] ────────────────────────────────────

async function fetchEntries() {
  const html = await get('https://www.rbi.org.in/scripts/WSSViewDetail.aspx?PARAM1=2&TYPE=Section');
  return [...html.matchAll(/(\d{2}\s+\w+\s+\d{4})[\s\S]*?href=WSSView\.aspx\?Id=(\d+)/g)]
    .map(m => ({ dateStr: m[1], id: m[2] }));
}

// ── Parse one WSSView detail page ─────────────────────────────────────────────

function parseNum(s) {
  const n = parseFloat((s ?? '').toString().replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

async function fetchForexRow(id) {
  const html = await get(`https://www.rbi.org.in/scripts/WSSView.aspx?Id=${id}`);

  // Extract "as on" date — handles "May 01, 2026" and "Aug. 01, 2025"
  const asOnMatch = html.match(/As on ([A-Za-z]+\.?\s+\d+,\s+\d{4})/);
  if (!asOnMatch) return null;
  // Parse via UTC to avoid timezone shift (local midnight IST = prev day in UTC)
  const asOnDate = new Date(asOnMatch[1].replace('.', '') + ' UTC');
  if (isNaN(asOnDate.getTime())) return null;
  const date = asOnDate.toISOString().slice(0, 10);

  // Parse table rows
  const rows = [...html.matchAll(/<tr[^>]*>(.*?)<\/tr>/gis)]
    .map(m => [...m[1].matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/gis)]
      .map(c => c[1].replace(/<[^>]+>/g, '').replace(/&#8377;/g, '₹').replace(/&amp;/g, '&').trim())
    );

  // Find rows by label
  function findRow(label) {
    return rows.find(r => r[0] && r[0].replace(/[^a-zA-Z\s]/g, '').toLowerCase().includes(label.toLowerCase()));
  }

  const total = findRow('Total Reserves');
  const fca   = findRow('Foreign Currency Assets');
  const gold  = findRow('Gold');
  const sdrs  = findRow('SDRs');
  const imf   = findRow('Reserve Position');

  if (!total) return null;

  // Columns: [label, INR_Cr, USD_Mn, WoW_INR, WoW_USD, EndMar_INR, EndMar_USD, YoY_INR, YoY_USD]
  return {
    date,
    total_usd_mn:     parseNum(total[2]),
    fca_usd_mn:       parseNum(fca?.[2]),
    gold_usd_mn:      parseNum(gold?.[2]),
    sdrs_usd_mn:      parseNum(sdrs?.[2]),
    imf_usd_mn:       parseNum(imf?.[2]),
    wow_change_usd_mn: parseNum(total[4]),
    yoy_change_usd_mn: parseNum(total[8]),
  };
}

// ── Send Telegram alert for new weekly data ────────────────────────────────────

async function sendAlert(row) {
  const total  = (row.total_usd_mn / 1000).toFixed(1);
  const wow    = row.wow_change_usd_mn;
  const wowAbs = Math.abs(wow / 1000).toFixed(1);
  const wowDir = wow >= 0 ? '▲' : '▼';
  const emoji  = wow >= 0 ? '🟢' : '🔴';
  const yoy    = row.yoy_change_usd_mn;
  const yoyAbs = Math.abs(yoy / 1000).toFixed(1);
  const yoyDir = yoy >= 0 ? '+' : '-';
  const date   = new Date(row.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  // Fetch 6M history for signal computation (total + gold)
  const now6m = new Date(row.date + ' UTC'); now6m.setMonth(now6m.getMonth() - 6);
  const now3m = new Date(row.date + ' UTC'); now3m.setMonth(now3m.getMonth() - 3);
  const { data: history } = await supabase
    .from('forex_reserves')
    .select('date, total_usd_mn, gold_usd_mn')
    .gte('date', now6m.toISOString().slice(0, 10))
    .order('date', { ascending: true });

  const hist6m = history ?? [];
  const hist3m = hist6m.filter(r => r.date >= now3m.toISOString().slice(0, 10));
  const prev   = hist6m.length >= 2 ? hist6m[hist6m.length - 2] : null;

  // Total reserves: 3M/6M low flag
  const low6m = hist6m.length ? Math.min(...hist6m.map(r => r.total_usd_mn)) : null;
  const low3m = hist3m.length ? Math.min(...hist3m.map(r => r.total_usd_mn)) : null;
  const lowFlag = (low6m !== null && (row.total_usd_mn - low6m) / low6m < 0.01)
    ? `\n⚠️ *Near 6M low* ($${(low6m/1000).toFixed(1)}B) — reserves under pressure`
    : (low3m !== null && (row.total_usd_mn - low3m) / low3m < 0.01)
    ? `\n⚠️ *Near 3M low* ($${(low3m/1000).toFixed(1)}B) — reserves under pressure`
    : '';

  // Gold signals
  let goldSignal = '';
  if (hist6m.length >= 4) {
    const g       = row.gold_usd_mn;
    const gVals6m = hist6m.map(r => r.gold_usd_mn);
    const gVals3m = hist3m.map(r => r.gold_usd_mn);
    const gMin6m  = Math.min(...gVals6m); const gMax6m = Math.max(...gVals6m);
    const gMin3m  = gVals3m.length ? Math.min(...gVals3m) : null;
    const gMax3m  = gVals3m.length ? Math.max(...gVals3m) : null;
    const last4   = gVals6m.slice(-4); const prior4 = gVals6m.slice(-8, -4);
    const avg4    = last4.reduce((s,v)=>s+v,0)/(last4.length||1);
    const avg8    = prior4.length ? prior4.reduce((s,v)=>s+v,0)/prior4.length : avg4;
    if      ((gMax6m - g) / gMax6m < 0.01)                            goldSignal = '🟡 Gold near *6M high* — RBI accumulating aggressively';
    else if (gMax3m !== null && (gMax3m - g) / gMax3m < 0.01)         goldSignal = '🟡 Gold near *3M high* — RBI accumulating';
    else if ((g - gMin6m) / gMin6m < 0.01)                            goldSignal = '⚠️ Gold near *6M low* — price drop or RBI selling';
    else if (gMin3m !== null && (g - gMin3m) / gMin3m < 0.01)         goldSignal = '⚠️ Gold near *3M low* — price drop or RBI selling';
    else if (avg4 > avg8 * 1.005)                                      goldSignal = '🟡 Gold trending *up* (4-week) — RBI diversifying';
    else if (avg4 < avg8 * 0.995)                                      goldSignal = '📉 Gold trending *down* (4-week)';
  }

  // FII context for the week
  const weekStart = new Date(row.date + ' UTC'); weekStart.setDate(weekStart.getDate() - 6);
  const { data: fiiRows } = await supabase
    .from('fii_dii_daily').select('fii_net')
    .gte('date', weekStart.toISOString().slice(0, 10))
    .lte('date', row.date);
  const fiiWeekly = fiiRows?.reduce((s, r) => s + (r.fii_net ?? 0), 0) ?? null;
  let fiiLine = '';
  if (fiiWeekly !== null) {
    const fiiAmt   = Math.abs(Math.round(fiiWeekly)).toLocaleString('en-IN');
    const fiiEmoji = fiiWeekly >= 0 ? '🟢' : '🔴';
    const fiiDir   = fiiWeekly >= 0 ? 'bought' : 'sold';
    const insight  = wow < 0 && fiiWeekly < 0  ? ' — RBI likely sold USD as FIIs pulled out'
      : wow < 0 && fiiWeekly >= 0              ? ' — reserves dipped despite FII inflows'
      : wow >= 0 && fiiWeekly < 0             ? ' — reserves rose despite FII outflows'
      :                                          ' — FII inflows supporting reserves';
    fiiLine = `\n${fiiEmoji} FII ${fiiDir} ₹${fiiAmt}cr same week${insight}`;
  }

  const goldLine = goldSignal ? `\n${goldSignal}` : '';

  const msg = `${emoji} 🏦 *Forex Reserves — ${date}*
Total: *$${total}B* ${wowDir} $${wowAbs}B WoW

💵 FCA: $${(row.fca_usd_mn/1000).toFixed(1)}B
🥇 Gold: $${(row.gold_usd_mn/1000).toFixed(1)}B${prev ? ` (${row.gold_usd_mn >= prev.gold_usd_mn ? '▲' : '▼'} $${Math.abs((row.gold_usd_mn-prev.gold_usd_mn)/1000).toFixed(1)}B)` : ''}
📋 SDRs: $${(row.sdrs_usd_mn/1000).toFixed(1)}B
🏛 IMF: $${(row.imf_usd_mn/1000).toFixed(1)}B

📅 YoY: ${yoyDir}$${yoyAbs}B${fiiLine}${lowFlag}${goldLine}`;

  await sendMacro(msg);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[forexAgent] Starting${BACKFILL ? ' (backfill mode)' : ''}...`);

  const entries = await fetchEntries();
  console.log(`[forexAgent] Found ${entries.length} entries on WSS page`);

  // Filter to 2025+ only for backfill; only most recent otherwise
  const toFetch = BACKFILL
    ? entries.filter(e => e.dateStr.includes('2025') || e.dateStr.includes('2026'))
    : entries.slice(0, 1);

  console.log(`[forexAgent] Processing ${toFetch.length} entries...`);

  let inserted = 0;
  let latestNew = null;

  for (const entry of toFetch) {
    try {
      const row = await fetchForexRow(entry.id);
      if (!row) { console.log(`[forexAgent] Could not parse Id=${entry.id}`); continue; }

      // Check if already stored
      const { data: existing } = await supabase
        .from('forex_reserves')
        .select('date')
        .eq('date', row.date)
        .single();

      if (existing) {
        console.log(`[forexAgent] ${row.date}: already stored — skipping`);
        continue;
      }

      const { error } = await supabase.from('forex_reserves').insert(row);
      if (error) {
        console.error(`[forexAgent] ${row.date}: DB error — ${error.message}`);
        continue;
      }

      console.log(`[forexAgent] ${row.date}: inserted — total $${(row.total_usd_mn/1000).toFixed(1)}B, WoW ${row.wow_change_usd_mn >= 0 ? '+' : ''}${(row.wow_change_usd_mn/1000).toFixed(1)}B`);
      inserted++;

      // Track the most recent new entry for the Telegram alert
      if (!latestNew || row.date > latestNew.date) latestNew = row;

      // Throttle requests in backfill mode
      if (BACKFILL) await new Promise(r => setTimeout(r, 400));

    } catch (e) {
      console.error(`[forexAgent] Id=${entry.id}: ${e.message}`);
    }
  }

  console.log(`[forexAgent] Done — ${inserted} new row(s) inserted`);

  // Send Telegram alert only for the most recent newly inserted entry (not backfill)
  if (latestNew && !BACKFILL) {
    await sendAlert(latestNew);
    console.log(`[forexAgent] Telegram alert sent for ${latestNew.date}`);
  }
}

main().catch(e => { console.error('[forexAgent]', e.message); process.exit(1); });
