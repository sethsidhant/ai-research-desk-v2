// One-time seed script — uses Supabase REST API (works without direct DB access)
require("dotenv").config({ path: "../.env.local" });
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Instrument tokens will be populated later by loadInstruments.js
const STOCKS = [
  { ticker: "RELIANCE", stock_name: "Reliance Industries" },
  { ticker: "INFY",     stock_name: "Infosys" },
  { ticker: "TCS",      stock_name: "TCS" },
  { ticker: "NCC",      stock_name: "NCC" },
  { ticker: "JIOFIN",   stock_name: "Jio Finance" },
];

async function seed() {
  const { data, error } = await supabase
    .from("stocks")
    .upsert(STOCKS, { onConflict: "ticker" });

  if (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }

  console.log("✓ Seeded stocks:");
  STOCKS.forEach(s => console.log(`  ${s.ticker} — ${s.stock_name}`));
  console.log("\nNote: instrument_token will be populated by loadInstruments.js");
}

seed();
