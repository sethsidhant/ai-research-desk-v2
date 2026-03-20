// summaryAgent.js — V2
// Generates AI research notes per stock using Claude, writes to stocks table.
// Only regenerates when news has changed since the last summary (last_news_update > summary_date).

require("dotenv").config({ path: "../.env.local" });
const Anthropic = require("@anthropic-ai/sdk");
const { createClient } = require("@supabase/supabase-js");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const { logApiUsage } = require("./pgHelper");
const supabase  = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function generateSummary(stock) {
  const prompt = `You are a senior Indian equity research analyst. Write a concise research note.

Stock: ${stock.stock_name} (${stock.ticker})
Industry: ${stock.industry || "N/A"}

📊 VALUATION
- Stock PE: ${stock.stock_pe || "N/A"}
- Industry PE: ${stock.industry_pe || "N/A"}
- PE Deviation: ${stock.pe_deviation != null ? stock.pe_deviation + "%" : "N/A"}
- Classification: ${stock.classification || "N/A"}
- Price to Book: ${stock.pb || "N/A"}
- Current Price: ₹${stock.current_price || "N/A"}
- 52W High: ₹${stock.high_52w || "N/A"} | 52W Low: ₹${stock.low_52w || "N/A"}
- % from 52W High: ${stock.pct_from_52w_high != null ? stock.pct_from_52w_high + "%" : "N/A"}
- Dividend Yield: ${stock.dividend_yield != null ? stock.dividend_yield + "%" : "N/A"}
- EPS: ₹${stock.eps || "N/A"}

🏭 BUSINESS QUALITY
- ROE: ${stock.roe || "N/A"}%
- ROCE: ${stock.roce || "N/A"}%
- Market Cap: ${stock.market_cap ? "₹" + stock.market_cap + " Cr" : "N/A"}
- Revenue Growth 1Y: ${stock.revenue_growth_1y != null ? stock.revenue_growth_1y + "%" : "N/A"}
- Revenue Growth 3Y CAGR: ${stock.revenue_growth_3y != null ? stock.revenue_growth_3y + "%" : "N/A"}
- Revenue Growth 5Y CAGR: ${stock.revenue_growth_5y != null ? stock.revenue_growth_5y + "%" : "N/A"}
- Profit Growth 1Y: ${stock.profit_growth_1y != null ? stock.profit_growth_1y + "%" : "N/A"}
- Profit Growth 3Y CAGR: ${stock.profit_growth_3y != null ? stock.profit_growth_3y + "%" : "N/A"}
- Profit Growth 5Y CAGR: ${stock.profit_growth_5y != null ? stock.profit_growth_5y + "%" : "N/A"}
- Debt to Equity: ${stock.debt_to_equity || "N/A"}
- Total Debt: ${stock.total_debt ? "₹" + stock.total_debt + " Cr" : "N/A"}
- Reserves: ${stock.reserves ? "₹" + stock.reserves + " Cr" : "N/A"}
- Borrowings: ${stock.borrowings ? "₹" + stock.borrowings + " Cr" : "N/A"}${stock.reserves && stock.borrowings ? ` (Reserves ${parseFloat(stock.reserves) > parseFloat(stock.borrowings) ? "EXCEED" : "BELOW"} Borrowings)` : ""}
- Interest Coverage: ${stock.interest_coverage != null ? stock.interest_coverage + "x" : "N/A"}
- Current Ratio: ${stock.current_ratio || "N/A"}
- Operating Cash Flow: ${stock.operating_cash_flow ? "₹" + stock.operating_cash_flow + " Cr" : "N/A"}
- Free Cash Flow: ${stock.free_cash_flow ? "₹" + stock.free_cash_flow + " Cr" : "N/A"}
- Promoter Holding: ${stock.promoter_holding != null ? stock.promoter_holding + "%" : "N/A"}
- Pledged %: ${stock.pledged_pct != null ? stock.pledged_pct + "%" : "N/A"}
- FII Holding: ${stock.fii_holding != null ? stock.fii_holding + "%" : "N/A"}
- DII Holding: ${stock.dii_holding != null ? stock.dii_holding + "%" : "N/A"}

📰 NEWS & SENTIMENT
${stock.latest_headlines ? stock.latest_headlines.substring(0, 1500) : "No recent news available."}

The user can already see all the raw numbers (PE, ROE, ROCE, debt, growth rates, DMA, RSI) in their dashboard — do NOT repeat them.

Write a 3-section research note using exactly these headers:

📰 NEWS & SENTIMENT
🔍 ANALYST TAKE
✅ SUGGESTED ACTION

Guidelines:
- NEWS & SENTIMENT (3-4 sentences): Summarise what's actually happening with this company right now based on the headlines. What is the market reacting to?
- ANALYST TAKE (3-4 sentences): Qualitative view only — business moat, management quality, sector tailwinds/headwinds, key risks. No number repetition.
- SUGGESTED ACTION (2-3 sentences): Clear, opinionated recommendation. Mention valuation context (cheap/fair/expensive vs industry) and price action (above/below key DMAs) without quoting the numbers directly.`;

  let attempt = 0;
  while (attempt < 3) {
    try {
      const response = await anthropic.messages.create({
        model:      "claude-sonnet-4-6",
        max_tokens: 550,
        messages:   [{ role: "user", content: prompt }],
      });
      await logApiUsage('summary', stock.ticker, response.usage.input_tokens, response.usage.output_tokens);
      return response.content[0].text;
    } catch (err) {
      if (err.status === 529 || err.status === 429) {
        console.log(`  Rate limited — waiting 30s...`);
        await sleep(30000);
        attempt++;
      } else throw err;
    }
  }
  return null;
}

async function main() {
  console.log("Generating AI summaries V2...\n");
  const today = new Date().toISOString().split("T")[0];

  // Only summarise watchlisted stocks
  const { data: watchlisted } = await supabase.from("user_stocks").select("stock_id");
  const watchlistIds = [...new Set((watchlisted ?? []).map(r => r.stock_id))];
  if (watchlistIds.length === 0) { console.log("No watchlisted stocks found."); return; }

  const { data: stocks, error } = await supabase
    .from("stocks")
    .select("*")
    .in("id", watchlistIds)
    .order("ticker");

  if (error) { console.error("DB error:", error.message); process.exit(1); }

  // Fetch latest daily_scores for context (pe_deviation, classification)
  const stockIds = stocks.map(s => s.id);
  const { data: scores } = await supabase
    .from("daily_scores")
    .select("stock_id, pe_deviation, classification, date")
    .in("stock_id", stockIds)
    .order("date", { ascending: false });

  const latestScore = {};
  for (const s of (scores ?? [])) {
    if (!latestScore[s.stock_id]) latestScore[s.stock_id] = s;
  }

  for (let i = 0; i < stocks.length; i++) {
    const stock = stocks[i];
    console.log(`\n[${i + 1}/${stocks.length}] ${stock.stock_name}`);

    // Skip if no news fetched yet
    if (!stock.last_news_update) {
      console.log("  Skipping — no news fetched yet (run newsAgent first)");
      continue;
    }

    // Skip if summary is already up-to-date with latest news
    // (only regenerate when news has changed since last summary)
    if (stock.summary_date && stock.summary_date >= stock.last_news_update.split("T")[0]) {
      console.log(`  Skipping — summary (${stock.summary_date}) is current with news (${stock.last_news_update.split("T")[0]})`);
      continue;
    }

    // Merge latest score fields into stock for the prompt
    const score = latestScore[stock.id] ?? null;
    const stockWithScore = { ...stock, pe_deviation: score?.pe_deviation, classification: score?.classification };

    const summary = await generateSummary(stockWithScore);
    if (!summary) { console.log("  Failed to generate summary"); continue; }

    const { error: updateError } = await supabase
      .from("stocks")
      .update({ ai_summary: summary, summary_date: today })
      .eq("id", stock.id);

    if (updateError) console.log(`  ✗ DB update failed: ${updateError.message}`);
    else console.log(`  ✓ Summary written`);

    await sleep(4000);
  }

  console.log("\nSummary Agent V2 complete.");
}

main().catch(e => { console.error(e); process.exit(1); });
