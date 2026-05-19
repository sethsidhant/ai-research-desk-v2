// seedEtfs.js — seed the etfs table with curated Indian NSE ETFs
// Run once: node seedEtfs.js
// All instrument_token values from Kite instruments list (NSE segment)

require('dotenv').config({ path: '../.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// SQL to create the table (run in Supabase SQL editor first):
// create table etfs (
//   id uuid primary key default gen_random_uuid(),
//   ticker text unique not null,
//   name text not null,
//   fund_house text not null,
//   category text not null,
//   underlying_index text,
//   expense_ratio numeric,
//   aum_cr numeric,
//   instrument_token bigint,
//   inav_ticker text,
//   inav_token bigint,
//   created_at timestamptz default now()
// );

const ETF_DATA = [
  // ── Equity Broad Index ────────────────────────────────────────────────────
  { ticker:'NIFTYBEES',  name:'Nippon India ETF Nifty 50 BeES',    fund_house:'Nippon', category:'equity_broad',   underlying_index:'Nifty 50',       expense_ratio:0.04, aum_cr:11000, instrument_token:2707457,  inav_ticker:null,         inav_token:null    },
  { ticker:'JUNIORBEES', name:'Nippon India ETF Nifty Next 50',    fund_house:'Nippon', category:'equity_broad',   underlying_index:'Nifty Next 50',  expense_ratio:0.13, aum_cr:4200,  instrument_token:2800385,  inav_ticker:null,         inav_token:null    },
  { ticker:'HDFCNIFTY',  name:'HDFC Nifty 50 ETF',                 fund_house:'HDFC',   category:'equity_broad',   underlying_index:'Nifty 50',       expense_ratio:0.10, aum_cr:8500,  instrument_token:2967297,  inav_ticker:'HDFCNFINAV', inav_token:2565889 },
  { ticker:'NIFTYIETF',  name:'ICICI Pru Nifty 50 ETF',            fund_house:'ICICI',  category:'equity_broad',   underlying_index:'Nifty 50',       expense_ratio:0.05, aum_cr:12000, instrument_token:7565569,  inav_ticker:'ICICIYINAV', inav_token:2573825 },
  { ticker:'NIFTY1',     name:'Kotak Nifty 50 ETF',                fund_house:'Kotak',  category:'equity_broad',   underlying_index:'Nifty 50',       expense_ratio:0.05, aum_cr:8000,  instrument_token:4634113,  inav_ticker:'KOTAKNINAV', inav_token:2580737 },
  { ticker:'SETFNIF50',  name:'SBI Nifty 50 ETF',                  fund_house:'SBI',    category:'equity_broad',   underlying_index:'Nifty 50',       expense_ratio:0.07, aum_cr:7500,  instrument_token:2605057,  inav_ticker:'SETF50INAV', inav_token:2601217 },
  { ticker:'SETFNN50',   name:'SBI Nifty Next 50 ETF',             fund_house:'SBI',    category:'equity_broad',   underlying_index:'Nifty Next 50',  expense_ratio:0.13, aum_cr:1500,  instrument_token:1882369,  inav_ticker:'SETFNNINAV', inav_token:2602753 },

  // ── Equity Midcap ─────────────────────────────────────────────────────────
  { ticker:'MID150BEES', name:'Nippon India ETF Nifty Midcap 150', fund_house:'Nippon', category:'equity_midcap',  underlying_index:'Nifty Midcap 150', expense_ratio:0.30, aum_cr:2200, instrument_token:2177537,  inav_ticker:'MID150INAV', inav_token:2594305 },
  { ticker:'MOM100',     name:'Motilal Oswal Nifty Midcap 100 ETF',fund_house:'Motilal',category:'equity_midcap',  underlying_index:'Nifty Midcap 100', expense_ratio:0.35, aum_cr:2100, instrument_token:5484289,  inav_ticker:'MOM100INAV', inav_token:2591233 },
  { ticker:'MIDCAPIETF', name:'ICICI Pru Nifty Midcap 150 ETF',   fund_house:'ICICI',  category:'equity_midcap',  underlying_index:'Nifty Midcap 150', expense_ratio:0.25, aum_cr:1200, instrument_token:4390913,  inav_ticker:'ICICIMINAV', inav_token:2571521 },

  // ── Equity Sectoral ───────────────────────────────────────────────────────
  { ticker:'BANKBEES',   name:'Nippon India ETF Bank BeES',        fund_house:'Nippon', category:'equity_sector',  underlying_index:'Nifty Bank',     expense_ratio:0.19, aum_cr:8000,  instrument_token:2928385,  inav_ticker:null,         inav_token:null    },
  { ticker:'ITBEES',     name:'Nippon India ETF Nifty IT',         fund_house:'Nippon', category:'equity_sector',  underlying_index:'Nifty IT',       expense_ratio:0.37, aum_cr:3000,  instrument_token:4885505,  inav_ticker:'ITBEESINAV', inav_token:2596097 },
  { ticker:'PHARMABEES', name:'Nippon India ETF Nifty Pharma',     fund_house:'Nippon', category:'equity_sector',  underlying_index:'Nifty Pharma',   expense_ratio:0.35, aum_cr:1800,  instrument_token:1273089,  inav_ticker:'PHARMAINAV', inav_token:2598145 },
  { ticker:'AUTOBEES',   name:'Nippon India ETF Nifty Auto',       fund_house:'Nippon', category:'equity_sector',  underlying_index:'Nifty Auto',     expense_ratio:0.35, aum_cr:600,   instrument_token:2017281,  inav_ticker:'AUTOBEINAV', inav_token:2598401 },
  { ticker:'SBIETFIT',   name:'SBI ETF IT',                        fund_house:'SBI',    category:'equity_sector',  underlying_index:'Nifty IT',       expense_ratio:0.24, aum_cr:1800,  instrument_token:189441,   inav_ticker:'SBIETFINAV', inav_token:2600961 },
  { ticker:'SBIETFPB',   name:'SBI ETF Private Bank',              fund_house:'SBI',    category:'equity_sector',  underlying_index:'Nifty Pvt Bank', expense_ratio:0.45, aum_cr:400,   instrument_token:184833,   inav_ticker:'SBIFPBINAV', inav_token:2599425 },
  { ticker:'CPSEETF',    name:'CPSE ETF',                          fund_house:'Mirae',  category:'equity_sector',  underlying_index:'Nifty CPSE',     expense_ratio:0.07, aum_cr:10000, instrument_token:595969,   inav_ticker:'ICICI2INAV', inav_token:2567169 },

  // ── Gold ──────────────────────────────────────────────────────────────────
  { ticker:'GOLDBEES',   name:'Nippon India ETF Gold BeES',        fund_house:'Nippon', category:'gold',           underlying_index:'Gold',           expense_ratio:0.79, aum_cr:9500,  instrument_token:3693569,  inav_ticker:'GOLDBEINAV', inav_token:2106113 },
  { ticker:'HDFCGOLD',   name:'HDFC Gold ETF',                     fund_house:'HDFC',   category:'gold',           underlying_index:'Gold',           expense_ratio:0.59, aum_cr:3200,  instrument_token:5003009,  inav_ticker:'HDFCMFINAV', inav_token:2109697 },
  { ticker:'GOLD1',      name:'Kotak Gold ETF',                    fund_house:'Kotak',  category:'gold',           underlying_index:'Gold',           expense_ratio:0.55, aum_cr:3500,  instrument_token:3803649,  inav_ticker:'KOTAKGINAV', inav_token:2112513 },
  { ticker:'SETFGOLD',   name:'SBI Gold ETF',                      fund_house:'SBI',    category:'gold',           underlying_index:'Gold',           expense_ratio:0.50, aum_cr:2800,  instrument_token:4421633,  inav_ticker:'SETFGOINAV', inav_token:2114049 },

  // ── Silver ────────────────────────────────────────────────────────────────
  { ticker:'SILVERBEES', name:'Nippon India Silver ETF',           fund_house:'Nippon', category:'silver',         underlying_index:'Silver',         expense_ratio:0.40, aum_cr:2500,  instrument_token:2068481,  inav_ticker:'MGBEESINAV', inav_token:7818497 },

  // ── International ─────────────────────────────────────────────────────────
  { ticker:'MON100',     name:'Motilal Oswal Nasdaq 100 ETF',      fund_house:'Motilal',category:'international',  underlying_index:'Nasdaq 100',     expense_ratio:0.29, aum_cr:13000, instrument_token:5821185,  inav_ticker:'MON100INAV', inav_token:2593281 },
  { ticker:'MAFANG',     name:'Mirae Asset NYSE FANG+ ETF',        fund_house:'Mirae',  category:'international',  underlying_index:'NYSE FANG+',     expense_ratio:0.63, aum_cr:3200,  instrument_token:897793,   inav_ticker:'MAFANGINAV', inav_token:2590209 },
  { ticker:'MASPTOP50',  name:'Mirae Asset S&P 500 Top 50 ETF',    fund_house:'Mirae',  category:'international',  underlying_index:'S&P 500 Top 50', expense_ratio:0.18, aum_cr:2000,  instrument_token:1480193,  inav_ticker:'MASPTOINAV', inav_token:2590465 },
  { ticker:'MAHKTECH',   name:'Mirae Asset Hang Seng Tech ETF',    fund_house:'Mirae',  category:'international',  underlying_index:'Hang Seng Tech', expense_ratio:0.69, aum_cr:400,   instrument_token:1810945,  inav_ticker:'MAHKTEINAV', inav_token:2586881 },

  // ── Debt / G-Sec ─────────────────────────────────────────────────────────
  { ticker:'GILT5YBEES', name:'Nippon India ETF Nifty 5Y G-Sec',  fund_house:'Nippon', category:'debt',           underlying_index:'Nifty 5yr Bmark G-Sec', expense_ratio:0.19, aum_cr:1500, instrument_token:812033,  inav_ticker:'GILT5YINAV', inav_token:2597889 },
  { ticker:'LTGILTBEES', name:'Nippon India ETF Long Term Gilt',   fund_house:'Nippon', category:'debt',           underlying_index:'Nifty 8-13yr G-Sec',    expense_ratio:0.24, aum_cr:1200, instrument_token:4531201, inav_ticker:'LTGILTINAV', inav_token:2594049 },

  // ── Liquid ────────────────────────────────────────────────────────────────
  { ticker:'LIQUIDBEES', name:'Nippon India ETF Liquid BeES',      fund_house:'Nippon', category:'liquid',         underlying_index:'Nifty 1D Rate',  expense_ratio:0.19, aum_cr:6000,  instrument_token:2817537,  inav_ticker:'LIQUIDINAV', inav_token:2593793 },
];

async function main() {
  console.log(`[seedEtfs] Upserting ${ETF_DATA.length} ETFs...`);
  const { error } = await supabase.from('etfs').upsert(ETF_DATA, { onConflict: 'ticker' });
  if (error) { console.error('[seedEtfs] Error:', error.message); process.exit(1); }
  console.log('[seedEtfs] Done.');
}

main().catch(e => { console.error(e.message); process.exit(1); });
