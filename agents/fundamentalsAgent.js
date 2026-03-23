// fundamentalsAgent.js — Bi-weekly fundamentals refresh
// Scrapes Screener for all slow-changing fundamental data.
// Run every 2 weeks via Task Scheduler (separate from daily engine.js).
//
// Updates: roe, roce, eps, debt_to_equity, total_debt, current_ratio,
//          interest_coverage, revenue_growth, profit_growth, cash_flow,
//          promoter/fii/dii holding, pledged_pct, dividend_yield,
//          industry, reserves, borrowings, high_52w, low_52w, market_cap, pb

require("dotenv").config({ path: "../.env.local" });
const { execSync } = require("child_process");
const { getWatchlistedStocks, upsertStock, closePool } = require("./pgHelper");

const sleep = ms => new Promise(r => setTimeout(r, ms));

function getScreenerFundamentals(ticker) {
  try {
    return JSON.parse(execSync(`python3 fetchScreenerFundamentals.py ${ticker}`, {
      encoding: "utf8", cwd: __dirname,
    }));
  } catch { return null; }
}

async function runFundamentalsRefresh() {
  try {
    const stocks = await getWatchlistedStocks();
    console.log(`\n[fundamentalsAgent] Bi-weekly refresh — ${new Date().toISOString().slice(0, 10)}`);
    console.log(`Refreshing fundamentals for ${stocks.length} stocks...\n`);

    for (const stock of stocks) {
      const { ticker, stock_name } = stock;
      if (!ticker) continue;

      console.log(`[${ticker}] ${stock_name}`);
      const f = getScreenerFundamentals(ticker);
      if (!f) { console.log("  No Screener data — skipping\n"); continue; }

      await upsertStock(ticker, {
        // Price-adjacent (update here too so they're fresh post-earnings)
        high_52w:               f.high_52w,
        low_52w:                f.low_52w,
        market_cap:             f.market_cap,
        pb:                     f.pb,
        eps:                    f.eps,
        // Bi-weekly fundamentals
        roe:                    f.roe,
        roce:                   f.roce,
        dividend_yield:         f.dividend_yield,
        debt_to_equity:         f.debt_to_equity,
        promoter_holding:       f.promoter_holding,
        fii_holding:            f.fii_holding,
        dii_holding:            f.dii_holding,
        pledged_pct:            f.pledged_pct,
        reserves:               f.reserves,
        borrowings:             f.borrowings,
        revenue_growth_1y:      f.revenue_growth_1y,
        revenue_growth_3y:      f.revenue_growth_3y,
        revenue_growth_5y:      f.revenue_growth_5y,
        profit_growth_1y:       f.profit_growth_1y,
        profit_growth_3y:       f.profit_growth_3y,
        profit_growth_5y:       f.profit_growth_5y,
        operating_cash_flow:    f.operating_cash_flow,
        free_cash_flow:         f.free_cash_flow,
        total_debt:             f.total_debt,
        current_ratio:          f.current_ratio,
        interest_coverage:      f.interest_coverage,
        industry:               f.industry_hierarchy,
        fundamentals_updated_at: new Date().toISOString(),
      });

      console.log(`  ✓ ROE: ${f.roe ?? "N/A"}% | ROCE: ${f.roce ?? "N/A"}% | D/E: ${f.debt_to_equity ?? "N/A"} | EPS: ${f.eps ?? "N/A"}\n`);
      await sleep(4000); // be gentle with Screener
    }

    console.log("✅ Fundamentals refresh complete.");
    await closePool();
    process.exit(0);
  } catch (err) {
    console.error("Fatal error:", err);
    await closePool();
    process.exit(1);
  }
}

runFundamentalsRefresh();
