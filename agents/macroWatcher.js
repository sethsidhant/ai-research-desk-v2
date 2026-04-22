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
    filterMode: 'strict', // needs filtering: personal posts, sports, entertainment mixed in
    rssUrls: [
      'https://rsshub.ktachibana.party/telegram/channel/real_DonaldJTrump',
      'https://rsshub.app/telegram/channel/real_DonaldJTrump',
      'https://rsshub.ktachibana.party/telegram/channel/trumptruthposts',
      'https://rsshub.ktachibana.party/telegram/channel/trump_ts_posts',
      'https://rsshub.app/telegram/channel/trump_ts_posts',
    ],
  },
  {
    id:         'moneycontrol',
    label:      'MoneyControl',
    emoji:      '📊',
    filterMode: 'loose', // dedicated market channel — pass everything except clearly off-topic
    rssUrls: [
      'https://rsshub.ktachibana.party/telegram/channel/moneycontrolcom',
      'https://rsshub.app/telegram/channel/moneycontrolcom',
    ],
  },
  {
    id:     'et_markets',
    label:  'Markets News',
    emoji:  '📰',
    filterMode: 'strict',
    rssUrls: [
      'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms',
    ],
  },
];

// ── Adaptive polling intervals (IST) ──────────────────────────────────────────
// Market hours   Mon–Fri 09:00–15:30 →  5 min  (fully live)
// Pre-market     Mon–Fri 07:00–09:00 → 10 min  (gap-up/down prep)
// Post-market    Mon–Fri 15:30–21:00 → 15 min  (results, filings)
// Overnight      Mon–Fri 21:00–07:00 → 30 min  (nothing actionable until morning)
// Weekend        Sat–Sun all day     → 60 min  (lands well before Monday open)
function getPollIntervalMs() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day = now.getDay(); // 0=Sun 1=Mon … 5=Fri 6=Sat
  const hm  = now.getHours() * 60 + now.getMinutes();

  if (day === 0 || day === 6)                          return 60 * 60 * 1000; // weekend
  if (hm >= 9 * 60     && hm < 15 * 60 + 30)          return  5 * 60 * 1000; // market hours
  if (hm >= 7 * 60     && hm < 9 * 60)                return 10 * 60 * 1000; // pre-market
  if (hm >= 15 * 60 + 30 && hm < 21 * 60)             return 15 * 60 * 1000; // post-market
  return 30 * 60 * 1000;                                                       // overnight
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// First poll after startup: silence Telegram to absorb backlog from Railway restart.
// All subsequent polls are real-time — send regardless of pubDate (which RSSHub can serve stale).
let isFirstPoll = true;

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

// ── RSS fetch (tries ALL URLs, merges items by GUID) ─────────────────────────
// Critical: we no longer stop at the first successful URL. A post may appear on
// a repost/mirror channel before the official channel's RSS refreshes (RSSHub
// caching). We merge all unique items so no post is missed. First URL wins for
// the same GUID (preserves source priority for watermark tracking).

async function fetchRSS(rssUrls) {
  const allItems = new Map(); // guid → item (first URL wins)
  let anySuccess = false;

  for (const url of rssUrls) {
    try {
      const feed = await rssParser.parseURL(url);
      console.log(`  RSS OK: ${url} (${feed.items?.length ?? 0} items)`);
      anySuccess = true;
      for (const item of (feed.items ?? [])) {
        const guid = item.guid || item.link || item.id;
        if (guid && !allItems.has(guid)) {
          allItems.set(guid, item);
        }
      }
    } catch (e) {
      console.log(`  RSS failed: ${url} — ${e.message}`);
    }
  }

  if (!anySuccess) return null;

  // Sort newest-first after merging across sources
  return [...allItems.values()].sort((a, b) => {
    const ta = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const tb = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return tb - ta;
  });
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
  // Check ALL recent entries (same source included) — multiple trump mirror URLs can carry the
  // same story under different GUIDs, so intra-source dedup is needed too.
  const { data } = await supabase.from('macro_alerts').select('summary').gte('created_at', since);
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
async function filterAndSummarizeBatch(items, label, filterMode = 'strict') {
  // Pre-filter bare URLs
  const eligible = items.map(text => isJustUrl(text) ? null : text);
  const toProcess = eligible.map((text, i) => text ? { i, text } : null).filter(Boolean);

  if (!toProcess.length) return items.map(() => null);

  const postsBlock = toProcess
    .map(({ i, text }) => `[${i}] ${text.slice(0, 800)}`)
    .join('\n\n---\n\n');

  const isLoose = filterMode === 'loose';

  const filterInstruction = isLoose
    ? `This is a dedicated Indian financial markets channel. Pass through EVERYTHING except:
- Pure sports results (cricket scores, match outcomes) with zero market angle
- Celebrity/entertainment news with no market connection
- Personal lifestyle content (food, travel, fashion) with no market connection
- Festival/greeting messages
If there is ANY market, economy, company, sector, policy, or trade angle — include it.`
    : `For each post, decide if it is relevant to: tariffs, trade policy, sanctions, war/geopolitics, oil/energy, interest rates, USD/currency, Fed/RBI, inflation, GDP, jobs data, import/export, trade deficit/surplus, India bilateral deals (US-India, Russia-India, China-India), defence contracts, fighter jets, weapons deals, manufacturing partnerships, India PLI/Make-in-India, commodities, crypto regulation, or any macro topic that moves Indian equity markets.
When in doubt for oil/energy, trade, defence, or geopolitical items — lean toward relevant. India's trade balance data, defence procurement, and bilateral manufacturing deals are always relevant.
Skip only: personal attacks, pure sports/entertainment, domestic politics with no market angle, bare URLs.`;

  const apiPayload = {
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 100 * toProcess.length,
    messages: [{
      role:    'user',
      content: `You are a market intelligence summarizer for Indian equity investors.

${filterInstruction}

Reply with a JSON array only — one entry per post, in the same order:
- If should be skipped: {"skip":true}
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
  };

  let msg;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      msg = await anthropic.messages.create(apiPayload);
      break;
    } catch (e) {
      const isOverloaded = e.status === 529 || (e.error && e.error.type === 'overloaded_error');
      if (isOverloaded && attempt < 3) {
        const delay = attempt * 30000; // 30s, 60s
        console.warn(`[macroWatcher] API overloaded (attempt ${attempt}/3), retrying in ${delay / 1000}s…`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw e;
      }
    }
  }

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
  const { id, label, emoji, rssUrls, filterMode = 'strict' } = source;

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
    const cleaned = raw
      .replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    // Strip leading metadata header only when it looks like a channel/timestamp line
    // (e.g. "📣 Trump Truth Post – Mar 26, 10:29 PM\n\n"). For MC posts the first line
    // IS the article headline — stripping it leaves only "Read More ⤵️ https://..." which
    // Haiku correctly skips. Only strip if what remains is longer than what was removed.
    const afterStrip = cleaned.replace(/^[^\n]+\n\n/, '');
    const text = (afterStrip.trim().length > cleaned.trim().length * 0.4
      ? afterStrip
      : cleaned
    ).replace(/\s+/g, ' ').trim();
    newItems.push({ guid, text, pubDate: item.pubDate, link: item.link ?? null });
  }

  if (!newItems.length) {
    console.log(`[macroWatcher] ${label}: up to date`);
    return;
  }

  console.log(`[macroWatcher] ${label}: ${newItems.length} new item(s)`);

  // Process oldest-first so watermark advances correctly
  const orderedItems = [...newItems].reverse();

  // Filter out blank items and within-batch content duplicates.
  // Content dedup: same post may appear under different GUIDs from different mirror
  // channels. A 120-char text fingerprint catches these within a single poll cycle.
  const seenFingerprints = new Set();
  const toProcess = [];
  for (const item of orderedItems) {
    if (!item.text || item.text.length < 10) {
      await setLastGuid(id, item.guid);
      continue;
    }
    const fp = item.text.slice(0, 120).toLowerCase().replace(/\s+/g, ' ').trim();
    if (seenFingerprints.has(fp)) {
      console.log(`[macroWatcher] ${label}: within-batch content dup skipped`);
      await setLastGuid(id, item.guid);
      continue;
    }
    seenFingerprints.add(fp);
    toProcess.push(item);
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
    results = await filterAndSummarizeBatch(freshItems.map(i => i.text), label, filterMode);
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
        if (isFirstPoll) {
          console.log(`[macroWatcher] ${label}: stored silently (startup catchup)`);
        } else {
          const sentimentEmoji = sentiment === 'bull' ? '🟢' : sentiment === 'bear' ? '🔴' : '⚪';
          const tag  = forward_looking ? ' _(forward outlook)_' : '';
          // Prefer item.link (actual article URL) over item.guid (often a Telegram message URL)
          const articleUrl = item.link?.startsWith('http') ? item.link : item.guid?.startsWith('http') ? item.guid : null;
          const link = articleUrl ? `\n${articleUrl}` : '';
          await sendMacro(`${sentimentEmoji} ${emoji} *Macro · ${label}*${tag}\n${summary}${link}`);
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
  isFirstPoll = false; // all subsequent polls are real-time
}

function start() {
  console.log(`[macroWatcher] Starting — ${SOURCES.length} source(s), adaptive polling enabled`);
  async function scheduledPoll() {
    await poll();
    const nextMs = getPollIntervalMs();
    console.log(`[macroWatcher] Next poll in ${nextMs / 60000}min`);
    setTimeout(scheduledPoll, nextMs);
  }
  scheduledPoll();
}

module.exports = { start };
