// runOneStock.js — Runs the full engine for a single ticker.
// Usage: node runOneStock.js TICKER
// Called by /api/run-stock/[ticker] when a user adds a stock.

require("dotenv").config({ path: "../.env.local" });
const Anthropic    = require("@anthropic-ai/sdk");
const { execSync } = require("child_process");
const { getTechnicals, getReturns, NIFTY50_TOKEN, NIFTY500_TOKEN, setKiteToken } = require("./technicalService");
const { upsertStock, upsertDailyScore, insertHistory } = require("./pgHelper");
const { createClient } = require("@supabase/supabase-js");

const ticker = process.argv[2];
if (!ticker) { console.error("Usage: node runOneStock.js TICKER"); process.exit(1); }

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase  = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

function getRSISignal(rsi) {
  if (rsi == null) return null;
  if (rsi < 30)  return "Oversold";
  if (rsi < 45)  return "Weakening";
  if (rsi < 55)  return "Neutral";
  if (rsi < 70)  return "Strengthening";
  return "Overbought";
}

function getScreenerFundamentals(t) {
  try {
    const out = execSync(`python3 fetchScreenerFundamentals.py ${t}`, {
      encoding: "utf8", cwd: __dirname,
    });
    return JSON.parse(out);
  } catch { return null; }
}

function getIndustryPE(industryName) {
  try {
    const out = execSync(
      `python3 fetchIndustryPE.py "${industryName}"`,
      { encoding: "utf8", cwd: __dirname, env: { ...process.env, PYTHONIOENCODING: "utf-8" } }
    );
    const m = out.match(/Median: ([\d.]+)/);
    return m ? parseFloat(m[1]) : null;
  } catch { return null; }
}

async function getKiteOHLC(token) {
  if (!token) return null;
  try {
    const res = await fetch(`https://api.kite.trade/quote?i=${token}`, {
      headers: { "X-Kite-Version": "3", "Authorization": `token ${process.env.KITE_API_KEY}:${process.env.KITE_ACCESS_TOKEN}` },
    });
    const json = await res.json();
    const data = Object.values(json.data ?? {})[0];
    if (!data) return null;
    return { open: data.ohlc?.open ?? null, high: data.ohlc?.high ?? null, low: data.ohlc?.low ?? null, close: data.ohlc?.close ?? null, volume: data.volume_traded ?? null };
  } catch { return null; }
}

async function main() {
  console.log(`[runOneStock] Processing ${ticker}...`);

  // Load fresh Kite token from Supabase (Railway env var may be stale)
  const { data: tokenRow } = await supabase.from('app_settings').select('value').eq('key', 'kite_access_token').single();
  if (tokenRow?.value) setKiteToken(tokenRow.value);

  // Fetch stock record
  const { data: stocks } = await supabase.from("stocks").select("*").eq("ticker", ticker).limit(1);
  const stock = stocks?.[0];
  if (!stock) { console.error(`Stock ${ticker} not found in DB`); process.exit(1); }

  const todayStr = new Date().toISOString().slice(0, 10);

  // 1. Screener fundamentals
  const f = getScreenerFundamentals(ticker);
  if (!f) { console.log(`No fundamentals for ${ticker} — Screener may not have it`); process.exit(0); }

  // 2. Industry PE
  let industryPE = stock.industry_pe ?? null;
  if (f.industry_hierarchy) {
    const fetched = getIndustryPE(f.industry_hierarchy);
    if (fetched) industryPE = fetched;
  }

  // 3. Update stocks table
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

  // 4. PE deviation
  const peDeviation = industryPE && f.pe
    ? parseFloat(((f.pe - industryPE) / industryPE * 100).toFixed(2))
    : null;

  // 5. Technicals
  const raw  = stock.instrument_token ? await getTechnicals(stock.instrument_token) : null;
  const tech = raw ? {
    rsi:         raw.rsi,
    above50DMA:  raw.currentPrice > raw.sma50,
    above200DMA: raw.currentPrice > raw.sma200,
    dma50Value:  raw.dma50Value,
    dma200Value: raw.dma200Value,
  } : null;

  // 6. Returns
  const [stockReturns, niftyReturns, nifty500Returns] = await Promise.all([
    stock.instrument_token ? getReturns(stock.instrument_token) : Promise.resolve({ r6m: null, r1y: null }),
    getReturns(NIFTY50_TOKEN),
    getReturns(NIFTY500_TOKEN),
  ]);

  // 7. Claude scoring
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
  const jsonMatch = response.content[0].text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) { console.log("Invalid JSON from Claude"); process.exit(1); }
  const result = JSON.parse(jsonMatch[0]);

  // 8. Write scores + history
  await upsertDailyScore(stock.id, todayStr, {
    pe_deviation: peDeviation, rsi: tech?.rsi ?? null, rsi_signal: getRSISignal(tech?.rsi),
    dma_50: tech?.dma50Value ?? null, dma_200: tech?.dma200Value ?? null,
    above_50_dma: tech?.above50DMA ?? null, above_200_dma: tech?.above200DMA ?? null,
    composite_score: result.composite_score, classification: result.classification,
    suggested_action: result.suggested_action,
    stock_6m: stockReturns.r6m, stock_1y: stockReturns.r1y,
    nifty50_6m: niftyReturns.r6m, nifty50_1y: niftyReturns.r1y,
    nifty500_6m: nifty500Returns.r6m, nifty500_1y: nifty500Returns.r1y,
  });

  const ohlc = await getKiteOHLC(stock.instrument_token);
  await insertHistory(stock.id, todayStr, {
    closing_price: ohlc?.close ?? f.current_price ?? null,
    open: ohlc?.open ?? null, day_high: ohlc?.high ?? null, day_low: ohlc?.low ?? null,
    volume: ohlc?.volume ?? null, stock_pe: f.pe ?? null, industry_pe: industryPE ?? null,
    pe_deviation: peDeviation, pb: f.pb ?? null, market_cap: f.market_cap ?? null,
    pct_from_52w_high: f.pct_from_52w_high ?? null,
    rsi: tech?.rsi ?? null, rsi_signal: getRSISignal(tech?.rsi),
    dma_50: tech?.dma50Value ?? null, dma_200: tech?.dma200Value ?? null,
    composite_score: result.composite_score, classification: result.classification,
    suggested_action: result.suggested_action,
    stock_6m: stockReturns.r6m, stock_1y: stockReturns.r1y,
    nifty50_6m: niftyReturns.r6m, nifty50_1y: niftyReturns.r1y,
  });

  console.log(`[runOneStock] ✓ ${ticker} — ${result.classification} | ${result.suggested_action} | Score: ${result.composite_score}`);
  process.exit(0);
}

main().catch(e => { console.error("[runOneStock] Error:", e.message); process.exit(1); });
