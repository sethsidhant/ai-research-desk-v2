// seedUniverse.js — Seeds expanded stock universe (Nifty 50 + popular mid-caps)
// Safe to re-run: uses upsert on ticker, skips existing rows.

require("dotenv").config({ path: "../.env.local" });
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const STOCKS = [
  // ── Nifty 50 ──────────────────────────────────────────────────────────────
  { ticker: "RELIANCE",    stock_name: "Reliance Industries",      bse_code: "500325" },
  { ticker: "TCS",         stock_name: "Tata Consultancy Services", bse_code: "532540" },
  { ticker: "HDFCBANK",    stock_name: "HDFC Bank",                bse_code: "500180" },
  { ticker: "INFY",        stock_name: "Infosys",                  bse_code: "500209" },
  { ticker: "ICICIBANK",   stock_name: "ICICI Bank",               bse_code: "532174" },
  { ticker: "HINDUNILVR",  stock_name: "Hindustan Unilever",       bse_code: "500696" },
  { ticker: "ITC",         stock_name: "ITC",                      bse_code: "500875" },
  { ticker: "SBIN",        stock_name: "State Bank of India",      bse_code: "500112" },
  { ticker: "BHARTIARTL",  stock_name: "Bharti Airtel",            bse_code: "532454" },
  { ticker: "KOTAKBANK",   stock_name: "Kotak Mahindra Bank",      bse_code: "500247" },
  { ticker: "LT",          stock_name: "Larsen & Toubro",          bse_code: "500510" },
  { ticker: "AXISBANK",    stock_name: "Axis Bank",                bse_code: "532215" },
  { ticker: "ASIANPAINT",  stock_name: "Asian Paints",             bse_code: "500820" },
  { ticker: "MARUTI",      stock_name: "Maruti Suzuki",            bse_code: "532500" },
  { ticker: "ULTRACEMCO",  stock_name: "UltraTech Cement",         bse_code: "532538" },
  { ticker: "TITAN",       stock_name: "Titan Company",            bse_code: "500114" },
  { ticker: "SUNPHARMA",   stock_name: "Sun Pharmaceutical",       bse_code: "524715" },
  { ticker: "WIPRO",       stock_name: "Wipro",                    bse_code: "507685" },
  { ticker: "NESTLEIND",   stock_name: "Nestle India",             bse_code: "500790" },
  { ticker: "HCLTECH",     stock_name: "HCL Technologies",         bse_code: "532281" },
  { ticker: "BAJFINANCE",  stock_name: "Bajaj Finance",            bse_code: "500034" },
  { ticker: "BAJAJFINSV",  stock_name: "Bajaj Finserv",            bse_code: "532978" },
  { ticker: "POWERGRID",   stock_name: "Power Grid Corporation",   bse_code: "532898" },
  { ticker: "NTPC",        stock_name: "NTPC",                     bse_code: "532555" },
  { ticker: "COALINDIA",   stock_name: "Coal India",               bse_code: "533278" },
  { ticker: "TECHM",       stock_name: "Tech Mahindra",            bse_code: "532755" },
  { ticker: "INDUSINDBK",  stock_name: "IndusInd Bank",            bse_code: "532187" },
  { ticker: "HDFCLIFE",    stock_name: "HDFC Life Insurance",      bse_code: "540777" },
  { ticker: "SBILIFE",     stock_name: "SBI Life Insurance",       bse_code: "540719" },
  { ticker: "TATAMOTORS",  stock_name: "Tata Motors",              bse_code: "500570" },
  { ticker: "TATASTEEL",   stock_name: "Tata Steel",               bse_code: "500470" },
  { ticker: "JSWSTEEL",    stock_name: "JSW Steel",                bse_code: "500228" },
  { ticker: "HINDALCO",    stock_name: "Hindalco Industries",      bse_code: "500440" },
  { ticker: "CIPLA",       stock_name: "Cipla",                    bse_code: "500087" },
  { ticker: "DRREDDY",     stock_name: "Dr. Reddy's Laboratories", bse_code: "500124" },
  { ticker: "DIVISLAB",    stock_name: "Divi's Laboratories",      bse_code: "532488" },
  { ticker: "EICHERMOT",   stock_name: "Eicher Motors",            bse_code: "505200" },
  { ticker: "HEROMOTOCO",  stock_name: "Hero MotoCorp",            bse_code: "500182" },
  { ticker: "BRITANNIA",   stock_name: "Britannia Industries",     bse_code: "500825" },
  { ticker: "APOLLOHOSP",  stock_name: "Apollo Hospitals",         bse_code: "508869" },
  { ticker: "ADANIENT",    stock_name: "Adani Enterprises",        bse_code: "512599" },
  { ticker: "ADANIPORTS",  stock_name: "Adani Ports & SEZ",        bse_code: "532921" },
  { ticker: "BAJAJ-AUTO",  stock_name: "Bajaj Auto",               bse_code: "532977" },
  { ticker: "M&M",         stock_name: "Mahindra & Mahindra",      bse_code: "500520" },
  { ticker: "ONGC",        stock_name: "Oil & Natural Gas Corp",   bse_code: "500312" },
  { ticker: "GRASIM",      stock_name: "Grasim Industries",        bse_code: "500300" },
  { ticker: "BPCL",        stock_name: "Bharat Petroleum",         bse_code: "500547" },
  { ticker: "UPL",         stock_name: "UPL",                      bse_code: "512070" },
  { ticker: "TATACONSUM",  stock_name: "Tata Consumer Products",   bse_code: "500800" },
  { ticker: "SHRIRAMFIN",  stock_name: "Shriram Finance",          bse_code: "511218" },

  // ── Popular Mid-caps & Others ─────────────────────────────────────────────
  { ticker: "NCC",         stock_name: "NCC",                      bse_code: "500294" },
  { ticker: "JIOFIN",      stock_name: "Jio Financial Services",   bse_code: "543940" },
  { ticker: "ZOMATO",      stock_name: "Zomato",                   bse_code: "543320" },
  { ticker: "IRCTC",       stock_name: "IRCTC",                    bse_code: "542830" },
  { ticker: "DMART",       stock_name: "Avenue Supermarts (DMart)", bse_code: "540376" },
  { ticker: "PIDILITIND",  stock_name: "Pidilite Industries",      bse_code: "500331" },
  { ticker: "HAVELLS",     stock_name: "Havells India",            bse_code: "517354" },
  { ticker: "VOLTAS",      stock_name: "Voltas",                   bse_code: "500575" },
  { ticker: "GODREJCP",    stock_name: "Godrej Consumer Products", bse_code: "532424" },
  { ticker: "JUBLFOOD",    stock_name: "Jubilant FoodWorks",       bse_code: "533155" },
  { ticker: "INDIGO",      stock_name: "IndiGo (InterGlobe Aviation)", bse_code: "521228" },
  { ticker: "TRENT",       stock_name: "Trent",                    bse_code: "500251" },
  { ticker: "BERGERPAINTS",stock_name: "Berger Paints",            bse_code: "509480" },
  { ticker: "MUTHOOTFIN",  stock_name: "Muthoot Finance",          bse_code: "533398" },
  { ticker: "CHOLAFIN",    stock_name: "Cholamandalam Investment",  bse_code: "511243" },
  { ticker: "PAGEIND",     stock_name: "Page Industries",          bse_code: "532827" },
  { ticker: "ABBOTINDIA",  stock_name: "Abbott India",             bse_code: "500488" },
  { ticker: "TORNTPHARM", stock_name: "Torrent Pharmaceuticals",   bse_code: "500420" },
  { ticker: "ALKEM",       stock_name: "Alkem Laboratories",       bse_code: "539523" },
  { ticker: "AUROPHARMA",  stock_name: "Aurobindo Pharma",         bse_code: "524804" },
  { ticker: "IDFCFIRSTB",  stock_name: "IDFC First Bank",          bse_code: "539437" },
  { ticker: "FEDERALBNK",  stock_name: "Federal Bank",             bse_code: "500469" },
  { ticker: "BANDHANBNK",  stock_name: "Bandhan Bank",             bse_code: "541153" },
  { ticker: "PERSISTENT",  stock_name: "Persistent Systems",       bse_code: "533179" },
  { ticker: "COFORGE",     stock_name: "Coforge",                  bse_code: "532541" },
  { ticker: "MPHASIS",     stock_name: "Mphasis",                  bse_code: "526299" },
  { ticker: "LTIM",        stock_name: "LTIMindtree",              bse_code: "540005" },
  { ticker: "OFSS",        stock_name: "Oracle Financial Services", bse_code: "532466" },
  { ticker: "DIXON",       stock_name: "Dixon Technologies",       bse_code: "541987" },
  { ticker: "POLYCAB",     stock_name: "Polycab India",            bse_code: "542652" },
  { ticker: "SUPREMEIND",  stock_name: "Supreme Industries",       bse_code: "509930" },
];

async function main() {
  console.log(`Seeding ${STOCKS.length} stocks...\n`);
  let inserted = 0, skipped = 0;

  for (const stock of STOCKS) {
    const { error } = await supabase
      .from("stocks")
      .upsert(
        { ticker: stock.ticker, stock_name: stock.stock_name, bse_code: stock.bse_code },
        { onConflict: "ticker", ignoreDuplicates: true }
      );

    if (error) {
      console.log(`  ✗ ${stock.ticker}: ${error.message}`);
    } else {
      console.log(`  ✓ ${stock.ticker} — ${stock.stock_name}`);
      inserted++;
    }
  }

  console.log(`\nDone. ${inserted} stocks upserted.`);
}

main().catch(e => { console.error(e); process.exit(1); });
