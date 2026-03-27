// macroWatcher.js — monitors macro news sources via RSS
// Polls every 5 minutes, AI-filters to market-relevant posts only,
// stores AI summaries in macro_alerts table.
//
// Sources:
//   trump_ts_posts — Trump posts via RSSHub (Telegram channel → RSS)
//   moneycontrolcom — MoneyControl markets news via direct RSS
//
// No Telegram API credentials needed.

require('dotenv').config({ path: '../.env.local' });
const Anthropic        = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const RSSParser        = require('rss-parser');
const { sendAlert }    = require('./telegramAlert');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const anthropic  = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const rssParser  = new RSSParser({ timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });

// ── Source definitions ─────────────────────────────────────────────────────────
// rssUrl: the RSS feed to poll
// id:     key used for dedup (post_id prefix) and app_settings watermark
// label:  display name
// emoji:  used in Telegram notifications

const SOURCES = [
  {
    id:     'trump_ts_posts',
    label:  'Trump',
    emoji:  '🇺🇸',
    // Posts Truth Social links (mostly image URLs, some Russian text reposts)
    rssUrls: [
      'https://rsshub.ktachibana.party/telegram/channel/trump_ts_posts',
      'https://rsshub.app/telegram/channel/trump_ts_posts',
    ],
  },
  {
    id:     'trumptruthposts',
    label:  'Trump',
    emoji:  '🇺🇸',
    // English text reposts of Trump's Truth Social posts — full content in RSS
    rssUrls: [
      'https://rsshub.ktachibana.party/telegram/channel/trumptruthposts',
    ],
  },
  {
    id:     'et_markets',
    label:  'Markets News',
    emoji:  '📰',
    // MoneyControl RSS is malformed XML — ET Markets RSS is proven working alternative
    // Filtered to macro-relevant items only via AI
    rssUrls: [
      'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms',
    ],
  },
];

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Persistence (last-seen item GUID/link) ────────────────────────────────────

async function getLastGuid(sourceId) {
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', `macro_watcher_last_${sourceId}`)
    .single();
  return data?.value ?? null;
}

async function setLastGuid(sourceId, guid) {
  await supabase.from('app_settings').upsert(
    { key: `macro_watcher_last_${sourceId}`, value: guid },
    { onConflict: 'key' }
  );
}

// ── RSS fetch (tries each URL until one works) ────────────────────────────────

async function fetchRSS(rssUrls) {
  for (const url of rssUrls) {
    try {
      const feed = await rssParser.parseURL(url);
      console.log(`  RSS OK: ${url} (${feed.items?.length ?? 0} items)`);
      return feed.items ?? [];
    } catch (e) {
      console.log(`  RSS failed: ${url} — ${e.message}`);
    }
  }
  return null; // all failed
}

// ── AI Filter + Summarization ─────────────────────────────────────────────────
// Returns summary string if market-relevant, null if should be skipped.

// Returns true if text is just a bare URL with no real content
function isJustUrl(text) {
  const stripped = text.replace(/[\u{1F000}-\u{1FFFF}]/gu, '').replace(/\s+/g, ' ').trim();
  return /^https?:\/\/\S+$/.test(stripped);
}

const REFUSAL_PHRASES = [
  "i don't have the ability",
  "i cannot access",
  "i'm unable to access",
  "i can't access",
  "i'm not able to access",
  "please paste the",
  "please provide the text",
];

async function filterAndSummarize(text, label) {
  // Pre-filter: skip bare URLs — nothing to summarize
  if (isJustUrl(text)) return null;

  const msg = await anthropic.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 200,
    messages: [{
      role:    'user',
      content: `You are a market intelligence filter for Indian equity investors.

Evaluate if this ${label} post is relevant to any of: tariffs, trade policy, sanctions, war/geopolitics, oil/energy, interest rates, USD/currency, Fed/RBI, inflation, GDP, jobs data, import/export, China/India/US relations, commodities, crypto regulation, or any other macro topic that moves markets.

If NOT relevant (e.g. personal attacks, sports, entertainment, domestic US politics with no market angle, general opinions, or if the post contains only a URL with no text): reply with exactly: SKIP

If relevant: reply with a 1-2 sentence summary IN ENGLISH. Be direct and factual. Start with the key fact, not "Trump says" or "The post says". If the post is in another language, translate and summarize in English.

Post:
${text.slice(0, 1500)}`,
    }],
  });
  let result = msg.content[0].text.trim();
  if (result === 'SKIP' || result.startsWith('SKIP')) return null;

  // Post-filter: detect AI refusals (URL-only posts sometimes slip through pre-filter)
  const lower = result.toLowerCase();
  if (REFUSAL_PHRASES.some(p => lower.includes(p))) return null;

  // Strip relevance prefix the AI sometimes adds ("Relevant.", "RELEVANT", "**RELEVANT**\n")
  result = result.replace(/^\*{0,2}RELEVANT\*{0,2}[\s.:]*\n*/i, '').trim();

  return result || null;
}

// ── Per-source processing ─────────────────────────────────────────────────────

async function processSource(source) {
  const { id, label, emoji, rssUrls } = source;

  const items = await fetchRSS(rssUrls);
  if (!items) {
    console.log(`[macroWatcher] ${label}: all RSS feeds failed`);
    return;
  }
  if (!items.length) {
    console.log(`[macroWatcher] ${label}: RSS feed empty`);
    return;
  }

  const lastGuid = await getLastGuid(id);

  // Items are newest-first in RSS; find new ones
  const newItems = [];
  for (const item of items) {
    const guid = item.guid || item.link || item.id;
    if (guid === lastGuid) break; // hit last seen — stop
    // Prefer full content over title; strip HTML tags
    const raw = item.content || item.contentSnippet || item.title || '';
    const text = raw
      .replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      // strip leading header line (e.g. "📣 Trump Truth Post – Mar 26, 10:29 PM\n\n")
      .replace(/^[^\n]+\n\n/, '')
      .replace(/\s+/g, ' ').trim();
    newItems.push({ guid, text, pubDate: item.pubDate });
  }

  if (!newItems.length) {
    console.log(`[macroWatcher] ${label}: up to date`);
    return;
  }

  console.log(`[macroWatcher] ${label}: ${newItems.length} new item(s)`);

  // Process oldest-first so watermark advances correctly
  for (const item of [...newItems].reverse()) {
    if (!item.text || item.text.length < 10) {
      await setLastGuid(id, item.guid);
      continue;
    }
    try {
      const summary = await filterAndSummarize(item.text, label);

      if (!summary) {
        console.log(`[macroWatcher] ${label}: skipped (not market-relevant) — ${item.text.slice(0, 60)}`);
      } else {
        const { error } = await supabase.from('macro_alerts').insert({
          channel:      id,
          summary,
          original_len: item.text.length,
          post_id:      item.guid,
          created_at:   item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
        });

        if (error) {
          if (!error.message.includes('unique') && !error.message.includes('duplicate')) {
            console.error(`[macroWatcher] DB insert error: ${error.message}`);
          }
        } else {
          console.log(`[macroWatcher] ${label}: ${summary.slice(0, 90)}…`);
          // Only notify for items published within the last 2 hours
          const ageMs = item.pubDate ? Date.now() - new Date(item.pubDate).getTime() : 0;
          if (ageMs < 2 * 60 * 60 * 1000) {
            await sendAlert(`${emoji} *Macro · ${label}*\n${summary}`);
          } else {
            console.log(`[macroWatcher] ${label}: stored silently (item is ${Math.round(ageMs / 60000)}m old)`);
          }
        }
      }

      await setLastGuid(id, item.guid);
      await sleep(1200); // Anthropic rate limit
    } catch (e) {
      console.error(`[macroWatcher] Error processing item: ${e.message}`);
    }
  }
}

// ── Poll loop ─────────────────────────────────────────────────────────────────

async function poll() {
  for (const source of SOURCES) {
    await processSource(source);
    await sleep(2000);
  }
}

function start() {
  console.log(`[macroWatcher] Starting — ${SOURCES.length} source(s), poll every ${POLL_INTERVAL_MS / 60000} min`);
  poll();
  setInterval(poll, POLL_INTERVAL_MS);
}

module.exports = { start };
