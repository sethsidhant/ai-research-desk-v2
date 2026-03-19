// pgHelper.js — V2 (Supabase JS client, bypasses direct Postgres DNS issue)

require("dotenv").config({ path: "../.env.local" });
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function getAllStocks() {
  const { data, error } = await supabase
    .from("stocks")
    .select("*")
    .order("ticker");
  if (error) throw new Error("getAllStocks: " + error.message);
  return data;
}

// Returns only stocks that appear in at least one user's watchlist
async function getWatchlistedStocks() {
  const { data, error } = await supabase
    .from("user_stocks")
    .select("stock_id");
  if (error) throw new Error("getWatchlistedStocks (user_stocks): " + error.message);

  const ids = [...new Set((data ?? []).map(r => r.stock_id))];
  if (ids.length === 0) return [];

  const { data: stocks, error: err2 } = await supabase
    .from("stocks")
    .select("*")
    .in("id", ids)
    .order("ticker");
  if (err2) throw new Error("getWatchlistedStocks (stocks): " + err2.message);
  return stocks;
}

async function upsertStock(ticker, fields) {
  const { error } = await supabase
    .from("stocks")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("ticker", ticker);
  if (error) throw new Error("upsertStock: " + error.message);
}

async function upsertDailyScore(stockId, date, fields) {
  const { error } = await supabase
    .from("daily_scores")
    .upsert({ stock_id: stockId, date, ...fields }, { onConflict: "stock_id,date" });
  if (error) throw new Error("upsertDailyScore: " + error.message);
}

async function insertHistory(stockId, date, fields) {
  const { error } = await supabase
    .from("daily_history")
    .upsert({ stock_id: stockId, date, ...fields }, { onConflict: "stock_id,date", ignoreDuplicates: true });
  if (error) throw new Error("insertHistory: " + error.message);
}

async function closePool() {
  // No-op — Supabase JS client has no pool to close
}

const PRICE_INPUT  = 3.00   // $ per 1M input tokens (claude-sonnet-4-6)
const PRICE_OUTPUT = 15.00  // $ per 1M output tokens

async function logApiUsage(agent, ticker, inputTokens, outputTokens) {
  const costUsd = (inputTokens / 1_000_000) * PRICE_INPUT + (outputTokens / 1_000_000) * PRICE_OUTPUT
  const { error } = await supabase.from('api_usage_log').insert({
    agent, ticker: ticker ?? null, input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: costUsd,
  })
  if (error) console.error('[logApiUsage] Failed:', error.message)
}

module.exports = { getAllStocks, getWatchlistedStocks, upsertStock, upsertDailyScore, insertHistory, closePool, logApiUsage };
