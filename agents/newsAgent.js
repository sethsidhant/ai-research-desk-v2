// newsAgent.js — V2
// Fetches BSE filings + ET news per stock, writes to stocks table in Postgres.

require("dotenv").config({ path: "../.env.local" });
const RSSParser = require("rss-parser");
const axios     = require("axios");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const rssParser = new RSSParser({ timeout: 15000, headers: { "User-Agent": "Mozilla/5.0" } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── BSE Session Cookie ────────────────────────────────────────────────────────
const BSE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  "Connection": "keep-alive",
};

let bseCookieCache = null;

async function getBSECookie() {
  if (bseCookieCache) return bseCookieCache;
  try {
    console.log("  Fetching BSE session cookie...");
    const resp = await axios.get("https://www.bseindia.com/corporates/ann.html", {
      headers: { ...BSE_HEADERS, "Accept": "text/html,application/xhtml+xml,*/*;q=0.8", "Upgrade-Insecure-Requests": "1" },
      timeout: 20000, maxRedirects: 5,
    });
    const setCookie = resp.headers["set-cookie"];
    if (setCookie?.length > 0) {
      bseCookieCache = setCookie.map(c => c.split(";")[0]).join("; ");
      console.log(`  BSE cookie obtained`);
    } else {
      bseCookieCache = "";
    }
  } catch (e) {
    console.log(`  BSE cookie fetch failed: ${e.message}`);
    bseCookieCache = "";
  }
  return bseCookieCache;
}

// ── BSE Corporate Announcements ───────────────────────────────────────────────
async function fetchBSEFilings(bseCode, stockName, attempt = 1) {
  try {
    const code = String(parseInt(bseCode));
    const cookie = await getBSECookie();
    const url = `https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w?strCat=-1&strPrevDate=&strScrip=${code}&strSearch=P&strToDate=&strType=C&subcategory=-1`;

    const { data } = await axios.get(url, {
      headers: {
        ...BSE_HEADERS,
        "Referer": "https://www.bseindia.com/corporates/ann.html",
        "Accept": "application/json, text/plain, */*",
        "Origin": "https://www.bseindia.com",
        "X-Requested-With": "XMLHttpRequest",
        ...(cookie ? { "Cookie": cookie } : {}),
      },
      timeout: 15000,
    });

    if (typeof data === "string" || (Array.isArray(data) && typeof data[0] === "number")) {
      bseCookieCache = null;
      if (attempt < 4) { await sleep(12000); return fetchBSEFilings(bseCode, stockName, attempt + 1); }
      return [];
    }

    return (data?.Table || []).slice(0, 5).map((item) => ({
      subject:  item.NEWSSUB  || item.HEADLINE || "",
      category: item.SUBCATNAME || item.CATEGORYNAME || "",
      date:     item.DT_TM ? item.DT_TM.replace("T", " ").substring(0, 16) : "",
      link: item.ATTACHMENTNAME
        ? `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${item.ATTACHMENTNAME}`
        : `https://www.bseindia.com/corporates/ann.html?scrip=${code}`,
    }));
  } catch (err) {
    console.log(`  BSE error for ${stockName} (attempt ${attempt}): ${err.message}`);
    if (attempt < 4) { bseCookieCache = null; await sleep(12000); return fetchBSEFilings(bseCode, stockName, attempt + 1); }
    return [];
  }
}

// ── Economic Times RSS ────────────────────────────────────────────────────────
async function fetchETNews(stockName, ticker) {
  try {
    const cleanTicker = ticker.replace(/\.(NS|BO)$/i, "").toLowerCase();
    const nameWords = stockName.toLowerCase().split(/\s+/).filter(w => w.length >= 4);
    const searchTerms = [...new Set([cleanTicker, ...nameWords])];

    const feed = await rssParser.parseURL(
      "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms"
    );

    const cutoff = Date.now() - 10 * 24 * 60 * 60 * 1000;

    return (feed.items || [])
      .filter(item => {
        const title   = (item.title || "").toLowerCase();
        const content = (item.contentSnippet || "").toLowerCase();
        if (!searchTerms.some(term => title.includes(term) || content.includes(term))) return false;
        if (item.pubDate && new Date(item.pubDate).getTime() < cutoff) return false;
        return true;
      })
      .slice(0, 3)
      .map(item => ({
        headline: item.title || "",
        date: item.pubDate ? new Date(item.pubDate).toISOString().replace("T", " ").substring(0, 16) : "",
        link: item.link || "",
      }));
  } catch (err) {
    console.log(`  ET news error: ${err.message}`);
    return [];
  }
}

// ── Google News RSS ───────────────────────────────────────────────────────────
async function fetchGoogleNews(stockName, ticker) {
  try {
    const query = encodeURIComponent(`${stockName} NSE stock`);
    const feed  = await rssParser.parseURL(
      `https://news.google.com/rss/search?q=${query}&hl=en-IN&gl=IN&ceid=IN:en`
    );

    const cutoff      = Date.now() - 10 * 24 * 60 * 60 * 1000;
    const cleanTicker = ticker.replace(/\.(NS|BO)$/i, "").toLowerCase();
    const nameWords   = stockName.toLowerCase().split(/\s+/).filter(w => w.length >= 4);
    const searchTerms = [...new Set([cleanTicker, ...nameWords])];

    return (feed.items || [])
      .filter(item => {
        const title = (item.title || "").toLowerCase();
        if (!searchTerms.some(term => title.includes(term))) return false;
        if (item.pubDate && new Date(item.pubDate).getTime() < cutoff) return false;
        return true;
      })
      .slice(0, 3)
      .map(item => ({
        headline: item.title || "",
        date: item.pubDate ? new Date(item.pubDate).toISOString().replace("T", " ").substring(0, 16) : "",
        link: item.link || "",
      }));
  } catch (err) {
    console.log(`  Google News error: ${err.message}`);
    return [];
  }
}

// ── Format headlines text ──────────────────────────────────────────────────────
function formatHeadlines(filings, etNews, googleNews) {
  const sections = [];
  if (filings.length > 0) {
    const lines = ["━━ BSE CORPORATE FILINGS ━━"];
    filings.forEach((f, i) => {
      lines.push(`\n[${i + 1}] ${f.category}\n📅 ${f.date}\n📌 ${f.subject}\n🔗 ${f.link}\n`);
    });
    sections.push(lines.join("\n"));
  }
  if (etNews.length > 0) {
    const lines = ["━━ ECONOMIC TIMES ━━"];
    etNews.forEach((n, i) => {
      lines.push(`\n[${i + 1}] 📅 ${n.date}\n📌 ${n.headline}\n🔗 ${n.link}\n`);
    });
    sections.push(lines.join("\n"));
  }
  if (googleNews && googleNews.length > 0) {
    const lines = ["━━ GOOGLE NEWS ━━"];
    googleNews.forEach((n, i) => {
      lines.push(`\n[${i + 1}] 📅 ${n.date}\n📌 ${n.headline}\n🔗 ${n.link}\n`);
    });
    sections.push(lines.join("\n"));
  }
  return sections.join("\n");
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("Starting News Agent V2...\n");

  // Fetch news for all tracked stocks — watchlist + portfolio
  const [{ data: watchlisted }, { data: portfolio }] = await Promise.all([
    supabase.from("user_stocks").select("stock_id"),
    supabase.from("portfolio_holdings").select("stock_id"),
  ]);
  const trackedIds = [...new Set([
    ...(watchlisted ?? []).map(r => r.stock_id),
    ...(portfolio  ?? []).map(r => r.stock_id),
  ])];
  if (trackedIds.length === 0) { console.log("No tracked stocks found."); return; }
  const watchlistIds = trackedIds; // reuse variable name for rest of function

  const { data: stocks, error } = await supabase
    .from("stocks")
    .select("id, ticker, stock_name, bse_code")
    .in("id", watchlistIds)
    .order("ticker");

  if (error) { console.error("DB error:", error.message); process.exit(1); }
  console.log(`Processing ${stocks.length} tracked stocks (watchlist + portfolio)...\n`);

  for (let i = 0; i < stocks.length; i++) {
    const { id, ticker, stock_name, bse_code } = stocks[i];
    if (!ticker) { console.log(`SKIP — no ticker`); continue; }

    console.log(`[${i + 1}/${stocks.length}] ${stock_name} (BSE: ${bse_code || "—"})`);

    if (i >= 15) await sleep(8000);
    else if (i >= 10) await sleep(4000);

    const [filings, etNews, googleNews] = await Promise.all([
      bse_code ? fetchBSEFilings(bse_code, stock_name) : Promise.resolve([]),
      fetchETNews(stock_name, ticker),
      fetchGoogleNews(stock_name, ticker),
    ]);

    console.log(`  BSE filings: ${filings.length} | ET news: ${etNews.length} | Google: ${googleNews.length}`);

    const headlines = formatHeadlines(filings, etNews, googleNews);
    const today = new Date().toISOString().split("T")[0];

    const { error: updateError } = await supabase
      .from("stocks")
      .update({ latest_headlines: headlines, last_news_update: today })
      .eq("id", id);

    if (updateError) console.log(`  ✗ DB update failed: ${updateError.message}`);
    else console.log(`  ✓ Saved\n`);

    await sleep(6000);
  }

  console.log("────────────────────────────────");
  console.log("News Agent V2 complete.");
}

main().catch(e => { console.error(e); process.exit(1); });
