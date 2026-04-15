// macroWatcher.js — monitors macro news sources via RSS
// Polls every 5 minutes, AI-filters to market-relevant posts only,
// stores AI summaries in macro_alerts table.
//
// Sources:
//   trump          — Trump posts via RSSHub (official Telegram → RSS, fallback to repost channels)
//   moneycontrol   — MoneyControl Telegram channel via RSSHub (faster than ET RSS)
//   et_markets     — ET Markets RSS (fallback)
//
// No Telegram API credentials needed.

require('dotenv').config({ path: '../.env.local' });
const Anthropic        = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const RSSParser        = require('rss-parser');
const { sendMacro }    = require('./telegramAlert');

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
    id:     'trump',
    label:  'Trump',
    emoji:  '🇺🇸',
    // Official Telegram first (fastest), then English repost channel, then Truth Social mirror as last resort
    rssUrls: [
      'https://rsshub.ktachibana.party/telegram/channel/real_DonaldJTrump',
      'https://rsshub.app/telegram/channel/real_DonaldJTrump',
      'https://rsshub.ktachibana.party/telegram/channel/trumptruthposts',
      'https://rsshub.ktachibana.party/telegram/channel/trump_ts_posts',
      'https://rsshub.app/telegram/channel/trump_ts_posts',
    ],
  },
  {
    id:     'moneycontrol',
    label:  'MoneyControl',
    emoji:  '📊',
    // Telegram channel → RSSHub. Faster than ET Markets RSS.
    rssUrls: [
      'https://rsshub.ktachibana.party/telegram/channel/moneycontrolcom',
      'https://rsshub.app/telegram/channel/moneycontrolcom',
    ],
  },
  {
    id:     'et_markets',
    label:  'Markets News',
    emoji:  '📰',
    // Fallback: ET Markets RSS (MoneyControl Telegram preferred above)
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
  // Triggered when Trump shares/reposts someone else's post with no text body
  "i don't see the actual content",
  "i don't see the content",
  "you've provided the timestamp",
  "please share the actual content",
  "the text or substance",
  "no text or substance",
  "not the text",
  "what was posted",
];

const FII_SECTORS = [
  'Financial Services', 'Information Technology', 'Oil, Gas & Consumable Fuels',
  'Automobile and Auto Components', 'Fast Moving Consumer Goods', 'Capital Goods',
  'Healthcare', 'Consumer Services', 'Metals & Mining', 'Chemicals',
  'Telecommunication', 'Power', 'Realty', 'Construction',
  'Media Entertainment & Publication', 'Textiles', 'Transportation',
];

// ── Cross-source story dedup ──────────────────────────────────────────────────
// Returns true if a sufficiently similar summary already exists from a different
// channel in the last 30 minutes (prevents MC + ET alerting on the same story).

function keyWords(text) {
  const stop = new Set(['the','and','for','are','was','were','has','have','had','that','this','with','from','they','will','been','their','said','also','but','not','its','into','more','than','over','about','after','before','other','which','when','what','where','would','could','should']);
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 4 && !stop.has(w));
}

async function isDuplicateStory(summary, channelId) {
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data } = await supabase.from('macro_alerts').select('summary').gte('created_at', since).neq('channel', channelId);
  if (!data?.length) return false;
  const newWords = new Set(keyWords(summary));
  if (newWords.size < 3) return false;
  for (const row of data) {
    const existing = keyWords(row.summary);
    const overlap  = existing.filter(w => newWords.has(w)).length;
    if (overlap / Math.min(newWords.size, existing.length || 1) >= 0.5) return true;
  }
  return false;
}

// ── Batch filter + summarize: one API call for all items in a source.
// Returns array of { summary, important, sectors, sentiment, forward_looking } | null, same order as input texts.
async function filterAndSummarizeBatch(items, label) {
  // Pre-filter bare URLs
  const eligible = items.map(text => isJustUrl(text) ? null : text);
  const toProcess = eligible.map((text, i) => text ? { i, text } : null).filter(Boolean);

  if (!toProcess.length) return items.map(() => null);

  const postsBlock = toProcess
    .map(({ i, text }) => `[${i}] ${text.slice(0, 800)}`)
    .join('\n\n---\n\n');

  const msg = await anthropic.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 100 * toProcess.length,
    messages: [{
      role:    'user',
      content: `You are a market intelligence filter for Indian equity investors.

For each numbered ${label} post below, decide if it is relevant to: tariffs, trade policy, sanctions, war/geopolitics, oil/energy, interest rates, USD/currency, Fed/RBI, inflation, GDP, jobs data, import/export, India trade (Russia oil, China goods, US relations), commodities, crypto regulation, or any macro topic that moves Indian equity markets.

When in doubt for oil/energy, trade, or geopolitical items — lean toward relevant.

Reply with a JSON array only — one entry per post, in the same order:
- If NOT relevant (personal attacks, sports, entertainment, domestic politics with no market angle, bare URL): {"skip":true}
- If relevant: {"summary":"1-2 sentence factual summary starting with the key fact","important":true/false,"sentiment":"bull"/"bear"/"neutral","sectors":[],"forward_looking":false}

Rules:
- important=true ONLY for: Fed/RBI rate decision, major tariff/trade action, war escalation, INR crisis, oil shock 5%+, event likely to move Nifty 1%+.
- sentiment: "bull" if net positive for markets/India (rate cuts, trade deal, oil drop, inflows), "bear" if net negative (tariffs, war, rate hike, oil spike, outflows), "neutral" if mixed or unclear.
- forward_looking=true if the post is a preview/outlook/forecast article ("Ahead of Market", "what to watch", "forward outlook", "market may", "expected to", etc.) — these describe what MIGHT happen, not what has happened. Start the summary with "[Outlook] " for these.
- Never state predictions or previews as facts. If the article says "market may fall", write "Market may open lower tomorrow on X" not "market fell on X".
- sectors: pick 1-3 from: ${FII_SECTORS.join(', ')}. Empty [] if unclear.
- Translate non-English posts to English.

Posts:
${postsBlock}`,
    }],
  });

  let raw = msg.content[0].text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('not array');
  } catch {
    return items.map(() => null);
  }

  // Map results back to original indices
  const results = items.map(() => null);
  toProcess.forEach(({ i }, batchIdx) => {
    const entry = parsed[batchIdx];
    if (!entry || entry.skip) return;
    const lower = (entry.summary || '').toLowerCase();
    if (REFUSAL_PHRASES.some(p => lower.includes(p))) return;
    const summary = (entry.summary || '').replace(/^\*{0,2}RELEVANT\*{0,2}[\s.:]*\n*/i, '').trim();
    if (!summary) return;
    const sectors   = Array.isArray(entry.sectors) ? entry.sectors.filter(s => FII_SECTORS.includes(s)) : [];
    const sentiment = ['bull', 'bear', 'neutral'].includes(entry.sentiment) ? entry.sentiment : 'neutral';
    results[i] = { summary, important: entry.important === true, sentiment, sectors, forward_looking: entry.forward_looking === true };
  });

  return results;
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
  const orderedItems = [...newItems].reverse();

  // Filter out blank items upfront; advance watermark for them immediately
  const toProcess = [];
  for (const item of orderedItems) {
    if (!item.text || item.text.length < 10) {
      await setLastGuid(id, item.guid);
    } else {
      toProcess.push(item);
    }
  }

  if (!toProcess.length) return;

  // Dedup: skip items whose post_id already exists in macro_alerts (avoids paying for re-processed items)
  const guids = toProcess.map(i => i.guid).filter(Boolean);
  const { data: existing } = guids.length
    ? await supabase.from('macro_alerts').select('post_id').in('post_id', guids)
    : { data: [] };
  const existingSet = new Set((existing ?? []).map(r => r.post_id));
  const alreadySeen = toProcess.filter(item => existingSet.has(item.guid));
  const freshItems  = toProcess.filter(item => !existingSet.has(item.guid));

  // Advance watermark for already-seen items without calling Haiku
  for (const item of alreadySeen) {
    await setLastGuid(id, item.guid);
  }

  if (!freshItems.length) {
    console.log(`[macroWatcher] ${label}: all new items already in DB — skipped Haiku call`);
    return;
  }

  if (alreadySeen.length) {
    console.log(`[macroWatcher] ${label}: deduped ${alreadySeen.length} already-stored item(s)`);
  }

  // Single API call for all items in this source
  let results;
  try {
    results = await filterAndSummarizeBatch(freshItems.map(i => i.text), label);
  } catch (e) {
    console.error(`[macroWatcher] Batch API error: ${e.message}`);
    return;
  }

  for (let idx = 0; idx < freshItems.length; idx++) {
    const item   = freshItems[idx];
    const result = results[idx];

    if (!result) {
      console.log(`[macroWatcher] ${label}: skipped — ${item.text.slice(0, 60)}`);
    } else {
      const { summary, important, sentiment, sectors, forward_looking } = result;

      // Cross-source dedup: skip if another channel already reported this story in last 30 min
      const isDupe = await isDuplicateStory(summary, id);
      if (isDupe) {
        console.log(`[macroWatcher] ${label}: cross-source dupe skipped — ${summary.slice(0, 60)}`);
        await setLastGuid(id, item.guid);
        continue;
      }

      const { error } = await supabase.from('macro_alerts').insert({
        channel:          id,
        summary,
        important,
        sentiment,
        affected_sectors: sectors,
        forward_looking:  forward_looking ?? false,
        original_len:     item.text.length,
        post_id:          item.guid,
        created_at:       new Date().toISOString(),
      });

      if (error) {
        if (!error.message.includes('unique') && !error.message.includes('duplicate')) {
          console.error(`[macroWatcher] DB insert error: ${error.message}`);
        }
      } else {
        console.log(`[macroWatcher] ${label}${important ? ' 🚨' : ''}: ${summary.slice(0, 90)}…`);
        const ageMs = item.pubDate ? Date.now() - new Date(item.pubDate).getTime() : 0;
        if (ageMs < 2 * 60 * 60 * 1000) {
          const sentimentEmoji = sentiment === 'bull' ? '🟢' : sentiment === 'bear' ? '🔴' : '⚪';
          const tag  = forward_looking ? ' _(forward outlook)_' : '';
          const link = item.guid?.startsWith('http') ? `\n${item.guid}` : '';
          await sendMacro(`${sentimentEmoji} ${emoji} *Macro · ${label}*${tag}\n${summary}${link}`);
        } else {
          console.log(`[macroWatcher] ${label}: stored silently (item is ${Math.round(ageMs / 60000)}m old)`);
        }
      }
    }

    await setLastGuid(id, item.guid);
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
  console.log(`[macroWatcher] Starting — ${SOURCES.length} source(s), poll every ${POLL_INTERVAL_MS / 60000} min, dedup enabled`);
  poll();
  setInterval(poll, POLL_INTERVAL_MS);
}

module.exports = { start };
