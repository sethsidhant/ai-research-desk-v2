// backfillHistory.js
// Fetches proper EOD closing prices from Kite historical API.
// Run daily (before engine) to ensure daily_history and index_history
// have accurate closing prices — not morning live prices.
//
// Also safe to run standalone for a one-time backfill.

require("dotenv").config({ path: "../.env.local" });
const fs   = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { NIFTY50_TOKEN, NIFTY500_TOKEN } = require("./technicalService");

// Additional index tokens for index_history
const INDEX_TOKENS = [
  { token: 260105, col: 'banknifty_close'    },  // NSE:NIFTY BANK
  { token: 265,    col: 'sensex_close'        },  // BSE:SENSEX
  { token: 256777, col: 'midcap100_close'     },  // NSE:NIFTY MIDCAP 100
  { token: 267017, col: 'smallcap100_close'   },  // NSE:NIFTY SMLCAP 100
  { token: 259849, col: 'nifty_it_close'      },  // NSE:NIFTY IT
  { token: 262409, col: 'nifty_pharma_close'  },  // NSE:NIFTY PHARMA
  { token: 263433, col: 'nifty_auto_close'    },  // NSE:NIFTY AUTO
  { token: 261897, col: 'nifty_fmcg_close'    },  // NSE:NIFTY FMCG
  { token: 263689, col: 'nifty_metal_close'   },  // NSE:NIFTY METAL
];

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const sleep = ms => new Promise(r => setTimeout(r, ms));

function getKiteAccessToken() {
  try { return fs.readFileSync(path.join(__dirname, "../.kite_token"), "utf8").trim(); }
  catch { return process.env.KITE_ACCESS_TOKEN; }
}

async function fetchKiteCandles(token, from, to) {
  const apiKey      = process.env.KITE_API_KEY;
  const accessToken = getKiteAccessToken();
  try {
    const res = await fetch(
      `https://api.kite.trade/instruments/historical/${token}/day?from=${from}&to=${to}&oi=0`,
      {
        headers: { "X-Kite-Version": "3", "Authorization": `token ${apiKey}:${accessToken}` },
        signal: AbortSignal.timeout(15000),
      }
    );
    const json = await res.json();
    return json.data?.candles ?? [];
  } catch (e) {
    console.error(`  Kite error for token ${token}: ${e.message}`);
    return [];
  }
}

async function main() {
  const today     = new Date().toISOString().slice(0, 10);
  // Yesterday — we want finalized closes, not intraday
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  console.log(`\n[backfillHistory] Fetching EOD closes up to ${yesterday}\n`);

  // 1. Get all tracked stocks (watchlist + portfolio) with their earliest date
  const [watchlistRes, portfolioRes] = await Promise.all([
    supabase.from("user_stocks").select("stock_id, added_at"),
    supabase.from("portfolio_holdings").select("stock_id, investment_date, added_at"),
  ]);

  const addedAtMap = {};
  // Always fetch at least 35 calendar days back so volume breakout has enough history (needs 21 trading days)
  const minFrom = new Date(Date.now() - 35 * 86400000).toISOString().slice(0, 10);

  for (const us of watchlistRes.data ?? []) {
    const d = us.added_at?.slice(0, 10) ?? "2024-01-01";
    const from = d < minFrom ? d : minFrom;
    if (!addedAtMap[us.stock_id] || from < addedAtMap[us.stock_id]) addedAtMap[us.stock_id] = from;
  }
  for (const ph of portfolioRes.data ?? []) {
    // Use investment_date (actual purchase date) as the backfill start — more accurate for portfolio chart
    const d = ph.investment_date?.slice(0, 10) ?? ph.added_at?.slice(0, 10) ?? "2024-01-01";
    const from = d < minFrom ? d : minFrom;
    if (!addedAtMap[ph.stock_id] || from < addedAtMap[ph.stock_id]) addedAtMap[ph.stock_id] = from;
  }

  const stockIds = Object.keys(addedAtMap);
  if (!stockIds.length) { console.log("No tracked stocks."); return; }

  const { data: stocks } = await supabase
    .from("stocks")
    .select("id, ticker, instrument_token")
    .in("id", stockIds);

  // 2. Per-stock EOD close backfill
  for (const stock of stocks ?? []) {
    if (!stock.instrument_token) {
      console.log(`SKIP ${stock.ticker} — no instrument_token`);
      continue;
    }

    const from = addedAtMap[stock.id];
    console.log(`[${stock.ticker}] ${from} → ${yesterday}`);

    const candles = await fetchKiteCandles(stock.instrument_token, from, yesterday);
    if (!candles.length) { console.log(`  No candles returned`); continue; }

    // Each candle: [datetime, open, high, low, close, volume]
    const rows = candles.map(([ts, open, high, low, close, volume]) => ({
      stock_id:      stock.id,
      date:          ts.slice(0, 10),
      closing_price: close,
      open,
      day_high:      high,
      day_low:       low,
      volume,
    }));

    // ignoreDuplicates: false — overwrites closing_price with accurate EOD value
    // Only updates columns we provide; leaves rsi/score/etc untouched
    const { error } = await supabase
      .from("daily_history")
      .upsert(rows, { onConflict: "stock_id,date", ignoreDuplicates: false });

    if (error) console.error(`  ✗ ${error.message}`);
    else console.log(`  ✓ ${rows.length} days upserted`);

    await sleep(350); // stay under Kite's 3 req/sec limit
  }

  // 3. Index history — all indices, 1 full year
  const oneYearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  console.log(`\n[backfillHistory] Indices ${oneYearAgo} → ${yesterday}`);

  // Fetch Nifty50 + Nifty500 (primary anchors) and all additional indices in parallel
  const [n50Candles, n500Candles, ...extraCandles] = await Promise.all([
    fetchKiteCandles(NIFTY50_TOKEN,  oneYearAgo, yesterday),
    fetchKiteCandles(NIFTY500_TOKEN, oneYearAgo, yesterday),
    ...INDEX_TOKENS.map(({ token }) => fetchKiteCandles(token, oneYearAgo, yesterday)),
  ]);

  if (n50Candles.length && n500Candles.length) {
    // Build a date-keyed map from each extra index
    const extraMaps = INDEX_TOKENS.map(({ col }, i) =>
      Object.fromEntries((extraCandles[i] ?? []).map(([ts,,,, close]) => [ts.slice(0, 10), close]))
    );
    const n500Map = Object.fromEntries(
      n500Candles.map(([ts,,,, close]) => [ts.slice(0, 10), close])
    );

    const indexRows = n50Candles
      .filter(([ts]) => n500Map[ts.slice(0, 10)])
      .map(([ts,,,, nifty50_close]) => {
        const date = ts.slice(0, 10);
        const row = {
          date,
          nifty50_close,
          nifty500_close: n500Map[date],
        };
        INDEX_TOKENS.forEach(({ col }, i) => {
          const val = extraMaps[i][date];
          if (val != null) row[col] = val;
        });
        return row;
      });

    const { error } = await supabase
      .from("index_history")
      .upsert(indexRows, { onConflict: "date", ignoreDuplicates: false });

    if (error) console.error(`  ✗ Index history: ${error.message}`);
    else console.log(`  ✓ ${indexRows.length} index days upserted`);

    // Log coverage for extra indices
    INDEX_TOKENS.forEach(({ col }, i) => {
      const count = Object.keys(extraMaps[i]).length;
      if (count) console.log(`    ${col}: ${count} days`);
      else console.log(`    ${col}: ✗ no data`);
    });
  }

  console.log("\n[backfillHistory] Done.");
}

main().catch(e => { console.error(e); process.exit(1); });
