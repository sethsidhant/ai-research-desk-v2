// loadInstruments.js — V2
// Reads tickers from Postgres stocks table, fetches instrument_token from Kite
// and bse_code from Screener, writes both back to Postgres.
// Run once when adding new stocks, or whenever tokens need refreshing.

require("dotenv").config({ path: "../.env.local" });
const { KiteConnect } = require("kiteconnect");
const { createClient } = require("@supabase/supabase-js");

const kite = new KiteConnect({ api_key: process.env.KITE_API_KEY });
kite.setAccessToken(process.env.KITE_ACCESS_TOKEN);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchNSEInstruments() {
  const instruments = await kite.getInstruments(["NSE"]);
  const map = {};
  instruments.forEach((i) => { map[i.tradingsymbol] = i.instrument_token; });
  return map;
}

async function fetchBSECode(ticker) {
  try {
    const url = `https://www.screener.in/company/${ticker}/consolidated/`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10000),
    });
    const html = await res.text();
    const match = html.match(/bseindia\.com[^"]*?(\d{6})\/?"/);
    return match ? match[1] : null;
  } catch { return null; }
}

async function main() {
  console.log("Loading instruments...\n");

  // Fetch all stocks that are missing token or bse_code
  const { data: stocks, error } = await supabase
    .from("stocks")
    .select("id, ticker, stock_name, instrument_token, bse_code")
    .order("ticker");

  if (error) { console.error("DB error:", error.message); process.exit(1); }

  console.log(`Found ${stocks.length} stocks in DB`);

  // Fetch full NSE instruments list from Kite
  console.log("Fetching NSE instruments from Kite...");
  const nseMap = await fetchNSEInstruments();
  console.log(`Kite returned ${Object.keys(nseMap).length} NSE instruments\n`);

  let updated = 0;

  for (const stock of stocks) {
    const needsToken = !stock.instrument_token;
    const needsBSE   = !stock.bse_code;
    if (!needsToken && !needsBSE) {
      console.log(`${stock.ticker} — already complete, skipping`);
      continue;
    }

    console.log(`Processing ${stock.stock_name} (${stock.ticker})...`);
    const update = {};

    if (needsToken) {
      const token = nseMap[stock.ticker];
      if (token) {
        update.instrument_token = token;
        console.log(`  ✓ Token: ${token}`);
      } else {
        console.log(`  ✗ Token not found in Kite NSE list`);
      }
    }

    if (needsBSE) {
      const bse = await fetchBSECode(stock.ticker);
      if (bse) {
        update.bse_code = bse;
        console.log(`  ✓ BSE Code: ${bse}`);
      } else {
        console.log(`  ✗ BSE Code not found`);
      }
      await sleep(1000); // be polite to Screener
    }

    if (Object.keys(update).length > 0) {
      const { error: updateError } = await supabase
        .from("stocks")
        .update(update)
        .eq("id", stock.id);

      if (updateError) {
        console.log(`  ✗ DB update failed: ${updateError.message}`);
      } else {
        updated++;
      }
    }
  }

  console.log(`\n✅ Updated ${updated} / ${stocks.length} stocks`);
}

main().catch((e) => { console.error(e); process.exit(1); });
