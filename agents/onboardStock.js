// onboardStock.js — Full pipeline for a single stock when first added to a watchlist.
// Steps: 1) Fundamentals + Kite technicals + Claude score
//        2) BSE filings + ET news
//        3) AI research summary
// Usage: node onboardStock.js TICKER

require("dotenv").config({ path: "../.env.local" });
const Anthropic    = require("@anthropic-ai/sdk");
const { execSync } = require("child_process");
const RSSParser    = require("rss-parser");
const axios        = require("axios");
const { getTechnicals, getReturns, NIFTY50_TOKEN } = require("./technicalService");
const { upsertStock, upsertDailyScore, insertHistory, logApiUsage } = require("./pgHelper");
const { createClient } = require("@supabase/supabase-js");

const ticker = process.argv[2];
if (!ticker) { console.error("Usage: node onboardStock.js TICKER"); process.exit(1); }

const anthropic  = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase   = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
const rssParser  = new RSSParser({ timeout: 15000, headers: { "User-Agent": "Mozilla/5.0" } });
const sleep      = ms => new Promise(r => setTimeout(r, ms));

// ── Helpers (same as engine/runOneStock) ──────────────────────────────────────

function getRSISignal(rsi) {
  if (rsi == null) return null;
  if (rsi < 30) return "Oversold";
  if (rsi < 45) return "Weakening";
  if (rsi < 55) return "Neutral";
  if (rsi < 70) return "Strengthening";
  return "Overbought";
}

function getScreenerFundamentals(t) {
  try {
    return JSON.parse(execSync(`python fetchScreenerFundamentals.py ${t}`, { encoding: "utf8", cwd: __dirname }));
  } catch { return null; }
}

function getIndustryPE(industryName) {
  try {
    const out = execSync(`python fetchIndustryPE.py "${industryName}"`, {
      encoding: "utf8", cwd: __dirname, env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    const m = out.match(/Median: ([\d.]+)/);
    return m ? parseFloat(m[1]) : null;
  } catch { return null; }
}

async function getKiteOHLC(token) {
  if (!token) return null;
  try {
    const res  = await fetch(`https://api.kite.trade/quote?i=${token}`, {
      headers: { "X-Kite-Version": "3", "Authorization": `token ${process.env.KITE_API_KEY}:${process.env.KITE_ACCESS_TOKEN}` },
    });
    const json = await res.json();
    const data = Object.values(json.data ?? {})[0];
    if (!data) return null;
    return { open: data.ohlc?.open ?? null, high: data.ohlc?.high ?? null, low: data.ohlc?.low ?? null, close: data.ohlc?.close ?? null, volume: data.volume_traded ?? null };
  } catch { return null; }
}

// ── Step 1: Fundamentals + Score ──────────────────────────────────────────────

async function runFundamentals(stock) {
  console.log(`\n[1/3] Fundamentals + Score for ${ticker}...`);

  const f = getScreenerFundamentals(ticker);
  if (!f) {
    // No Screener data — treat as ETF, mark industry and proceed to technicals
    console.log("  No Screener data — treating as ETF");
    await upsertStock(ticker, { industry: 'ETF', fundamentals_updated_at: new Date().toISOString() });
    return true;
  }

  let industryPE = stock.industry_pe ?? null;
  if (f.industry_hierarchy) {
    const fetched = getIndustryPE(f.industry_hierarchy);
    if (fetched) industryPE = fetched;
  }

  await upsertStock(ticker, {
    stock_pe: f.pe, roe: f.roe, roce: f.roce, market_cap: f.market_cap,
    industry: f.industry_hierarchy, industry_pe: industryPE,
    current_price: f.current_price, high_52w: f.high_52w, low_52w: f.low_52w,
    pct_from_52w_high: f.pct_from_52w_high, pb: f.pb, dividend_yield: f.dividend_yield,
    eps: f.eps, debt_to_equity: f.debt_to_equity, promoter_holding: f.promoter_holding,
    fii_holding: f.fii_holding, dii_holding: f.dii_holding, pledged_pct: f.pledged_pct,
    reserves: f.reserves, borrowings: f.borrowings,
    revenue_growth_1y: f.revenue_growth_1y, revenue_growth_3y: f.revenue_growth_3y,
    revenue_growth_5y: f.revenue_growth_5y, profit_growth_1y: f.profit_growth_1y,
    profit_growth_3y: f.profit_growth_3y, profit_growth_5y: f.profit_growth_5y,
    operating_cash_flow: f.operating_cash_flow, free_cash_flow: f.free_cash_flow,
    total_debt: f.total_debt, current_ratio: f.current_ratio,
    interest_coverage: f.interest_coverage, fundamentals_updated_at: new Date().toISOString(),
  });

  const peDeviation = industryPE && f.pe
    ? parseFloat(((f.pe - industryPE) / industryPE * 100).toFixed(2)) : null;

  const raw  = stock.instrument_token ? await getTechnicals(stock.instrument_token) : null;
  const tech = raw ? {
    rsi: raw.rsi, above50DMA: raw.currentPrice > raw.sma50,
    above200DMA: raw.currentPrice > raw.sma200,
    dma50Value: raw.dma50Value, dma200Value: raw.dma200Value,
  } : null;

  // Always use Kite for price data — more accurate, real-time, and works for ETFs
  if (raw?.currentPrice) {
    await upsertStock(ticker, {
      current_price:     raw.currentPrice,
      high_52w:          raw.high52w    ?? null,
      low_52w:           raw.low52w     ?? null,
      pct_from_52w_high: raw.pctFromHigh ?? null,
    });
  }

  const [stockReturns, niftyReturns] = await Promise.all([
    stock.instrument_token ? getReturns(stock.instrument_token) : Promise.resolve({ r6m: null, r1y: null }),
    getReturns(NIFTY50_TOKEN),
  ]);

  const prompt = `You are a senior Indian equity research analyst.
Stock: ${stock.stock_name} (${ticker})
PE: ${f.pe ?? "N/A"} | Industry PE: ${industryPE ?? "N/A"} | PE Dev: ${peDeviation != null ? peDeviation.toFixed(1) + "%" : "N/A"}
ROE: ${f.roe ?? "N/A"}% | ROCE: ${f.roce ?? "N/A"}% | D/E: ${f.debt_to_equity ?? "N/A"}
RSI: ${tech?.rsi ?? "N/A"} | 50DMA: ${tech?.dma50Value ?? "N/A"} | 200DMA: ${tech?.dma200Value ?? "N/A"}
Return ONLY valid JSON: {"composite_score":<1-10>,"classification":"<Undervalued|Fairly Valued|Overvalued|High Quality|Speculative>","suggested_action":"<Strong Buy|Buy|Accumulate|Hold|Reduce|Avoid>"}`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6", max_tokens: 150, temperature: 0.2,
    messages: [{ role: "user", content: prompt }],
  });
  await logApiUsage('onboard_score', ticker, response.usage.input_tokens, response.usage.output_tokens);
  const m = response.content[0].text.match(/\{[\s\S]*\}/);
  if (!m) { console.log("  Invalid JSON from Claude"); return false; }
  const result = JSON.parse(m[0]);

  const todayStr = new Date().toISOString().slice(0, 10);
  await upsertDailyScore(stock.id, todayStr, {
    pe_deviation: peDeviation, rsi: tech?.rsi ?? null, rsi_signal: getRSISignal(tech?.rsi),
    dma_50: tech?.dma50Value ?? null, dma_200: tech?.dma200Value ?? null,
    above_50_dma: tech?.above50DMA ?? null, above_200_dma: tech?.above200DMA ?? null,
    composite_score: result.composite_score, classification: result.classification,
    suggested_action: result.suggested_action,
    stock_6m: stockReturns.r6m, stock_1y: stockReturns.r1y,
    nifty50_6m: niftyReturns.r6m, nifty50_1y: niftyReturns.r1y,
  });

  const ohlc = await getKiteOHLC(stock.instrument_token);
  await insertHistory(stock.id, todayStr, {
    closing_price: ohlc?.close ?? f.current_price ?? null,
    open: ohlc?.open ?? null, day_high: ohlc?.high ?? null, day_low: ohlc?.low ?? null,
    volume: ohlc?.volume ?? null, stock_pe: f.pe ?? null, industry_pe: industryPE ?? null,
    pe_deviation: peDeviation, rsi: tech?.rsi ?? null, rsi_signal: getRSISignal(tech?.rsi),
    dma_50: tech?.dma50Value ?? null, dma_200: tech?.dma200Value ?? null,
    composite_score: result.composite_score, classification: result.classification,
    suggested_action: result.suggested_action,
    stock_6m: stockReturns.r6m, stock_1y: stockReturns.r1y,
    nifty50_6m: niftyReturns.r6m, nifty50_1y: niftyReturns.r1y,
  });

  console.log(`  ✓ ${result.classification} | ${result.suggested_action} | Score: ${result.composite_score}`);
  return true;
}

// ── Step 2: News ──────────────────────────────────────────────────────────────

async function fetchBSECode(t) {
  try {
    const res  = await fetch(`https://www.screener.in/company/${t}/consolidated/`, {
      headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10000),
    });
    const html  = await res.text();
    const match = html.match(/bseindia\.com[^"]*?(\d{6})\/?"/);
    return match ? match[1] : null;
  } catch { return null; }
}

async function runNews(stock) {
  console.log(`\n[2/3] News & filings for ${ticker}...`);

  // Fetch BSE code if missing (stocks loaded from Kite don't have it)
  if (!stock.bse_code) {
    console.log(`  No BSE code — fetching from Screener...`);
    const code = await fetchBSECode(ticker);
    if (code) {
      await supabase.from("stocks").update({ bse_code: code }).eq("id", stock.id);
      stock = { ...stock, bse_code: code };
      console.log(`  ✓ BSE code: ${code}`);
    } else {
      console.log(`  ✗ BSE code not found — BSE filings will be skipped`);
    }
  }

  const BSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    "Connection": "keep-alive",
  };

  let bseCookie = "";
  try {
    const resp = await axios.get("https://www.bseindia.com/corporates/ann.html", {
      headers: { ...BSE_HEADERS, "Accept": "text/html,application/xhtml+xml,*/*;q=0.8", "Upgrade-Insecure-Requests": "1" },
      timeout: 20000, maxRedirects: 5,
    });
    const setCookie = resp.headers["set-cookie"];
    if (setCookie?.length > 0) bseCookie = setCookie.map(c => c.split(";")[0]).join("; ");
  } catch { /* cookie optional */ }

  let filings = [];
  if (stock.bse_code) {
    let attempt = 0;
    while (attempt < 4 && filings.length === 0) {
      try {
        const code = String(parseInt(stock.bse_code));
        const { data } = await axios.get(
          `https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w?strCat=-1&strPrevDate=&strScrip=${code}&strSearch=P&strToDate=&strType=C&subcategory=-1`,
          {
            headers: {
              ...BSE_HEADERS,
              "Referer": "https://www.bseindia.com/corporates/ann.html",
              "Accept": "application/json, text/plain, */*",
              "Origin": "https://www.bseindia.com",
              "X-Requested-With": "XMLHttpRequest",
              ...(bseCookie ? { "Cookie": bseCookie } : {}),
            },
            timeout: 15000,
          }
        );
        if (typeof data === "string" || (Array.isArray(data) && typeof data[0] === "number")) {
          // BSE returned HTML — stale cookie, retry
          bseCookie = "";
          attempt++; await sleep(12000); continue;
        }
        filings = (data?.Table || []).slice(0, 5).map(item => ({
          subject:  item.NEWSSUB  || item.HEADLINE || "",
          category: item.SUBCATNAME || item.CATEGORYNAME || "",
          date: item.DT_TM ? item.DT_TM.replace("T", " ").substring(0, 16) : "",
          link: item.ATTACHMENTNAME
            ? `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${item.ATTACHMENTNAME}`
            : `https://www.bseindia.com/corporates/ann.html?scrip=${code}`,
        }));
        break;
      } catch (err) {
        bseCookie = "";
        attempt++;
        if (attempt < 4) await sleep(12000);
      }
    }
  }

  let etNews = [];
  try {
    const nameWords = stock.stock_name.toLowerCase().split(/\s+/).filter(w => w.length >= 4);
    const terms     = [...new Set([ticker.toLowerCase(), ...nameWords])];
    const feed      = await rssParser.parseURL("https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms");
    etNews = (feed.items || [])
      .filter(item => {
        const t = (item.title || "").toLowerCase();
        return terms.some(term => t.includes(term));
      })
      .slice(0, 3)
      .map(item => ({
        headline: item.title || "",
        date: item.pubDate ? new Date(item.pubDate).toISOString().replace("T", " ").substring(0, 16) : "",
        link: item.link || "",
      }));
  } catch { /* skip ET */ }

  const sections = [];
  if (filings.length > 0) {
    const lines = ["━━ BSE CORPORATE FILINGS ━━"];
    filings.forEach((f, i) => lines.push(`\n[${i + 1}] ${f.category}\n📅 ${f.date}\n📌 ${f.subject}\n🔗 ${f.link}\n`));
    sections.push(lines.join("\n"));
  }
  if (etNews.length > 0) {
    const lines = ["━━ ECONOMIC TIMES ━━"];
    etNews.forEach((n, i) => lines.push(`\n[${i + 1}] 📅 ${n.date}\n📌 ${n.headline}\n🔗 ${n.link}\n`));
    sections.push(lines.join("\n"));
  }
  const headlines = sections.join("\n");

  await supabase.from("stocks").update({
    latest_headlines: headlines || null,
    last_news_update: new Date().toISOString(),
  }).eq("id", stock.id);

  console.log(`  ✓ BSE filings: ${filings.length} | ET news: ${etNews.length}`);
}

// ── Step 3: AI Summary ────────────────────────────────────────────────────────

async function runSummary(stock) {
  console.log(`\n[3/3] AI summary for ${ticker}...`);

  // Re-fetch updated stock data (fundamentals now populated)
  const { data: updated } = await supabase.from("stocks").select("*").eq("id", stock.id).single();
  const { data: scores }  = await supabase
    .from("daily_scores")
    .select("pe_deviation, rsi, rsi_signal, dma_50, dma_200, classification, suggested_action, date")
    .eq("stock_id", stock.id)
    .order("date", { ascending: false })
    .limit(1);
  const score = scores?.[0] ?? null;

  const s = updated ?? stock;
  const prompt = `You are a senior Indian equity research analyst. Write a concise research note.

Stock: ${s.stock_name} (${ticker})
Industry: ${s.industry || "N/A"}

📊 VALUATION
- Stock PE: ${s.stock_pe || "N/A"} | Industry PE: ${s.industry_pe || "N/A"} | PE Dev: ${score?.pe_deviation != null ? score.pe_deviation + "%" : "N/A"}
- Price: ₹${s.current_price || "N/A"} | 52W High: ₹${s.high_52w || "N/A"} | 52W Low: ₹${s.low_52w || "N/A"}
- P/B: ${s.pb || "N/A"} | EPS: ₹${s.eps || "N/A"} | Div Yield: ${s.dividend_yield != null ? s.dividend_yield + "%" : "N/A"}

🏭 BUSINESS QUALITY
- ROE: ${s.roe || "N/A"}% | ROCE: ${s.roce || "N/A"}% | D/E: ${s.debt_to_equity || "N/A"}
- Profit 3Y CAGR: ${s.profit_growth_3y != null ? s.profit_growth_3y + "%" : "N/A"} | Rev 3Y CAGR: ${s.revenue_growth_3y != null ? s.revenue_growth_3y + "%" : "N/A"}
- Promoter: ${s.promoter_holding != null ? s.promoter_holding + "%" : "N/A"} | Pledged: ${s.pledged_pct != null ? s.pledged_pct + "%" : "N/A"}

📉 TECHNICALS
- RSI: ${score?.rsi || "N/A"} (${score?.rsi_signal || "N/A"}) | 50DMA: ${score?.dma_50 || "N/A"} | 200DMA: ${score?.dma_200 || "N/A"}
- Action: ${score?.suggested_action || "N/A"}

📰 NEWS & SENTIMENT
${s.latest_headlines ? s.latest_headlines.substring(0, 1000) : "No recent news."}

Write using exactly these headers:
📊 VALUATION
🏭 BUSINESS QUALITY
📉 TECHNICALS
📰 NEWS & SENTIMENT
✅ SUGGESTED ACTION

3-4 sentences per section. Be direct and opinionated.`;

  let attempt = 0;
  while (attempt < 3) {
    try {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6", max_tokens: 800,
        messages: [{ role: "user", content: prompt }],
      });
      await logApiUsage('onboard_summary', ticker, response.usage.input_tokens, response.usage.output_tokens);
      const summary = response.content[0].text;
      const today   = new Date().toISOString().split("T")[0];
      await supabase.from("stocks").update({ ai_summary: summary, summary_date: today }).eq("id", stock.id);
      console.log(`  ✓ Summary written`);
      return;
    } catch (err) {
      if (err.status === 529 || err.status === 429) { await sleep(30000); attempt++; }
      else throw err;
    }
  }
  console.log("  ✗ Summary failed after retries");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n[onboardStock] Starting full pipeline for ${ticker}...`);

  const { data: stocks } = await supabase.from("stocks").select("*").eq("ticker", ticker).limit(1);
  const stock = stocks?.[0];
  if (!stock) { console.error(`Stock ${ticker} not found`); process.exit(1); }

  // Skip only if fundamentals, news AND summary are all populated today
  const today = new Date().toISOString().slice(0, 10);
  const fundamentalsDone = stock.fundamentals_updated_at &&
    new Date(stock.fundamentals_updated_at).toISOString().slice(0, 10) === today;
  const newsDone    = !!stock.last_news_update &&
    new Date(stock.last_news_update).toISOString().slice(0, 10) === today;
  const summaryDone = stock.summary_date === today && !!stock.ai_summary;

  if (fundamentalsDone && newsDone && summaryDone) {
    console.log(`  Already fully onboarded today — skipping`);
    process.exit(0);
  }

  try {
    let scored = fundamentalsDone;
    if (!fundamentalsDone) {
      scored = await runFundamentals(stock);
    } else {
      console.log(`\n[1/3] Fundamentals already done today — skipping`);
    }
    if (scored) {
      if (!newsDone) await runNews(stock);
      else console.log(`\n[2/3] News already fetched — skipping`);
      if (!summaryDone) await runSummary(stock);
      else console.log(`\n[3/3] Summary already written today — skipping`);
    }
    console.log(`\n[onboardStock] ✓ ${ticker} fully onboarded`);
    process.exit(0);
  } catch (err) {
    console.error(`[onboardStock] Error:`, err.message);
    process.exit(1);
  }
}

main();
