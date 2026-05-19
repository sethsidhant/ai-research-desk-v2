// importAllEtfs.js — auto-import all NSE ETFs from Kite instruments list
// Matches each ETF to its INAV ticker, auto-detects category from name.
// Safe to re-run — upserts on ticker.
// Usage: node importAllEtfs.js

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

function parseCsvLine(line) {
  const cols = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { cols.push(cur); cur = ''; }
    else { cur += ch; }
  }
  cols.push(cur);
  return cols;
}

function parseInstruments(csv) {
  const lines = csv.split('\n').slice(1);
  const results = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const c = parseCsvLine(line);
    if (!c[0] || !c[2]) continue;
    results.push({
      instrument_token: parseInt(c[0]),
      tradingsymbol:    c[2].trim(),
      name:             c[3].trim(),
      instrument_type:  c[9]?.trim(),
      segment:          c[10]?.trim(),
      exchange:         c[11]?.trim(),
    });
  }
  return results;
}

function detectCategory(ticker, name) {
  const t = ticker.toUpperCase();
  const n = name.toUpperCase();
  if (/GOLD/.test(t) || /\bGOLD\b/.test(n))           return 'gold';
  if (/SILVER/.test(t) || /\bSILVER\b/.test(n))        return 'silver';
  if (/LIQUID/.test(t) || /LIQUID/.test(n))             return 'liquid';
  if (/GILT|GSEC|G.SEC|SDL|BOND/.test(t) || /GILT|G-SEC|GSEC|SDL|BHARAT BOND/.test(n)) return 'debt';
  if (/NASDAQ|FANG|HANG.?SENG|MSCI|S.?P.?500|NYSE|WORLD|GLOBAL/.test(t+n)) return 'international';
  if (/MIDCAP|MID150|MID100|MOM100|MOM50|MID15/.test(t)) return 'equity_midcap';
  if (/SMALLCAP|SMALL/.test(t) || /SMALLCAP|SMALL.?CAP/.test(n)) return 'equity_smallcap';
  if (/BANK|IT\b|TECH|PHARMA|AUTO|FMCG|CONSUM|INFRA|PSU|CPSE|ENERGY|METAL|REALTY|HEALTH|DEFENCE|SERV|TOURISM|ALPHA|VALUE|QUALITY|MOMENTUM|DIVIDEND|ESG|LOW.?VOL/.test(t)) return 'equity_sector';
  if (/BANK|INFORMATION TECH|PHARMA|AUTOMOBI|FMCG|CONSUM|INFRA|PSU|CPSE|ENERGY|METAL|REALTY|HEALTH|DEFENCE|SERVICES|TOURISM/.test(n)) return 'equity_sector';
  return 'equity_broad';
}

function fundHouseFromName(name) {
  const n = name.toUpperCase();
  if (n.includes('NIPPON'))                return 'Nippon';
  if (n.includes('HDFC'))                  return 'HDFC';
  if (n.includes('ICICI'))                 return 'ICICI';
  if (n.includes('KOTAK'))                 return 'Kotak';
  if (n.includes('SBI'))                   return 'SBI';
  if (n.includes('MOTILAL') || n.includes('MOAMC')) return 'Motilal';
  if (n.includes('MIRAE'))                 return 'Mirae';
  if (n.includes('AXIS'))                  return 'Axis';
  if (n.includes('DSP'))                   return 'DSP';
  if (n.includes('ADITYA BIRLA') || n.includes('ABSL') || n.includes('BSL')) return 'ABSL';
  if (n.includes('UTI'))                   return 'UTI';
  if (n.includes('EDELWEISS'))             return 'Edelweiss';
  if (n.includes('BANDHAN'))               return 'Bandhan';
  if (n.includes('TATA'))                  return 'Tata';
  if (n.includes('GROWW'))                 return 'Groww';
  if (n.includes('ZERODHA'))               return 'Zerodha';
  if (n.includes('QUANTUM'))               return 'Quantum';
  if (n.includes('LIC'))                   return 'LIC';
  if (n.includes('FRANKLIN'))              return 'Franklin';
  if (n.includes('BARODA') || n.includes('BNP')) return 'Baroda BNP';
  if (n.includes('NAVI'))                  return 'Navi';
  if (n.includes('360'))                   return '360 ONE';
  if (n.includes('UNION'))                 return 'Union';
  if (n.includes('CHOICE'))                return 'Choice';
  return 'Other';
}

// Preserve manually curated expense_ratio + aum_cr for our 29 known ETFs
const MANUAL_META = {
  NIFTYBEES:  { expense_ratio: 0.04, aum_cr: 11000, underlying_index: 'Nifty 50' },
  JUNIORBEES: { expense_ratio: 0.13, aum_cr: 4200,  underlying_index: 'Nifty Next 50' },
  HDFCNIFTY:  { expense_ratio: 0.10, aum_cr: 8500,  underlying_index: 'Nifty 50' },
  NIFTYIETF:  { expense_ratio: 0.05, aum_cr: 12000, underlying_index: 'Nifty 50' },
  NIFTY1:     { expense_ratio: 0.05, aum_cr: 8000,  underlying_index: 'Nifty 50' },
  SETFNIF50:  { expense_ratio: 0.07, aum_cr: 7500,  underlying_index: 'Nifty 50' },
  SETFNN50:   { expense_ratio: 0.13, aum_cr: 1500,  underlying_index: 'Nifty Next 50' },
  MID150BEES: { expense_ratio: 0.30, aum_cr: 2200,  underlying_index: 'Nifty Midcap 150' },
  MOM100:     { expense_ratio: 0.35, aum_cr: 2100,  underlying_index: 'Nifty Midcap 100' },
  MIDCAPIETF: { expense_ratio: 0.25, aum_cr: 1200,  underlying_index: 'Nifty Midcap 150' },
  BANKBEES:   { expense_ratio: 0.19, aum_cr: 8000,  underlying_index: 'Nifty Bank' },
  ITBEES:     { expense_ratio: 0.37, aum_cr: 3000,  underlying_index: 'Nifty IT' },
  PHARMABEES: { expense_ratio: 0.35, aum_cr: 1800,  underlying_index: 'Nifty Pharma' },
  AUTOBEES:   { expense_ratio: 0.35, aum_cr: 600,   underlying_index: 'Nifty Auto' },
  SBIETFIT:   { expense_ratio: 0.24, aum_cr: 1800,  underlying_index: 'Nifty IT' },
  SBIETFPB:   { expense_ratio: 0.45, aum_cr: 400,   underlying_index: 'Nifty Pvt Bank' },
  CPSEETF:    { expense_ratio: 0.07, aum_cr: 10000, underlying_index: 'Nifty CPSE' },
  GOLDBEES:   { expense_ratio: 0.79, aum_cr: 9500,  underlying_index: 'Gold' },
  HDFCGOLD:   { expense_ratio: 0.59, aum_cr: 3200,  underlying_index: 'Gold' },
  GOLD1:      { expense_ratio: 0.55, aum_cr: 3500,  underlying_index: 'Gold' },
  SETFGOLD:   { expense_ratio: 0.50, aum_cr: 2800,  underlying_index: 'Gold' },
  SILVERBEES: { expense_ratio: 0.40, aum_cr: 2500,  underlying_index: 'Silver' },
  MON100:     { expense_ratio: 0.29, aum_cr: 13000, underlying_index: 'Nasdaq 100' },
  MAFANG:     { expense_ratio: 0.63, aum_cr: 3200,  underlying_index: 'NYSE FANG+' },
  MASPTOP50:  { expense_ratio: 0.18, aum_cr: 2000,  underlying_index: 'S&P 500 Top 50' },
  MAHKTECH:   { expense_ratio: 0.69, aum_cr: 400,   underlying_index: 'Hang Seng Tech' },
  GILT5YBEES: { expense_ratio: 0.19, aum_cr: 1500,  underlying_index: 'Nifty 5yr G-Sec' },
  LTGILTBEES: { expense_ratio: 0.24, aum_cr: 1200,  underlying_index: 'Nifty 8-13yr G-Sec' },
  LIQUIDBEES: { expense_ratio: 0.19, aum_cr: 6000,  underlying_index: 'Nifty 1D Rate' },
};

// Manual INAV mappings we verified
const MANUAL_INAV = {
  HDFCNIFTY:  { inav_ticker: 'HDFCNFINAV', inav_token: 2565889 },
  NIFTYIETF:  { inav_ticker: 'ICICIYINAV', inav_token: 2573825 },
  NIFTY1:     { inav_ticker: 'KOTAKNINAV', inav_token: 2580737 },
  SETFNIF50:  { inav_ticker: 'SETF50INAV', inav_token: 2601217 },
  SETFNN50:   { inav_ticker: 'SETFNNINAV', inav_token: 2602753 },
  MID150BEES: { inav_ticker: 'MID150INAV', inav_token: 2594305 },
  MOM100:     { inav_ticker: 'MOM100INAV', inav_token: 2591233 },
  MIDCAPIETF: { inav_ticker: 'ICICIMINAV', inav_token: 2571521 },
  ITBEES:     { inav_ticker: 'ITBEESINAV', inav_token: 2596097 },
  PHARMABEES: { inav_ticker: 'PHARMAINAV', inav_token: 2598145 },
  AUTOBEES:   { inav_ticker: 'AUTOBEINAV', inav_token: 2598401 },
  SBIETFIT:   { inav_ticker: 'SBIETFINAV', inav_token: 2600961 },
  SBIETFPB:   { inav_ticker: 'SBIFPBINAV', inav_token: 2599425 },
  CPSEETF:    { inav_ticker: 'ICICI2INAV', inav_token: 2567169 },
  GOLDBEES:   { inav_ticker: 'GOLDBEINAV', inav_token: 2106113 },
  HDFCGOLD:   { inav_ticker: 'HDFCMFINAV', inav_token: 2109697 },
  GOLD1:      { inav_ticker: 'KOTAKGINAV', inav_token: 2112513 },
  SETFGOLD:   { inav_ticker: 'SETFGOINAV', inav_token: 2114049 },
  SILVERBEES: { inav_ticker: 'MGBEESINAV', inav_token: 7818497 },
  MON100:     { inav_ticker: 'MON100INAV', inav_token: 2593281 },
  MAFANG:     { inav_ticker: 'MAFANGINAV', inav_token: 2590209 },
  MASPTOP50:  { inav_ticker: 'MASPTOINAV', inav_token: 2590465 },
  MAHKTECH:   { inav_ticker: 'MAHKTEINAV', inav_token: 2586881 },
  GILT5YBEES: { inav_ticker: 'GILT5YINAV', inav_token: 2597889 },
  LTGILTBEES: { inav_ticker: 'LTGILTINAV', inav_token: 2594049 },
  LIQUIDBEES: { inav_ticker: 'LIQUIDINAV', inav_token: 2593793 },
};

async function main() {
  console.log('[importAllEtfs] Fetching Kite instruments...');
  const csv         = await get('https://api.kite.trade/instruments');
  const instruments = parseInstruments(csv);
  const nse         = instruments.filter(r => r.segment === 'NSE');

  console.log(`[importAllEtfs] ${nse.length} NSE instruments total`);

  // Split into INAVs and non-INAVs
  const inavMap  = new Map(); // inavTicker -> { token, desc }
  const etfList  = [];

  for (const inst of nse) {
    const t = inst.tradingsymbol;
    const n = inst.name.toUpperCase();

    if (t.endsWith('INAV') || t.endsWith('INAV-RL') || n.includes(' INAV') || n.endsWith(' NAV')) {
      // This is an INAV instrument — build reverse lookup by first word of name
      const firstWord = inst.name.split(/\s+/)[0].toUpperCase();
      inavMap.set(firstWord, { ticker: t, token: inst.instrument_token });
      continue;
    }

    // Filter to ETF-like instruments
    const isEtf = n.includes('ETF') || t.endsWith('BEES') || n.includes(' BEES')
      || n.includes('GOLD ETF') || n.includes('SILVER ETF');

    if (isEtf) etfList.push(inst);
  }

  console.log(`[importAllEtfs] ${etfList.length} ETF instruments · ${inavMap.size} INAV instruments`);

  // Build rows to upsert
  const rows = etfList.map(inst => {
    const ticker   = inst.tradingsymbol;
    const name     = inst.name.replace(/^"/, '').replace(/"$/, '').trim();
    const manual   = MANUAL_META[ticker] ?? {};
    const manualInav = MANUAL_INAV[ticker] ?? {};

    // Try auto-match INAV: look for first word of ETF ticker in inavMap
    let inav_ticker = manualInav.inav_ticker ?? null;
    let inav_token  = manualInav.inav_token  ?? null;

    if (!inav_ticker) {
      // Try ticker itself as key
      const hit = inavMap.get(ticker);
      if (hit) { inav_ticker = hit.ticker; inav_token = hit.token; }
    }

    return {
      ticker,
      name,
      fund_house:        fundHouseFromName(name),
      category:          detectCategory(ticker, name),
      underlying_index:  manual.underlying_index ?? null,
      expense_ratio:     manual.expense_ratio ?? null,
      aum_cr:            manual.aum_cr ?? null,
      instrument_token:  inst.instrument_token,
      inav_ticker,
      inav_token,
    };
  });

  // Upsert in batches of 100
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const { error } = await supabase.from('etfs').upsert(batch, { onConflict: 'ticker' });
    if (error) { console.error(`[importAllEtfs] Batch ${i/100+1} error: ${error.message}`); continue; }
    inserted += batch.length;
  }

  console.log(`[importAllEtfs] Done — ${inserted}/${rows.length} ETFs upserted`);

  // Summary by category
  const byCat = {};
  for (const r of rows) byCat[r.category] = (byCat[r.category] ?? 0) + 1;
  for (const [cat, count] of Object.entries(byCat).sort((a,b) => b[1]-a[1])) {
    console.log(`  ${cat.padEnd(20)} ${count}`);
  }
  const withInav = rows.filter(r => r.inav_ticker).length;
  console.log(`\n  ${withInav} ETFs have INAV (live NAV premium/discount)`);
}

main().catch(e => { console.error('[importAllEtfs]', e.message); process.exit(1); });
