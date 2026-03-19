// loadAllStocks.js — Loads ALL NSE equity stocks from Kite into the stocks table.
// Filters instrument_type=EQ only (no futures/options/ETFs).
// Safe to re-run: upserts on ticker, never overwrites existing fundamentals.

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

async function main() {
  console.log("Fetching all NSE instruments from Kite...");
  const all = await kite.getInstruments(["NSE"]);

  const equities = all.filter(i =>
    i.instrument_type === "EQ" &&
    i.segment === "NSE" &&
    i.tradingsymbol &&
    i.name
  );

  console.log(`Found ${equities.length} NSE EQ instruments\n`);

  // Upsert in batches of 200
  const BATCH = 200;
  let inserted = 0;

  for (let i = 0; i < equities.length; i += BATCH) {
    const batch = equities.slice(i, i + BATCH).map(e => ({
      ticker:           e.tradingsymbol,
      stock_name:       e.name,
      instrument_token: e.instrument_token,
    }));

    const { error } = await supabase
      .from("stocks")
      .upsert(batch, {
        onConflict: "ticker",
        ignoreDuplicates: true,   // never overwrite existing names/data
      });

    if (error) {
      console.error(`Batch ${i / BATCH + 1} error:`, error.message);
    } else {
      inserted += batch.length;
      process.stdout.write(`\r  Upserted ${inserted} / ${equities.length}...`);
    }
  }

  console.log(`\n\n✅ Done. ${inserted} NSE equity stocks loaded.`);
}

main().catch(e => { console.error(e); process.exit(1); });
