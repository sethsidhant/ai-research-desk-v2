// whatsappNotifier.js — V2
// Sends per-user RSI + DMA digest via WhatsApp using each user's alert preferences.

require("dotenv").config({ path: "../.env.local" });
const twilio = require("twilio");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const FROM_NUMBER    = process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886";
const DASHBOARD_URL  = process.env.DASHBOARD_URL || "https://your-app.vercel.app";
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function sendTelegram(chatId, text) {
  if (!TELEGRAM_TOKEN || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
    });
  } catch (err) {
    console.error(`  [telegram] Send error:`, err.message);
  }
}

if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
  console.error("❌ Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN");
  process.exit(1);
}
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

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
    const emoji      = gain ? "✅" : "🔴";
    const sign       = gain ? "+" : "";
    totalInvested   += s.invested_amount;
    totalCurrent    += currentVal;

    lines.push(`${emoji} *${s.stock_name}*`);
    lines.push(`   ₹${s.invested_amount.toLocaleString("en-IN")} → ₹${Math.round(currentVal).toLocaleString("en-IN")} (${sign}${pnlPct.toFixed(1)}%)`);
  }

  lines.push("");
  const totalPnl    = totalCurrent - totalInvested;
  const totalPnlPct = (totalPnl / totalInvested) * 100;
  const totalGain   = totalPnl >= 0;
  lines.push(`💼 *Total: ₹${Math.round(totalInvested).toLocaleString("en-IN")} → ₹${Math.round(totalCurrent).toLocaleString("en-IN")} (${totalGain ? "+" : ""}${totalPnlPct.toFixed(1)}%)*`);

  return lines.join("\n");
}

// ── Build digest for one user ─────────────────────────────────────────────────
function buildDigest(stocks, prefs) {
  const oversoldThreshold    = prefs?.rsi_oversold_threshold    ?? 30;
  const overboughtThreshold  = prefs?.rsi_overbought_threshold  ?? 70;

  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "short"
  });

  const lines = [];
  lines.push(`📊 *Research Desk — ${today}*`);
  lines.push("");

  // RSI Signals
  const oversold     = stocks.filter(s => s.rsi != null && s.rsi < oversoldThreshold);
  const nearOversold = stocks.filter(s => s.rsi != null && s.rsi >= oversoldThreshold && s.rsi < oversoldThreshold + 10);
  const overbought   = stocks.filter(s => s.rsi != null && s.rsi > overboughtThreshold);
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
  return body.length > 1550 ? body.slice(0, 1547) + "..." : body;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("📊 WhatsApp Notifier V2 — per-user digest\n");

  const now       = new Date();
  const isMonday  = now.getDay() === 1;
  const isFirst   = now.getDate() === 1;

  // Get all users who have configured alerts (any channel)
  const { data: allPrefs, error: prefsError } = await supabase
    .from("user_alert_preferences")
    .select("user_id, whatsapp_number, alert_channel, rsi_oversold_threshold, rsi_overbought_threshold, pl_alert_daily, pl_alert_weekly, pl_alert_monthly, telegram_chat_id");

  if (prefsError) { console.error("DB error:", prefsError.message); process.exit(1); }
  if (!allPrefs?.length) { console.log("No users with alert preferences configured."); process.exit(0); }

  console.log(`Found ${allPrefs.length} user(s) with alert preferences\n`);

  for (const prefs of allPrefs) {
    console.log(`Processing user ${prefs.user_id}...`);

    // Get this user's watchlist (including P&L fields)
    const { data: userStocks } = await supabase
      .from("user_stocks")
      .select("stock_id, invested_amount, entry_price")
      .eq("user_id", prefs.user_id);

    if (!userStocks?.length) { console.log("  No stocks in watchlist — skipping"); continue; }

    const stockIds = userStocks.map(s => s.stock_id);

    // Get latest scores for their stocks
    const { data: scores } = await supabase
      .from("daily_scores")
      .select("stock_id, rsi, pe_deviation, above_50_dma, above_200_dma, date")
      .in("stock_id", stockIds)
      .order("date", { ascending: false });

    const latestScore = {};
    for (const s of (scores ?? [])) {
      if (!latestScore[s.stock_id]) latestScore[s.stock_id] = s;
    }

    // Get stock names + prices
    const { data: stockDetails } = await supabase
      .from("stocks")
      .select("id, stock_name, current_price")
      .in("id", stockIds);

    const stockMap = {};
    for (const s of (stockDetails ?? [])) stockMap[s.id] = s;

    // Merge into digest rows
    const digestStocks = stockIds
      .map(id => {
        const stock = stockMap[id];
        const score = latestScore[id];
        if (!stock) return null;
        return {
          stock_name:   stock.stock_name,
          current_price: stock.current_price,
          rsi:          score?.rsi ?? null,
          pe_deviation: score?.pe_deviation ?? null,
          above_50_dma: score?.above_50_dma ?? null,
          above_200_dma: score?.above_200_dma ?? null,
        };
      })
      .filter(Boolean);

    const channel   = prefs.alert_channel ?? "whatsapp";
    const recipient = prefs.whatsapp_number?.startsWith("whatsapp:")
      ? prefs.whatsapp_number
      : `whatsapp:${prefs.whatsapp_number}`;

    async function send(body) {
      // WhatsApp
      if ((channel === "whatsapp" || channel === "both") && prefs.whatsapp_number) {
        const msg = await twilioClient.messages.create({ from: FROM_NUMBER, to: recipient, body });
        console.log(`  ✓ WhatsApp sent — SID: ${msg.sid}`);
      }
      // Telegram
      if ((channel === "telegram" || channel === "both") && prefs.telegram_chat_id) {
        await sendTelegram(prefs.telegram_chat_id, body);
        console.log(`  ✓ Telegram sent → chat_id ${prefs.telegram_chat_id}`);
      }
    }

    // ── 1. Main RSI/DMA digest ────────────────────────────────────────────────
    const message = buildDigest(digestStocks, prefs);
    await send(message);

    // ── 2. P&L digest (if user opted in and has interested stocks) ────────────
    const plStocks = userStocks
      .filter(s => s.invested_amount && s.entry_price)
      .map(s => {
        const stock = stockMap[s.stock_id];
        if (!stock?.current_price) return null;
        return {
          stock_name:      stock.stock_name,
          current_price:   stock.current_price,
          invested_amount: s.invested_amount,
          entry_price:     s.entry_price,
        };
      })
      .filter(Boolean);

    if (plStocks.length > 0) {
      if (prefs.pl_alert_daily) {
        const label = now.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
        const plMsg = buildPlDigest(plStocks, label);
        if (plMsg) { await send(plMsg); console.log(`  ✓ Daily P&L digest sent`); }
      }
      if (prefs.pl_alert_weekly && isMonday) {
        const plMsg = buildPlDigest(plStocks, "This Week");
        if (plMsg) { await send(plMsg); console.log(`  ✓ Weekly P&L digest sent`); }
      }
      if (prefs.pl_alert_monthly && isFirst) {
        const plMsg = buildPlDigest(plStocks, now.toLocaleDateString("en-IN", { month: "long", year: "numeric" }));
        if (plMsg) { await send(plMsg); console.log(`  ✓ Monthly P&L digest sent`); }
      }
    }

    // Email send via Twilio SendGrid (if configured)
    if (channel === "email" || channel === "both") {
      const { data: authUser } = await supabase.auth.admin.getUserById(prefs.user_id);
      const email = authUser?.user?.email;
      if (email && process.env.SENDGRID_API_KEY) {
        await fetch("https://api.sendgrid.com/v3/mail/send", {
          method: "POST",
          headers: { "Authorization": `Bearer ${process.env.SENDGRID_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            personalizations: [{ to: [{ email }] }],
            from: { email: process.env.SENDGRID_FROM_EMAIL || "alerts@yourdomain.com" },
            subject: `📊 Research Desk — ${now.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}`,
            content: [{ type: "text/plain", value: message }],
          }),
        });
        console.log(`  ✓ Email sent to ${email}`);
      } else if (!process.env.SENDGRID_API_KEY) {
        console.log(`  ⚠ Email channel selected but SENDGRID_API_KEY not set — skipping email`);
      }
    }
  }

  console.log("\nWhatsApp Notifier V2 complete.");
}

main().catch(err => {
  console.error("❌ Error:", err.message);
  if (err.code === 63007) console.error("   → Send 'join according-search' to +14155238886 on WhatsApp first");
  if (err.code === 20003) console.error("   → Invalid Twilio credentials");
  process.exit(1);
});
