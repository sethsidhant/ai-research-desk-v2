// telegramBot.js — Handles Telegram user registration for alerts
// Users open the bot, send their email, bot matches to their account and stores chat_id
// Run permanently via pm2: pm2 start telegramBot.js --name ai-desk-telegram

require("dotenv").config({ path: "../.env.local" });
const { createClient } = require("@supabase/supabase-js");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) { console.error("❌ TELEGRAM_BOT_TOKEN not set"); process.exit(1); }

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const API = `https://api.telegram.org/bot${BOT_TOKEN}`;
let offset = 0;

async function sendMessage(chatId, text) {
  await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text   = (msg.text ?? "").trim();

  if (text === "/start") {
    await sendMessage(chatId,
      `👋 Welcome to *AI Research Desk*!\n\nTo receive alerts here, send me your login email address and I'll link your account.`
    );
    return;
  }

  // Check if it looks like an email
  if (!text.includes("@")) {
    await sendMessage(chatId, `Please send your login email address to connect your account.`);
    return;
  }

  const email = text.toLowerCase();

  // Look up user by email via admin API
  const { data: { users }, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) { await sendMessage(chatId, "Something went wrong. Please try again later."); return; }

  const user = users.find(u => u.email?.toLowerCase() === email);
  if (!user) {
    await sendMessage(chatId, `❌ No account found for *${text}*.\n\nMake sure you're using the same email you signed up with.`);
    return;
  }

  // Store chat_id in user_alert_preferences
  const { error: upsertErr } = await supabase
    .from("user_alert_preferences")
    .upsert({ user_id: user.id, telegram_chat_id: String(chatId) }, { onConflict: "user_id" });

  if (upsertErr) {
    await sendMessage(chatId, "Failed to link account. Please try again.");
    return;
  }

  await sendMessage(chatId,
    `✅ *Account linked!*\n\nYou'll now receive your AI Research Desk alerts here.\n\nTo change alert preferences, visit the Settings page on the dashboard.`
  );
  console.log(`[telegram] Linked ${email} → chat_id ${chatId}`);
}

async function poll() {
  try {
    const res  = await fetch(`${API}/getUpdates?offset=${offset}&timeout=30`);
    const json = await res.json();
    if (!json.ok) { console.error("[telegram] getUpdates error:", json); return; }

    for (const update of json.result) {
      offset = update.update_id + 1;
      if (update.message) await handleMessage(update.message);
    }
  } catch (err) {
    console.error("[telegram] Poll error:", err.message);
  }
  setTimeout(poll, 1000);
}

console.log("[telegram] Bot started — polling for messages...");
poll();
