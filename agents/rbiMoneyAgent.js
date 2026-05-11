// rbiMoneyAgent.js — Fetches RBI money supply (M3), bank credit, banking ratios + INR rate
// Run: node rbiMoneyAgent.js          → latest fortnight only
// Run: node rbiMoneyAgent.js backfill → last 1 year of fortnightly data

require('dotenv').config({ path: '../.env.local' });

const https = require('https');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const BACKFILL = process.argv[2] === 'backfill';
const MONTHS   = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };

// ── HTTP helper ────────────────────────────────────────────────────────────────

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 20000 }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ── Generic row parser ─────────────────────────────────────────────────────────

function parseRows(html) {
  return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(m =>
    [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c =>
      c[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ')
           .replace(/&lsquo;|&rsquo;/g, "'").replace(/&nbsp;/g, '')
           .replace(/&#8377;/g, '₹').replace(/&#\d+;/g, '').trim()
    )
  ).filter(r => r.some(c => c.length > 0));
}

function parseNum(s) {
  const n = parseFloat((s ?? '').replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

// Parse "Apr. 30" or "Apr 30" with a known year into a date string
function parseDateCell(cell, year) {
  if (!cell) return null;
  const clean = cell.replace('*', '').replace('.', '').trim(); // "Apr 30"
  const parts = clean.split(/\s+/);
  if (parts.length < 2) return null;
  const mon = MONTHS[parts[0].toLowerCase().slice(0, 3)];
  const day = parseInt(parts[1]);
  if (mon === undefined || isNaN(day)) return null;
  return new Date(Date.UTC(year, mon, day)).toISOString().slice(0, 10);
}

// ── Section 7: Money Stock (M3) ────────────────────────────────────────────────

async function fetchM3Entries() {
  const html = await get('https://www.rbi.org.in/Scripts/WSSViewDetail.aspx?PARAM1=7&TYPE=Section');
  return [...html.matchAll(/(\d{2}\s+\w+\s+\d{4})[\s\S]*?href=WSSView\.aspx\?Id=(\d+)/g)]
    .map(m => ({ pubDateStr: m[1], id: m[2] }));
}

function parseM3Detail(html) {
  // Publication year from "Date : May 08, 2026"
  const pubYearMatch = html.match(/Date\s*:\s*\w+\s+\d+,\s+(\d{4})/);
  const pubYear = pubYearMatch ? parseInt(pubYearMatch[1]) : new Date().getFullYear();

  const rows = parseRows(html);

  // Find data date: look for the row containing "Mar." in the first cell (year-end reference)
  // The SECOND cell of that row is the current data date ("Apr. 30")
  let dataDate = null;
  for (const row of rows) {
    if (row[0] && row[0].includes('Mar.') && row[1]) {
      dataDate = parseDateCell(row[1], pubYear);
      break;
    }
  }
  if (!dataDate) return null;

  function findRow(label) {
    return rows.find(r => r[0] && r[0].replace(/[^a-zA-Z\s]/g, '').toLowerCase().includes(label.toLowerCase()));
  }

  const m3Row     = findRow('M3');
  const currRow   = findRow('Currency with the Public');
  const demandRow = findRow('Demand Deposits with Banks');
  const timeRow   = findRow('Time Deposits with Banks');
  const bcRow     = findRow('Bank Credit to Commercial');

  if (!m3Row) return null;

  // Columns (0=label, 1=prev yr end, 2=current, 3=FN amt, 4=FN%, 5=FY amt, 6=FY%,
  //          7=YoY2025 amt, 8=YoY2025%, 9=YoY2026 amt, 10=YoY2026%)
  // For historical entries the YoY columns shift — so we store absolute values only
  // and compute YoY on the frontend from history.

  return {
    date:                dataDate,
    m3_cr:               parseNum(m3Row[2]),
    currency_public_cr:  parseNum(currRow?.[2]),
    demand_deposits_cr:  parseNum(demandRow?.[2]),
    time_deposits_cr:    parseNum(timeRow?.[2]),
    bank_credit_cr:      parseNum(bcRow?.[2]),
  };
}

// ── Section 4: Ratios & Rates ──────────────────────────────────────────────────

async function fetchRatioEntries() {
  const html = await get('https://www.rbi.org.in/Scripts/WSSViewDetail.aspx?PARAM1=4&TYPE=Section');
  return [...html.matchAll(/(\d{2}\s+\w+\s+\d{4})[\s\S]*?href=WSSView\.aspx\?Id=(\d+)/g)]
    .map(m => ({ pubDateStr: m[1], id: m[2] }));
}

function parseRatiosDetail(html) {
  const rows = parseRows(html);

  function findRow(label) {
    return rows.find(r => r[0] && r[0].toLowerCase().includes(label.toLowerCase()));
  }

  const cdRow  = findRow('Credit-Deposit Ratio');
  const cashRow = findRow('Cash-Deposit Ratio');
  const invRow  = findRow('Investment-Deposit Ratio');

  if (!cdRow) return null;

  // Latest value is the last non-empty numeric cell
  function latestVal(row) {
    if (!row) return null;
    const nums = row.slice(1).filter(c => c && parseNum(c) !== null);
    return parseNum(nums[nums.length - 1]);
  }

  return {
    credit_deposit_ratio:      latestVal(cdRow),
    cash_deposit_ratio:        latestVal(cashRow),
    investment_deposit_ratio:  latestVal(invRow),
  };
}

// ── INR daily from Yahoo Finance ───────────────────────────────────────────────

async function fetchInrData(range = '1mo') {
  const raw = await get(`https://query1.finance.yahoo.com/v8/finance/chart/USDINR=X?interval=1d&range=${range}`);
  const j   = JSON.parse(raw);
  const res = j.chart?.result?.[0];
  if (!res) return [];
  const ts      = res.timestamp;
  const closes  = res.indicators.quote[0].close;
  return ts.map((t, i) => ({
    date:    new Date(t * 1000).toISOString().slice(0, 10),
    usd_inr: closes[i] ? parseFloat(closes[i].toFixed(4)) : null,
  })).filter(r => r.usd_inr !== null);
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[rbiMoneyAgent] Starting${BACKFILL ? ' (backfill mode)' : ''}...`);

  // Fetch listing pages
  const [m3Entries, ratioEntries] = await Promise.all([fetchM3Entries(), fetchRatioEntries()]);
  console.log(`[rbiMoneyAgent] M3 entries: ${m3Entries.length}, Ratio entries: ${ratioEntries.length}`);

  // Build ratio lookup by publication date string
  const ratioByPubDate = new Map(ratioEntries.map(e => [e.pubDateStr, e]));

  // Limit entries to process
  const toProcess = BACKFILL
    ? m3Entries.filter(e => {
        const yr = parseInt(e.pubDateStr.slice(-4));
        return yr >= new Date().getFullYear() - 1;
      }).slice(0, 52) // at most 52 fortnights (2 years)
    : m3Entries.slice(0, 1);

  console.log(`[rbiMoneyAgent] Processing ${toProcess.length} M3 entries...`);

  let inserted = 0;

  for (const entry of toProcess) {
    try {
      // Check if already stored (we don't know the data date yet, so fetch anyway and check after parsing)
      const m3Html = await get(`https://www.rbi.org.in/scripts/WSSView.aspx?Id=${entry.id}`);
      const m3Data = parseM3Detail(m3Html);
      if (!m3Data) { console.log(`[rbiMoneyAgent] M3 parse failed Id=${entry.id}`); continue; }

      const { data: existing } = await supabase
        .from('rbi_money_credit').select('date').eq('date', m3Data.date).single();
      if (existing) { console.log(`[rbiMoneyAgent] ${m3Data.date}: already stored — skipping`); continue; }

      // Fetch matching ratio entry
      const ratioEntry = ratioByPubDate.get(entry.pubDateStr);
      let ratios = {};
      if (ratioEntry) {
        const ratioHtml = await get(`https://www.rbi.org.in/scripts/WSSView.aspx?Id=${ratioEntry.id}`);
        ratios = parseRatiosDetail(ratioHtml) ?? {};
      }

      const row = { ...m3Data, ...ratios, created_at: new Date().toISOString() };
      const { error } = await supabase.from('rbi_money_credit').insert(row);

      if (error) { console.error(`[rbiMoneyAgent] DB error ${m3Data.date}: ${error.message}`); continue; }

      const m3B = m3Data.m3_cr ? (m3Data.m3_cr / 1e5).toFixed(1) + 'L Cr' : '—';
      console.log(`[rbiMoneyAgent] ${m3Data.date}: inserted — M3 ₹${m3B}, C/D ${ratios.credit_deposit_ratio ?? '—'}%`);
      inserted++;

      if (BACKFILL) await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.error(`[rbiMoneyAgent] Id=${entry.id}: ${e.message}`);
    }
  }

  console.log(`[rbiMoneyAgent] M3 done — ${inserted} rows inserted`);

  // INR rates
  const inrRange = BACKFILL ? '2y' : '1wk';
  console.log(`[rbiMoneyAgent] Fetching INR rates (${inrRange})...`);
  const inrRows = await fetchInrData(inrRange);

  if (inrRows.length) {
    const { error } = await supabase
      .from('rbi_inr_daily')
      .upsert(inrRows, { onConflict: 'date' });
    if (error) console.error('[rbiMoneyAgent] INR DB error:', error.message);
    else console.log(`[rbiMoneyAgent] INR done — ${inrRows.length} rows upserted`);
  }
}

main().catch(e => { console.error('[rbiMoneyAgent]', e.message); process.exit(1); });
