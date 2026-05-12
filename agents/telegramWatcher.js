// telegramWatcher.js — Telegram channel monitoring via MTProto polling (gramjs)
// Polls Trump, MoneyControl, CNBC TV18 every 60s — no RSSHub caching lag.
// Requires a valid session string in Supabase (run telegramAuth.js locally first).

require('dotenv').config({ path: '../.env.local' });

const { TelegramClient } = require('telegram');
const { StringSession }  = require('telegram/sessions');
const { createClient }   = require('@supabase/supabase-js');
const Anthropic          = require('@anthropic-ai/sdk');
const { sendMacro }      = require('./telegramAlert');

const API_ID   = parseInt(process.env.TELEGRAM_API_ID  ?? '0');
const API_HASH = process.env.TELEGRAM_API_HASH ?? '';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Channels to monitor ───────────────────────────────────────────────────────
const CHANNELS = [
  {
    id:         'trump',
    label:      'Trump',
    emoji:      '🇺🇸',
    filterMode: 'strict',
    usernames:  ['real_DonaldJTrump', 'trumptruthposts', 'trump_ts_posts'],
  },
  {
    id:         'moneycontrol',
    label:      'MoneyControl',
    emoji:      '📊',
    filterMode: 'loose',
    usernames:  ['moneycontrolcom'],
  },
  {
    id:         'cnbctv18',
    label:      'CNBC TV18',
    emoji:      '📺',
    filterMode: 'loose',
    usernames:  ['CNBCTV18News'],
  },
];

// ── AI filter ─────────────────────────────────────────────────────────────────

const FII_SECTORS = [
  'Financial Services', 'Information Technology', 'Oil, Gas & Consumable Fuels',
  'Automobile and Auto Components', 'Fast Moving Consumer Goods', 'Capital Goods',
  'Healthcare', 'Consumer Services', 'Metals & Mining', 'Chemicals',
  'Telecommunication', 'Power', 'Realty', 'Construction',
  'Media Entertainment & Publication', 'Textiles', 'Transportation',
];

const REFUSAL_PHRASES = [
  "i don't have the ability", "i cannot access", "i'm unable to access",
  "please paste the", "i don't see the actual content", "no text or substance",
];

async function filterAndSummarize(text, filterMode) {
  const isLoose = filterMode === 'loose';

  const filterInstruction = isLoose
    ? `This is a dedicated Indian financial markets channel. Pass through EVERYTHING except:
- Pure sports results with zero market angle
- Celebrity/entertainment news with no market connection
- Festival/greeting messages
If there is ANY market, economy, company, sector, or policy angle — include it.`
    : `Decide if this is relevant to: tariffs, trade policy, sanctions, war/geopolitics, oil/energy, interest rates, USD/currency, Fed/RBI, inflation, GDP, India bilateral deals, defence contracts, commodities, or any macro topic that moves Indian equity markets.
Skip only: personal attacks, pure sports/entertainment, domestic politics with no market angle, bare URLs.`;

  let msg;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      msg = await anthropic.messages.create({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{
          role:    'user',
          content: `You are a market intelligence summarizer for Indian equity investors.

${filterInstruction}

Reply with JSON only:
- If should be skipped: {"skip":true}
- If relevant: {"summary":"1-2 sentence factual summary","important":true/false,"sentiment":"bull"/"bear"/"neutral","sectors":[],"forward_looking":false}

Rules:
- important=true ONLY for: Fed/RBI rate decision, major tariff/trade action, war escalation, INR crisis, oil shock 5%+.
- sentiment: bull=positive for India markets, bear=negative, neutral=mixed.
- forward_looking=true if preview/outlook article — prefix summary with "[Outlook] ".
- sectors: pick 1-3 from: ${FII_SECTORS.join(', ')}.

Post:
${text.slice(0, 800)}`,
        }],
      });
      break;
    } catch (e) {
      if ((e.status === 529 || e.error?.type === 'overloaded_error') && attempt < 3) {
        await new Promise(r => setTimeout(r, attempt * 30000));
      } else throw e;
    }
  }

  let raw = msg.content[0].text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    const parsed = JSON.parse(raw);
    if (parsed.skip) return null;
    const lower = (parsed.summary || '').toLowerCase();
    if (REFUSAL_PHRASES.some(p => lower.includes(p))) return null;
    const summary   = (parsed.summary || '').trim();
    if (!summary) return null;
    const sectors   = Array.isArray(parsed.sectors) ? parsed.sectors.filter(s => FII_SECTORS.includes(s)) : [];
    const sentiment = ['bull', 'bear', 'neutral'].includes(parsed.sentiment) ? parsed.sentiment : 'neutral';
    return { summary, important: parsed.important === true, sentiment, sectors, forward_looking: parsed.forward_looking === true };
  } catch {
    return null;
  }
}

// ── Cross-source semantic dedup ────────────────────────────────────────────────

function keyWords(text) {
  const stop = new Set(['the','and','for','are','was','were','has','have','had','that','this','with','from','they','will','been','their','said','also','but','not','its','into','more','than','over','about','after','before','other','which','when','what','where','would','could','should']);
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 4 && !stop.has(w));
}

async function isDuplicateStory(summary) {
  const since = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
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

// ── Process a single message ───────────────────────────────────────────────────

async function processMessage(msg, channel) {
  try {
    const text = msg.message?.replace(/\s+/g, ' ').trim();
    if (!text || text.length < 15) return;

    const postId = `${channel.id}_${msg.id}`;

    const { data: existing } = await supabase
      .from('macro_alerts').select('post_id').eq('post_id', postId).single();
    if (existing) return;

    console.log(`[telegramWatcher] ${channel.label}: new — ${text.slice(0, 80)}`);

    const result = await filterAndSummarize(text, channel.filterMode);
    if (!result) {
      console.log(`[telegramWatcher] ${channel.label}: skipped — ${text.slice(0, 60)}`);
      return;
    }

    const { summary, important, sentiment, sectors, forward_looking } = result;

    const isDupe = await isDuplicateStory(summary);
    if (isDupe) {
      console.log(`[telegramWatcher] ${channel.label}: dupe skipped — ${summary.slice(0, 60)}`);
      return;
    }

    const { error } = await supabase.from('macro_alerts').insert({
      channel:          channel.id,
      summary,
      important,
      sentiment,
      affected_sectors: sectors,
      forward_looking:  forward_looking ?? false,
      original_len:     text.length,
      post_id:          postId,
      created_at:       new Date().toISOString(),
    });

    if (error) {
      if (!error.message.includes('unique') && !error.message.includes('duplicate')) {
        console.error(`[telegramWatcher] DB error: ${error.message}`);
      }
      return;
    }

    console.log(`[telegramWatcher] ${channel.label}${important ? ' 🚨' : ''}: ${summary.slice(0, 90)}…`);
    const sentimentEmoji = sentiment === 'bull' ? '🟢' : sentiment === 'bear' ? '🔴' : '⚪';
    const tag = forward_looking ? ' _(forward outlook)_' : '';
    await sendMacro(`${sentimentEmoji} ${channel.emoji} *Macro · ${channel.label}*${tag}\n${summary}`);

  } catch (err) {
    console.error(`[telegramWatcher] processMessage error: ${err.message}`);
  }
}

// ── Poll one channel for new messages (username resolved fresh each cycle) ──────

async function pollChannel(client, channel, lastIdMap, isFirstPoll) {
  // Try each username until one returns messages — no cached entity objects
  let messages = null;
  let resolvedVia = null;
  for (const username of channel.usernames) {
    try {
      const result = await client.getMessages(username, { limit: 10 });
      if (result?.length) { messages = result; resolvedVia = username; break; }
    } catch (e) {
      console.warn(`[telegramWatcher] @${username} (${channel.label}): ${e.message}`);
    }
  }
  if (!messages?.length) return;

  const mapKey   = channel.id;
  const lastKnown = lastIdMap.get(mapKey) ?? 0;
  const newest    = messages[0].id;

  // On first poll, seed watermark and process recent messages not yet in DB
  // Trump: 15 min (high-volume, avoid flooding); financial channels: 2 hours (catch up after outages)
  if (isFirstPoll) {
    lastIdMap.set(mapKey, newest);
    const catchupMs = channel.id === 'trump' ? 15 * 60 * 1000 : 2 * 60 * 60 * 1000;
    const cutoff    = Date.now() - catchupMs;
    const fresh     = messages.filter(m => m.date * 1000 >= cutoff);
    if (fresh.length) {
      console.log(`[telegramWatcher] ${channel.label}: ${fresh.length} startup message(s) to check via @${resolvedVia}`);
      for (const m of fresh.reverse()) await processMessage(m, channel);
    } else {
      console.log(`[telegramWatcher] ${channel.label}: seeded at msg ${newest} via @${resolvedVia}`);
    }
    return;
  }

  if (newest <= lastKnown) return;

  // Process only messages newer than lastKnown, oldest first
  const newMsgs = messages.filter(m => m.id > lastKnown).reverse();
  lastIdMap.set(mapKey, newest);

  for (const m of newMsgs) await processMessage(m, channel);
}

// ── Main ──────────────────────────────────────────────────────────────────────

let _running = false; // guard against concurrent start() calls within same process

async function run() {
  const { data: sessionRow } = await supabase
    .from('app_settings').select('value').eq('key', 'telegram_session').single();
  const sessionString = sessionRow?.value ?? '';

  if (!sessionString) {
    console.log('[telegramWatcher] No session found in Supabase — run telegramAuth.js locally first');
    return;
  }

  // Poll-based MTProto: connect → fetch → disconnect each cycle (~2s alive per minute).
  // Entities resolved fresh each cycle via username string — no stale access hash risk.
  const client = new TelegramClient(new StringSession(sessionString), API_ID, API_HASH, {
    connectionRetries: 3,
    retryDelay:        2000,
  });

  const lastIdMap = new Map();
  let isFirstPoll = true;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  console.log('[telegramWatcher] Polling every 60s (connect-fetch-disconnect, username-based)...');

  while (true) {
    try {
      await client.connect();
      for (const channel of CHANNELS) {
        try {
          await pollChannel(client, channel, lastIdMap, isFirstPoll);
        } catch (e) {
          console.error(`[telegramWatcher] Poll error (${channel.label}): ${e.message}`);
        }
      }
      isFirstPoll = false;
    } catch (e) {
      if (e.message?.includes('AUTH_KEY_DUPLICATED')) {
        console.log('[telegramWatcher] AUTH_KEY_DUPLICATED — waiting 3 min...');
        await sleep(3 * 60 * 1000);
        continue;
      }
      throw e;
    } finally {
      try { await client.disconnect(); } catch {}
    }
    await sleep(60 * 1000);
  }
}

function start() {
  if (!API_ID || !API_HASH) {
    console.log('[telegramWatcher] Skipped — TELEGRAM_API_ID/HASH not configured');
    return;
  }
  if (_running) {
    console.log('[telegramWatcher] Already running — skipping duplicate start');
    return;
  }
  _running = true;
  console.log('[telegramWatcher] Starting MTProto watcher...');
  run()
    .catch(err => {
      const msg     = err.message ?? '';
      const isAuthDup = msg.includes('AUTH_KEY_DUPLICATED');
      console.error(`[telegramWatcher] Fatal: ${msg}`);
      if (isAuthDup) {
        // Old session still alive on Telegram's side — wait 5 min for it to expire
        console.log('[telegramWatcher] AUTH_KEY_DUPLICATED — waiting 5 min for old session to expire...');
      }
      const delay = isAuthDup ? 5 * 60 * 1000 : 30 * 1000;
      setTimeout(() => { _running = false; start(); }, delay);
    });
}

module.exports = { start };
