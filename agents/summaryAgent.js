// summaryAgent.js — V2
// Generates AI research notes per stock using Claude, writes to stocks table.
// Skips stocks with no news or a summary already written today.

require("dotenv").config({ path: "../.env.local" });
const Anthropic = require("@anthropic-ai/sdk");
const { createClient } = require("@supabase/supabase-js");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase  = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function generateSummary(stock, score) {
  const prompt = `You are a senior Indian equity research analyst. Write a concise research note.

Stock: ${stock.stock_name} (${stock.ticker})
Industry: ${stock.industry || "N/A"}

📊 VALUATION
- Stock PE: ${stock.stock_pe || "N/A"}
- Industry PE: ${stock.industry_pe || "N/A"}
- PE Deviation: ${score?.pe_deviation != null ? score.pe_deviation + "%" : "N/A"}
- Classification: ${score?.classification || "N/A"}
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

📉 TECHNICALS
- RSI (14): ${score?.rsi || "N/A"}
- RSI Signal: ${score?.rsi_signal || "N/A"}
- 50 DMA: ${score?.dma_50 || "N/A"} (stock is ${stock.current_price && score?.dma_50 && parseFloat(stock.current_price) > parseFloat(score.dma_50) ? "ABOVE" : "BELOW"})
- 200 DMA: ${score?.dma_200 || "N/A"} (stock is ${stock.current_price && score?.dma_200 && parseFloat(stock.current_price) > parseFloat(score.dma_200) ? "ABOVE" : "BELOW"})
- Suggested Action: ${score?.suggested_action || "N/A"}

📰 NEWS & SENTIMENT
${stock.latest_headlines ? stock.latest_headlines.substring(0, 1500) : "No recent news available."}

Write a 5-section research note using exactly these headers:
📊 VALUATION
🏭 BUSINESS QUALITY
📉 TECHNICALS
📰 NEWS & SENTIMENT
✅ SUGGESTED ACTION

Keep each section to 3-4 sentences. Be direct and opinionated.`;

  let attempt = 0;
  while (attempt < 3) {
    try {
      const response = await anthropic.messages.create({
        model:      "claude-sonnet-4-6",
        max_tokens: 800,
        messages:   [{ role: "user", content: prompt }],
      });
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

  // Fetch latest daily_scores for each stock
  const stockIds = stocks.map(s => s.id);
  const { data: scores } = await supabase
    .from("daily_scores")
    .select("stock_id, pe_deviation, rsi, rsi_signal, dma_50, dma_200, classification, suggested_action, date")
    .in("stock_id", stockIds)
    .order("date", { ascending: false });

  const latestScore = {};
  for (const s of (scores ?? [])) {
    if (!latestScore[s.stock_id]) latestScore[s.stock_id] = s;
  }

  for (let i = 0; i < stocks.length; i++) {
    const stock = stocks[i];
    console.log(`\n[${i + 1}/${stocks.length}] ${stock.stock_name}`);

    // Skip if no news updated today
    if (!stock.last_news_update) {
      console.log("  Skipping — no news fetched yet (run newsAgent first)");
      continue;
    }

    // Skip if summary already written today
    if (stock.summary_date === today) {
      console.log("  Skipping — summary already written today");
      continue;
    }

    const score = latestScore[stock.id] ?? null;
    const summary = await generateSummary(stock, score);
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
