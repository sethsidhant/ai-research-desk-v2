// telegramNotifier.js — daily RSI/DMA/P&L digest via Telegram
require("dotenv").config({ path: "../.env.local" });
const { createClient } = require("@supabase/supabase-js");
const { sendToMany }   = require("./telegramAlert");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const DASHBOARD_URL = process.env.DASHBOARD_URL || "https://your-app.vercel.app";

// ── PE colour emoji ───────────────────────────────────────────────────────────
function peEmoji(dev) {
  if (dev == null) return "⚪";
  if (dev <= -20)  return "🟢";
  if (dev <    0)  return "🟡";
  if (dev <=  20)  return "🟠";
  return "🔴";
}

// ── P&L digest section ────────────────────────────────────────────────────────
function buildPlDigest(plStocks, label) {
  if (!plStocks.length) return null;

  const lines = [];
  lines.push(`💰 *Interested Amount P&L — ${label}*`);
  lines.push("");

  let totalInvested = 0, totalCurrent = 0;

  for (const s of plStocks) {
    const currentVal = (s.current_price / s.entry_price) * s.invested_amount;
    const pnl        = currentVal - s.invested_amount;
    const pnlPct     = ((s.current_price - s.entry_price) / s.entry_price) * 100;
    const gain       = pnl >= 0;
    const sign       = gain ? "+" : "";
    totalInvested   += s.invested_amount;
    totalCurrent    += currentVal;

    lines.push(`${gain ? "✅" : "🔴"} *${s.stock_name}*`);
    lines.push(`   ₹${s.invested_amount.toLocaleString("en-IN")} → ₹${Math.round(currentVal).toLocaleString("en-IN")} (${sign}${pnlPct.toFixed(1)}%)`);
  }

  lines.push("");
  const totalPnl    = totalCurrent - totalInvested;
  const totalPnlPct = (totalPnl / totalInvested) * 100;
  const totalGain   = totalPnl >= 0;
  lines.push(`💼 *Total: ₹${Math.round(totalInvested).toLocaleString("en-IN")} → ₹${Math.round(totalCurrent).toLocaleString("en-IN")} (${totalGain ? "+" : ""}${totalPnlPct.toFixed(1)}%)*`);

  return lines.join("\n");
}

// ── FII/DII section ───────────────────────────────────────────────────────────
function buildFiiDiiSection(fiiDii) {
  if (!fiiDii) return null;
  const fiiNet = fiiDii.fii_net;
  const diiNet = fiiDii.dii_net;
  const fiiUp  = fiiNet >= 0;
  const diiUp  = diiNet >= 0;
  const fmt    = v => `₹${Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr`;
  return [
    "🌍 *FII / DII Activity*",
    "",
    `${fiiUp ? "🟢" : "🔴"} FII: ${fiiUp ? "+" : "-"}${fmt(fiiNet)} net ${fiiUp ? "buying" : "selling"}`,
    `${diiUp ? "🟢" : "🔴"} DII: ${diiUp ? "+" : "-"}${fmt(diiNet)} net ${diiUp ? "buying" : "selling"}`,
  ].join("\n");
}

// ── Build digest for one user ─────────────────────────────────────────────────
function buildDigest(stocks, prefs, fiiDii) {
  const oversoldThreshold   = prefs?.rsi_oversold_threshold   ?? 30;
  const overboughtThreshold = prefs?.rsi_overbought_threshold ?? 70;

  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "short"
  });

  const lines = [];
  lines.push(`📊 *Research Desk — ${today}*`);
  lines.push("");

  // FII/DII
  const fiiSection = buildFiiDiiSection(fiiDii);
  if (fiiSection) { lines.push(fiiSection); lines.push(""); lines.push("─────────────────────"); lines.push(""); }

  // RSI Signals
  const oversold       = stocks.filter(s => s.rsi != null && s.rsi < oversoldThreshold);
  const nearOversold   = stocks.filter(s => s.rsi != null && s.rsi >= oversoldThreshold && s.rsi < oversoldThreshold + 10);
  const overbought     = stocks.filter(s => s.rsi != null && s.rsi > overboughtThreshold);
  const nearOverbought = stocks.filter(s => s.rsi != null && s.rsi >= overboughtThreshold - 10 && s.rsi <= overboughtThreshold);

  lines.push("📉 *RSI Signals*");
  lines.push("");
  if (oversold.length)
    lines.push(`⚡ Oversold <${oversoldThreshold}:\n${oversold.map(s => `   ${peEmoji(s.pe_deviation)} ${s.stock_name} (${s.rsi.toFixed(0)})`).join("\n")}`);
  if (nearOversold.length)
    lines.push(`🟡 Watch ${oversoldThreshold}–${oversoldThreshold + 10}:\n${nearOversold.map(s => `   ${peEmoji(s.pe_deviation)} ${s.stock_name} (${s.rsi.toFixed(0)})`).join("\n")}`);
  if (overbought.length)
    lines.push(`🔥 Overbought >${overboughtThreshold}:\n${overbought.map(s => `   ${peEmoji(s.pe_deviation)} ${s.stock_name} (${s.rsi.toFixed(0)})`).join("\n")}`);
  if (nearOverbought.length)
    lines.push(`🟠 Watch ${overboughtThreshold - 10}–${overboughtThreshold}:\n${nearOverbought.map(s => `   ${peEmoji(s.pe_deviation)} ${s.stock_name} (${s.rsi.toFixed(0)})`).join("\n")}`);
  if (!oversold.length && !nearOversold.length && !overbought.length && !nearOverbought.length)
    lines.push("✅ All RSI in normal range");

  lines.push("");
  lines.push("─────────────────────");
  lines.push("");

  // DMA Signals
  const aboveBoth       = stocks.filter(s => s.above_50_dma && s.above_200_dma);
  const belowBoth       = stocks.filter(s => !s.above_50_dma && !s.above_200_dma && s.current_price != null);
  const above50below200 = stocks.filter(s => s.above_50_dma && !s.above_200_dma);
  const below50above200 = stocks.filter(s => !s.above_50_dma && s.above_200_dma);

  lines.push("📈 *DMA Signals*");
  lines.push("");
  if (aboveBoth.length)
    lines.push(`↑↑ Above both:\n${aboveBoth.map(s => `   ${peEmoji(s.pe_deviation)} ${s.stock_name}`).join("\n")}`);
  if (belowBoth.length)
    lines.push(`↓↓ Below both:\n${belowBoth.map(s => `   ${peEmoji(s.pe_deviation)} ${s.stock_name}`).join("\n")}`);
  if (above50below200.length)
    lines.push(`↑↓ Above 50D, below 200D:\n${above50below200.map(s => `   ${peEmoji(s.pe_deviation)} ${s.stock_name}`).join("\n")}`);
  if (below50above200.length)
    lines.push(`↓↑ Below 50D, above 200D:\n${below50above200.map(s => `   ${peEmoji(s.pe_deviation)} ${s.stock_name}`).join("\n")}`);

  lines.push("");
  lines.push(`🔗 ${DASHBOARD_URL}`);

  const body = lines.join("\n");
  return body.length > 4000 ? body.slice(0, 3997) + "..." : body;
}

// ── Kite live prices ──────────────────────────────────────────────────────────
// Fetches fresh closing/live prices for all stocks. Access token read from
// Supabase app_settings (refreshed daily by Railway token job).
async function fetchKitePrices(stockIds) {
  const apiKey = process.env.KITE_API_KEY;
  if (!apiKey) return {};

  const { data: tokenRow } = await supabase
    .from('app_settings').select('value').eq('key', 'kite_access_token').single();
  const accessToken = tokenRow?.value;
  if (!accessToken) return {};

  const { data: stocks } = await supabase
    .from('stocks').select('id, ticker, instrument_token').in('id', stockIds);
  if (!stocks?.length) return {};

  const valid = stocks.filter(s => s.instrument_token);
  if (!valid.length) return {};

  const tokens = valid.map(s => s.instrument_token).join('&i=');
  try {
    const res = await fetch(`https://api.kite.trade/quote?i=${tokens}`, {
      headers: { 'X-Kite-Version': '3', 'Authorization': `token ${apiKey}:${accessToken}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) { console.log(`[kite] HTTP ${res.status}`); return {}; }
    const json = await res.json();
    const kiteData = json.data ?? {};
    const tokenToId = {};
    for (const s of valid) tokenToId[s.instrument_token] = s.id;
    const prices = {};
    for (const [, val] of Object.entries(kiteData)) {
      const v = val;
      const id = tokenToId[v.instrument_token];
      if (id && v.last_price) prices[id] = v.last_price;
    }
    console.log(`[kite] Live prices fetched for ${Object.keys(prices).length} stocks`);
    return prices;
  } catch (e) {
    console.log(`[kite] Price fetch failed: ${e.message} — falling back to DB prices`);
    return {};
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("📊 Telegram Notifier — per-user digest\n");

  const now      = new Date();
  const isMonday = now.getDay() === 1;
  const isFirst  = now.getDate() === 1;

  const { data: allPrefs, error: prefsError } = await supabase
    .from("user_alert_preferences")
    .select("user_id, telegram_chat_id, rsi_oversold_threshold, rsi_overbought_threshold, pl_alert_daily, pl_alert_weekly, pl_alert_monthly")
    .not("telegram_chat_id", "is", null);

  if (prefsError) { console.error("DB error:", prefsError.message); process.exit(1); }
  if (!allPrefs?.length) { console.log("No users with Telegram configured."); process.exit(0); }

  console.log(`Found ${allPrefs.length} user(s) with Telegram\n`);

  // Fetch today's FII/DII — shown to all users
  const { data: fiiDiiRows } = await supabase
    .from("fii_dii_daily")
    .select("date, fii_net, dii_net")
    .order("date", { ascending: false })
    .limit(1);
  const fiiDii = fiiDiiRows?.[0] ?? null;
  if (fiiDii) console.log(`FII/DII: ${fiiDii.date} | FII ${fiiDii.fii_net} | DII ${fiiDii.dii_net}`);

  for (const prefs of allPrefs) {
    console.log(`Processing user ${prefs.user_id}...`);

    const { data: userStocks } = await supabase
      .from("user_stocks")
      .select("stock_id, invested_amount, entry_price")
      .eq("user_id", prefs.user_id);

    if (!userStocks?.length) { console.log("  No stocks — skipping"); continue; }

    const stockIds = userStocks.map(s => s.stock_id);

    const { data: scores } = await supabase
      .from("daily_scores")
      .select("stock_id, rsi, pe_deviation, above_50_dma, above_200_dma, date")
      .in("stock_id", stockIds)
      .order("date", { ascending: false });

    const latestScore = {};
    for (const s of (scores ?? [])) {
      if (!latestScore[s.stock_id]) latestScore[s.stock_id] = s;
    }

    const { data: stockDetails } = await supabase
      .from("stocks")
      .select("id, stock_name, current_price")
      .in("id", stockIds);

    const stockMap = {};
    for (const s of (stockDetails ?? [])) stockMap[s.id] = s;

    // Fetch live prices from Kite — overrides stale DB current_price
    const livePrices = await fetchKitePrices(stockIds);

    const digestStocks = stockIds
      .map(id => {
        const stock = stockMap[id];
        const score = latestScore[id];
        if (!stock) return null;
        return {
          stock_name:    stock.stock_name,
          current_price: livePrices[id] ?? stock.current_price,
          rsi:           score?.rsi ?? null,
          pe_deviation:  score?.pe_deviation ?? null,
          above_50_dma:  score?.above_50_dma ?? null,
          above_200_dma: score?.above_200_dma ?? null,
        };
      })
      .filter(Boolean);

    // 1. Main RSI/DMA digest
    const message = buildDigest(digestStocks, prefs, fiiDii);
    await sendToMany([prefs.telegram_chat_id], message);
    console.log(`  ✓ Digest sent`);

    // 2. P&L digest
    const plStocks = userStocks
      .filter(s => s.invested_amount && s.entry_price)
      .map(s => {
        const stock = stockMap[s.stock_id];
        if (!stock?.current_price) return null;
        return {
          stock_name:      stock.stock_name,
          current_price:   livePrices[s.stock_id] ?? stock.current_price,
          invested_amount: s.invested_amount,
          entry_price:     s.entry_price,
        };
      })
      .filter(Boolean);

    if (plStocks.length > 0) {
      if (prefs.pl_alert_daily) {
        const label = now.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
        const plMsg = buildPlDigest(plStocks, label);
        if (plMsg) { await sendToMany([prefs.telegram_chat_id], plMsg); console.log(`  ✓ Daily P&L sent`); }
      }
      if (prefs.pl_alert_weekly && isMonday) {
        const plMsg = buildPlDigest(plStocks, "This Week");
        if (plMsg) { await sendToMany([prefs.telegram_chat_id], plMsg); console.log(`  ✓ Weekly P&L sent`); }
      }
      if (prefs.pl_alert_monthly && isFirst) {
        const plMsg = buildPlDigest(plStocks, now.toLocaleDateString("en-IN", { month: "long", year: "numeric" }));
        if (plMsg) { await sendToMany([prefs.telegram_chat_id], plMsg); console.log(`  ✓ Monthly P&L sent`); }
      }
    }
  }

  console.log("\nTelegram Notifier complete.");
}

main().catch(err => { console.error("❌ Error:", err.message); process.exit(1); });
