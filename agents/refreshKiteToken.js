// refreshKiteToken.js
// Automates Kite Connect token refresh using TOTP (no browser needed).
// Run daily before market open — recommended 8:30 AM IST (3 AM Dublin / 4 AM BST).
//
// Required env vars (add to .env.local):
//   KITE_USER_ID       — your Zerodha client ID (e.g. AB1234)
//   KITE_PASSWORD      — your Zerodha login password
//   KITE_TOTP_SECRET   — base32 secret from Kite 2FA setup (re-scan QR in Kite profile)
//   KITE_API_KEY       — from Kite Connect developer console
//   KITE_API_SECRET    — from Kite Connect developer console

require("dotenv").config({ path: "../.env.local" });
const { KiteConnect }   = require("kiteconnect");
const { generateSync }   = require("otplib");
const fs                = require("fs");
const path              = require("path");
const { createClient }  = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const {
  KITE_USER_ID,
  KITE_PASSWORD,
  KITE_TOTP_SECRET,
  KITE_API_KEY,
  KITE_API_SECRET,
} = process.env;

if (!KITE_USER_ID || !KITE_PASSWORD || !KITE_TOTP_SECRET || !KITE_API_KEY || !KITE_API_SECRET) {
  console.error("Missing required env vars. Need: KITE_USER_ID, KITE_PASSWORD, KITE_TOTP_SECRET, KITE_API_KEY, KITE_API_SECRET");
  process.exit(1);
}

async function getRequestToken() {
  // Step 1 — Login with credentials
  const loginRes = await fetch("https://kite.zerodha.com/api/login", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0" },
    body:    new URLSearchParams({ user_id: KITE_USER_ID, password: KITE_PASSWORD }),
  });
  const loginData = await loginRes.json();
  if (loginData.status !== "success") throw new Error(`Login failed: ${JSON.stringify(loginData)}`);

  const cookies    = (loginRes.headers.get("set-cookie") ?? "").split(",").map(c => c.split(";")[0].trim()).join("; ");
  const requestId  = loginData.data.request_id;
  console.log("  ✓ Login successful");

  // Step 2 — TOTP 2FA
  // Wait if we're in the last 5s of a TOTP window — avoids code expiring mid-request
  const secsLeft = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (secsLeft <= 5) await new Promise(r => setTimeout(r, (secsLeft + 1) * 1000));
  const totpCode = generateSync({ secret: KITE_TOTP_SECRET, digits: 6, period: 30 });
  const twoFaRes = await fetch("https://kite.zerodha.com/api/twofa", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0", "Cookie": cookies },
    body:    new URLSearchParams({ user_id: KITE_USER_ID, request_id: requestId, twofa_value: totpCode, twofa_type: "totp" }),
  });
  const twoFaData = await twoFaRes.json();
  if (twoFaData.status !== "success") throw new Error(`2FA failed: ${JSON.stringify(twoFaData)}`);

  const allCookies = [
    ...cookies.split("; "),
    ...(twoFaRes.headers.get("set-cookie") ?? "").split(",").map(c => c.split(";")[0].trim()),
  ].filter(Boolean).join("; ");
  console.log("  ✓ 2FA successful");

  // Step 3 — Authorize Kite Connect app (follows redirect, extracts request_token)
  const authRes = await fetch(
    `https://kite.zerodha.com/connect/login?v=3&api_key=${KITE_API_KEY}`,
    {
      method:   "GET",
      headers:  { "User-Agent": "Mozilla/5.0", "Cookie": allCookies },
      redirect: "manual",
    }
  );

  // Follow redirects manually to find request_token
  let location = authRes.headers.get("location") ?? "";
  let hops     = 0;
  let lastCookies = allCookies;

  while (location && !location.includes("request_token") && hops < 5) {
    const nextRes = await fetch(location, {
      method:   "GET",
      headers:  { "User-Agent": "Mozilla/5.0", "Cookie": lastCookies },
      redirect: "manual",
    });
    const newCookies = (nextRes.headers.get("set-cookie") ?? "").split(",").map(c => c.split(";")[0].trim()).filter(Boolean);
    if (newCookies.length) lastCookies = [...lastCookies.split("; "), ...newCookies].join("; ");
    location = nextRes.headers.get("location") ?? "";
    hops++;
  }

  const match = location.match(/request_token=([^&]+)/);
  if (!match) throw new Error(`Could not extract request_token from redirect: ${location}`);

  console.log("  ✓ Got request_token");
  return match[1];
}

async function updateEnvFile(newToken) {
  // Update .env.local
  const envPath = path.join(__dirname, "../.env.local");
  let content   = fs.readFileSync(envPath, "utf8");
  if (content.includes("KITE_ACCESS_TOKEN=")) {
    content = content.replace(/KITE_ACCESS_TOKEN=.*/, `KITE_ACCESS_TOKEN=${newToken}`);
  } else {
    content += `\nKITE_ACCESS_TOKEN=${newToken}`;
  }
  fs.writeFileSync(envPath, content, "utf8");
  console.log("  ✓ .env.local updated");

  // Write to .kite_token for local Next.js server (no restart needed)
  const tokenPath = path.join(__dirname, "../.kite_token");
  fs.writeFileSync(tokenPath, newToken, "utf8");
  console.log("  ✓ .kite_token updated");

  // Save to Supabase app_settings so Vercel picks it up without env var restart
  const { error } = await supabase.from("app_settings").upsert(
    { key: "kite_access_token", value: newToken, updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
  if (error) console.error("  ✗ Supabase token save failed:", error.message);
  else console.log("  ✓ Supabase app_settings updated");
}

async function main() {
  console.log(`\n[refreshKiteToken] ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST\n`);

  try {
    const requestToken  = await getRequestToken();
    const kite          = new KiteConnect({ api_key: KITE_API_KEY });
    const session       = await kite.generateSession(requestToken, KITE_API_SECRET);
    const accessToken   = session.access_token;

    console.log(`  ✓ New access token: ${accessToken.slice(0, 8)}...`);
    await updateEnvFile(accessToken);

    console.log("\n✅ Kite token refreshed successfully.");
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Token refresh failed:", err.message);
    process.exit(1);
  }
}

main();
