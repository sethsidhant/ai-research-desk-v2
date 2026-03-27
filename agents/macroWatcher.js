// macroWatcher.js — monitors public Telegram channels for macro news
// Polls t.me/s/ web preview every 5 minutes — no API credentials needed.
// AI-summarizes new posts with Claude Haiku, stores in macro_alerts table.
//
// Channels:
//   trump_ts_posts — Trump Truth Social mirror
//
// Add more channels to the CHANNELS array below.

require('dotenv').config({ path: '../.env.local' });
const Anthropic       = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const { sendAlert }   = require('./telegramAlert');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CHANNELS = [
  { id: 'trump_ts_posts', label: 'Trump',        emoji: '🇺🇸' },
  { id: 'moneycontrolcom', label: 'MoneyControl', emoji: '📰' },
];

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Persistence ───────────────────────────────────────────────────────────────

async function getLastPostId(channelId) {
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', `macro_watcher_last_${channelId}`)
    .single();
  return data?.value ? parseInt(data.value) : 0;
}

async function setLastPostId(channelId, postId) {
  await supabase.from('app_settings').upsert(
    { key: `macro_watcher_last_${channelId}`, value: String(postId) },
    { onConflict: 'key' }
  );
}

// ── Fetch & Parse ─────────────────────────────────────────────────────────────

async function fetchChannelPage(channelId) {
  const url = `https://t.me/s/${channelId}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept':          'text/html,application/xhtml+xml,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/\s+/g,    ' ')
    .trim();
}

function parseMessages(html) {
  const messages = [];
  // Split HTML at each message container boundary
  const blocks = html.split(/(?=<div[^>]+class="tgme_widget_message\b)/);

  for (const block of blocks) {
    // Post ID (e.g. data-post="trump_ts_posts/12345")
    const postMatch = block.match(/data-post="[^/]+\/(\d+)"/);
    if (!postMatch) continue;
    const postId = parseInt(postMatch[1]);

    // Message text div
    const textMatch = block.match(/class="tgme_widget_message_text(?:\s[^"]*)?">([^]*?)<\/div>/);
    if (!textMatch) continue;
    const text = stripHtml(textMatch[1]);
    if (text.length < 20) continue; // skip very short/media-only messages

    // Timestamp
    const timeMatch = block.match(/datetime="([^"]+)"/);
    const timestamp = timeMatch ? new Date(timeMatch[1]).toISOString() : new Date().toISOString();

    messages.push({ postId, text, timestamp });
  }

  return messages;
}

// ── AI Filter + Summarization ─────────────────────────────────────────────────
// Returns summary string if market-relevant, null if should be skipped.

async function filterAndSummarize(text, label) {
  const msg = await anthropic.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 200,
    messages: [{
      role:    'user',
      content: `You are a market intelligence filter for Indian equity investors.

Evaluate if this ${label} post is relevant to any of: tariffs, trade policy, sanctions, war/geopolitics, oil/energy, interest rates, USD/currency, Fed/RBI, inflation, GDP, jobs data, import/export, China/India/US relations, commodities, crypto regulation, or any other macro topic that moves markets.

If NOT relevant (e.g. personal attacks, sports, entertainment, domestic US politics with no market angle, general opinions): reply with exactly: SKIP

If relevant: reply with a 1-2 sentence summary. Be direct and factual. Start with the key fact, not "Trump says" or "The post says".

Post:
${text.slice(0, 1500)}`,
    }],
  });
  const result = msg.content[0].text.trim();
  if (result === 'SKIP' || result.startsWith('SKIP')) return null;
  return result;
}

// ── Per-channel processing ────────────────────────────────────────────────────

async function processChannel(channel) {
  const { id: channelId, label, emoji } = channel;

  let html;
  try {
    html = await fetchChannelPage(channelId);
  } catch (e) {
    console.error(`[macroWatcher] ${label} fetch error: ${e.message}`);
    return;
  }

  const messages = parseMessages(html);
  if (!messages.length) {
    console.log(`[macroWatcher] ${label}: no messages parsed from page`);
    return;
  }

  const lastId      = await getLastPostId(channelId);
  const newMessages = messages
    .filter(m => m.postId > lastId)
    .sort((a, b) => a.postId - b.postId);

  if (!newMessages.length) {
    console.log(`[macroWatcher] ${label}: up to date (last seen post ${lastId})`);
    return;
  }

  console.log(`[macroWatcher] ${label}: ${newMessages.length} new post(s) since ${lastId}`);

  for (const post of newMessages) {
    try {
      const summary = await filterAndSummarize(post.text, label);

      if (!summary) {
        console.log(`[macroWatcher] ${label} #${post.postId}: skipped (not market-relevant)`);
      } else {
        const { error } = await supabase.from('macro_alerts').insert({
          channel:      channelId,
          summary,
          original_len: post.text.length,
          post_id:      `${channelId}/${post.postId}`,
          created_at:   post.timestamp,
        });

        if (error) {
          // UNIQUE violation = already stored (safe to skip)
          if (!error.message.includes('unique') && !error.message.includes('duplicate')) {
            console.error(`[macroWatcher] DB insert error: ${error.message}`);
          }
        } else {
          console.log(`[macroWatcher] ${label} #${post.postId}: ${summary.slice(0, 90)}…`);
          await sendAlert(`${emoji} *Macro · ${label}*\n${summary}`);
        }
      }

      await sleep(1200); // stay under Anthropic rate limits
    } catch (e) {
      console.error(`[macroWatcher] Error on post ${post.postId}: ${e.message}`);
    }
  }

  // Advance the watermark
  const maxId = Math.max(...newMessages.map(m => m.postId));
  await setLastPostId(channelId, maxId);
}

// ── Poll loop ─────────────────────────────────────────────────────────────────

async function poll() {
  for (const channel of CHANNELS) {
    await processChannel(channel);
    await sleep(2000);
  }
}

function start() {
  console.log(`[macroWatcher] Starting — ${CHANNELS.length} channel(s), poll every ${POLL_INTERVAL_MS / 60000} min`);
  poll();
  setInterval(poll, POLL_INTERVAL_MS);
}

module.exports = { start };
