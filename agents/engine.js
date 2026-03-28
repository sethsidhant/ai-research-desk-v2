// engine.js — Daily scoring (no Screener)
// Uses stored fundamentals from DB. Fetches live prices + technicals from Kite.
// Screener scraping moved to fundamentalsAgent.js (runs bi-weekly).
//
// What runs daily:
//   - Live price from Kite (batch, one call for all stocks)
//   - Industry PE via fetchIndustryPE.py (once per unique industry)
//   - stock_pe = livePrice / stored_eps
//   - RSI + DMA technicals from Kite
//   - Returns (6m, 1y) from Kite
//   - Deterministic composite score (scoreStock.js — no AI, free at scale)
//   - Upsert daily_scores + insert daily_history (no OHLC/volume/returns stored)

require("dotenv").config({ path: "../.env.local" });
const { execSync } = require("child_process");
const fs           = require("fs");
const path         = require("path");
const { getTechnicals, getReturns, NIFTY50_TOKEN, NIFTY500_TOKEN } = require("./technicalService");
const { getWatchlistedStocks, upsertStock, upsertDailyScore, insertHistory, closePool, logApiUsage, upsertIndexHistory } = require("./pgHelper");
const { fetchMCData }  = require("./fetchMCData");
const { scoreStock }   = require("./scoreStock");

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Helpers ───────────────────────────────────────────────────────────────────

function getRSISignal(rsi) {
  if (rsi == null) return null;
  if (rsi < 30) return "Oversold";
  if (rsi < 45) return "Weakening";
  if (rsi < 55) return "Neutral";
  if (rsi < 70) return "Strengthening";
  return "Overbought";
}

function getKiteAccessToken() {
  try { return fs.readFileSync(path.join(__dirname, "../.kite_token"), "utf8").trim(); }
  catch { return process.env.KITE_ACCESS_TOKEN; }
}

// Batch fetch live prices for all stocks in one Kite call
async function fetchAllPrices(stocks) {
  const withTokens = stocks.filter(s => s.instrument_token);
  if (!withTokens.length) return {};
  const apiKey      = process.env.KITE_API_KEY;
  const accessToken = getKiteAccessToken();
  const tokens      = withTokens.map(s => s.instrument_token).join("&i=");
  try {
    const res  = await fetch(`https://api.kite.trade/quote?i=${tokens}`, {
      headers: { "X-Kite-Version": "3", "Authorization": `token ${apiKey}:${accessToken}` },
      signal: AbortSignal.timeout(10000),
    });
    const json = await res.json();
    const prices = {};
    for (const val of Object.values(json.data ?? {})) {
      const stock = withTokens.find(s => s.instrument_token === val.instrument_token);
      if (stock) prices[stock.ticker] = val.last_price;
    }
    return prices;
  } catch { return {}; }
}

// Fetch industry PE — cached per industry name to avoid duplicate scrapes
function fetchIndustryPE(industryName) {
  try {
    const out = execSync(`python3 fetchIndustryPE.py "${industryName}"`, {
      encoding: "utf8", cwd: __dirname,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    const m = out.match(/Median: ([\d.]+)/);
    return m ? parseFloat(m[1]) : null;
  } catch { return null; }
}

function getDateDimensions(dateStr) {
  const d      = new Date(dateStr + "T12:00:00Z");
  const year   = d.getUTCFullYear();
  const jan1   = new Date(Date.UTC(year, 0, 1));
  const weekNum = Math.ceil(((d - jan1) / 86400000 + jan1.getUTCDay() + 1) / 7);
  const days   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  return {
    week:      weekNum,
    month:     d.getUTCMonth() + 1,
    quarter:   Math.ceil((d.getUTCMonth() + 1) / 3),
    dayOfWeek: days[d.getUTCDay()],
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function runDailyScoring() {
  try {
    // Sync Kite token from file (refreshed by cron) into technicalService before any Kite calls
    const { setKiteToken } = require('./technicalService');
    setKiteToken(getKiteAccessToken());

    const stocks   = await getWatchlistedStocks();
    const todayStr = new Date().toISOString().slice(0, 10);
    const dim      = getDateDimensions(todayStr);

    console.log(`\n[engine] Daily scoring — ${todayStr} (${dim.dayOfWeek})`);
    console.log(`Processing ${stocks.length} stocks (no Screener — using stored fundamentals)\n`);

    // 1. Batch price fetch — one Kite call for all stocks
    console.log("Fetching live prices from Kite...");
    const allPrices = await fetchAllPrices(stocks);
    console.log(`  Got prices for ${Object.keys(allPrices).length}/${stocks.length} stocks\n`);

    // 2. Industry PE — fetch once per unique industry
    const industryPECache = {};
    const uniqueIndustries = [...new Set(stocks.map(s => s.industry).filter(Boolean))];
    console.log(`Fetching industry PEs for ${uniqueIndustries.length} industries...`);
    for (const industry of uniqueIndustries) {
      const pe = fetchIndustryPE(industry);
      industryPECache[industry] = pe;
      console.log(`  ${industry}: ${pe ?? "N/A"}`);
    }

    // 3. Benchmark returns — one call each, also saves daily index history
    const niftyReturns    = await getReturns(NIFTY50_TOKEN);
    const nifty500Returns = await getReturns(NIFTY500_TOKEN);

    // Save index history — merge both series by date
    if (niftyReturns.history.length > 0) {
      const n500Map = Object.fromEntries(nifty500Returns.history.map(r => [r.date, r.close]));
      const rows = niftyReturns.history
        .filter(r => n500Map[r.date])
        .map(r => ({ date: r.date, nifty50_close: r.close, nifty500_close: n500Map[r.date] }));
      await upsertIndexHistory(rows);
      console.log(`  Saved ${rows.length} index history rows`);
    }

    // 4. Per-stock scoring
    for (const stock of stocks) {
      const { id: stockId, ticker, stock_name, instrument_token } = stock;
      if (!ticker) continue;

      console.log(`\n[${ticker}] ${stock_name}`);

      // Live price (fall back to stored)
      const livePrice = allPrices[ticker] ?? stock.current_price;

      // Recalculate price-dependent values
      const industryPE = stock.industry ? (industryPECache[stock.industry] ?? stock.industry_pe) : stock.industry_pe;

      // stock_pe = price / stored EPS (quarterly EPS doesn't change daily)
      const stockPE = (livePrice && stock.eps && stock.eps > 0)
        ? parseFloat((livePrice / stock.eps).toFixed(2))
        : stock.stock_pe;

      const peDeviation = (stockPE && industryPE)
        ? parseFloat(((stockPE - industryPE) / industryPE * 100).toFixed(2))
        : null;

      // Technicals from Kite (fetch before upsert so we can use 52W H/L as fallback)
      const raw  = instrument_token ? await getTechnicals(instrument_token) : null;
      const tech = raw ? {
        rsi:         raw.rsi,
        above50DMA:  raw.currentPrice > raw.sma50,
        above200DMA: raw.currentPrice > raw.sma200,
        dma50Value:  raw.dma50Value,
        dma200Value: raw.dma200Value,
      } : null;

      // Always use Kite candle data for 52W H/L — works for ETFs, more accurate than Screener
      const high52w     = raw?.high52w  ?? null;
      const low52w      = raw?.low52w   ?? null;
      const pctFromHigh = (livePrice && high52w)
        ? parseFloat(((livePrice - high52w) / high52w * 100).toFixed(2))
        : null;

      // Update price-driven fields in stocks table
      await upsertStock(ticker, {
        current_price:     livePrice,
        stock_pe:          stockPE,
        industry_pe:       industryPE,
        pct_from_52w_high: pctFromHigh,
        high_52w:          high52w,
        low_52w:           low52w,
      });

      // MoneyControl analyst data — weekly refresh (Saturdays only, or first-time fetch when no data yet)
      const isSaturday = dim.dayOfWeek === 'Saturday';
      if (stock.mc_scid && (isSaturday || !stock.analyst_rating)) {
        const mc = await fetchMCData(stock.mc_scid);
        if (mc) {
          await upsertStock(ticker, {
            analyst_rating:    mc.analyst_rating    ?? undefined,
            analyst_buy_pct:   mc.analyst_buy_pct   ?? undefined,
            analyst_hold_pct:  mc.analyst_hold_pct  ?? undefined,
            analyst_sell_pct:  mc.analyst_sell_pct  ?? undefined,
            analyst_count:     mc.analyst_count     ?? undefined,
            target_mean:       mc.target_mean       ?? undefined,
            target_high:       mc.target_high       ?? undefined,
            target_low:        mc.target_low        ?? undefined,
            mc_earnings_json:  mc.mc_earnings_json  ?? undefined,
          });
          console.log(`  MC: ${mc.analyst_rating ?? "N/A"} | Target: ${mc.target_mean ?? "N/A"} | Analysts: ${mc.analyst_count ?? "N/A"}`);
        }
      }

      const stockReturns = instrument_token ? await getReturns(instrument_token) : { r6m: null, r1y: null };

      console.log(`  PE: ${stockPE ?? "N/A"} | IndPE: ${industryPE ?? "N/A"} | Dev: ${peDeviation ?? "N/A"}% | RSI: ${tech?.rsi ?? "N/A"}`);

      // Deterministic scoring — free at any scale
      const result = scoreStock({
        stock_pe:          stockPE,
        industry_pe:       industryPE,
        roe:               stock.roe,
        roce:              stock.roce,
        debt_to_equity:    stock.debt_to_equity,
        revenue_growth_3y: stock.revenue_growth_3y,
        profit_growth_3y:  stock.profit_growth_3y,
        promoter_holding:  stock.promoter_holding,
        pledged_pct:       stock.pledged_pct,
        rsi:               tech?.rsi ?? null,
        above50DMA:        tech?.above50DMA ?? null,
        above200DMA:       tech?.above200DMA ?? null,
      });

      // Upsert daily_scores (keep 6m/1y for dashboard display)
      await upsertDailyScore(stockId, todayStr, {
        pe_deviation:     peDeviation,
        rsi:              tech?.rsi ?? null,
        rsi_signal:       getRSISignal(tech?.rsi),
        dma_50:           tech?.dma50Value ?? null,
        dma_200:          tech?.dma200Value ?? null,
        above_50_dma:     tech?.above50DMA ?? null,
        above_200_dma:    tech?.above200DMA ?? null,
        composite_score:  result.composite_score,
        classification:   result.classification,
        suggested_action: result.suggested_action,
        stock_6m:         stockReturns.r6m,
        stock_1y:         stockReturns.r1y,
        nifty50_6m:       niftyReturns.r6m,
        nifty50_1y:       niftyReturns.r1y,
        nifty500_6m:      nifty500Returns.r6m,
        nifty500_1y:      nifty500Returns.r1y,
      });

      // Insert history — no OHLC/volume (fetch from Kite on demand for charts)
      // no stock_6m/nifty returns (derivable from Kite history anytime)
      await insertHistory(stockId, todayStr, {
        week:             dim.week,
        month:            dim.month,
        quarter:          dim.quarter,
        day_of_week:      dim.dayOfWeek,
        closing_price:    livePrice,
        stock_pe:         stockPE ?? null,
        industry_pe:      industryPE ?? null,
        pe_deviation:     peDeviation,
        pct_from_52w_high: pctFromHigh,
        rsi:              tech?.rsi ?? null,
        rsi_signal:       getRSISignal(tech?.rsi),
        dma_50:           tech?.dma50Value ?? null,
        dma_200:          tech?.dma200Value ?? null,
        composite_score:  result.composite_score,
        classification:   result.classification,
        suggested_action: result.suggested_action,
      });

      console.log(`  ✓ ${result.classification} | ${result.suggested_action} | Score: ${result.composite_score}`);
      await sleep(1000);
    }

    console.log("\n✅ Daily scoring complete.");
    await closePool();
    process.exit(0);
  } catch (err) {
    console.error("Fatal error:", err);
    await closePool();
    process.exit(1);
  }
}

runDailyScoring();
