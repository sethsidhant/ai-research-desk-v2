// trumpWatcher.js — monitors Trump's Truth Social posts for market-relevant content
require('dotenv').config({ path: '../.env.local' });
const Parser    = require('rss-parser');
const { createClient } = require('@supabase/supabase-js');
const { sendToMany }   = require('./telegramAlert');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const POLL_INTERVAL = 15 * 60 * 1000; // 15 minutes
const RSS_URL = 'https://truthsocial.com/@realDonaldTrump/feed.rss';

// ── Market keyword categories ──────────────────────────────────────────────────
const CATEGORIES = [
  { label: '📦 Tariffs / Trade',    emoji: '📦', terms: ['tariff', 'tariffs', 'import tax', 'trade war', 'trade deal', 'trade deficit', 'customs duty', 'wto', 'free trade'] },
  { label: '🇨🇳 China',            emoji: '🇨🇳', terms: ['china', 'chinese', 'beijing', 'ccp', 'xi jinping', 'huawei', 'tiktok', 'fentanyl', 'made in china'] },
  { label: '🇮🇳 India',            emoji: '🇮🇳', terms: ['india', 'indian', 'modi', 'new delhi'] },
  { label: '⛽ Energy / Oil',       emoji: '⛽', terms: ['oil', 'gas', 'opec', 'lng', 'pipeline', 'drill', 'fossil fuel', 'gasoline', 'energy', 'coal', 'solar', 'wind farm'] },
  { label: '💊 Pharma / Health',    emoji: '💊', terms: ['pharma', 'pharmaceutical', 'drug price', 'fda', 'healthcare', 'medicare', 'medicaid', 'insulin', 'obamacare'] },
  { label: '🏦 Fed / Rates',        emoji: '🏦', terms: ['federal reserve', 'interest rate', 'fed rate', 'inflation', 'jerome powell', 'treasury', 'debt ceiling', 'recession', 'rate cut', 'rate hike'] },
  { label: '💻 Tech / AI',          emoji: '💻', terms: ['semiconductor', 'chip', 'artificial intelligence', ' ai ', 'big tech', 'silicon valley', 'nvidia', 'apple', 'microsoft', 'google', 'amazon', 'meta', 'tiktok'] },
  { label: '🪙 Crypto',             emoji: '🪙', terms: ['crypto', 'bitcoin', 'btc', 'ethereum', 'digital dollar', 'cbdc', 'blockchain'] },
  { label: '🏗️ Infrastructure',    emoji: '🏗️', terms: ['infrastructure', 'steel', 'aluminum', 'construction', 'manufacturing', 'factory', 'reshoring'] },
  { label: '📊 Markets / Economy',  emoji: '📊', terms: ['stock market', 'wall street', 'nasdaq', 'dow jones', 's&p', 'economy', 'gdp', 'jobs report', 'unemployment', 'dollar', 'treasury bond'] },
  { label: '🛡️ Defense',           emoji: '🛡️', terms: ['defense', 'military', 'nato', 'weapons', 'pentagon', 'war', 'sanctions', 'ukraine', 'taiwan'] },
]

// ── State: seen post GUIDs ─────────────────────────────────────────────────────
let seenGuids = new Set()

async function loadSeenGuids() {
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'trump_seen_guids')
    .maybeSingle()
  if (data?.value) {
    try { seenGuids = new Set(JSON.parse(data.value)) } catch {}
  }
}

async function saveSeenGuids() {
  const arr = [...seenGuids].slice(-100) // keep last 100
  await supabase.from('app_settings').upsert(
    { key: 'trump_seen_guids', value: JSON.stringify(arr) },
    { onConflict: 'key' }
  )
}

// ── Keyword detection ──────────────────────────────────────────────────────────
function detectCategories(text) {
  const lower = text.toLowerCase()
  return CATEGORIES.filter(cat =>
    cat.terms.some(term => lower.includes(term))
  )
}

// ── Fetch opted-in users ───────────────────────────────────────────────────────
async function getOptedInChatIds() {
  const { data } = await supabase
    .from('user_alert_preferences')
    .select('telegram_chat_id')
    .eq('trump_alerts', true)
    .not('telegram_chat_id', 'is', null)
  return (data ?? []).map(r => r.telegram_chat_id)
}

// ── Build Telegram message ─────────────────────────────────────────────────────
function buildMessage(item, matchedCategories) {
  const content = (item.contentSnippet || item.content || item.title || '').replace(/<[^>]+>/g, '').trim()
  const preview = content.length > 600 ? content.slice(0, 597) + '...' : content
  const date    = item.pubDate ? new Date(item.pubDate).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''

  const lines = [
    `🇺🇸 *Trump Post — Market Alert*`,
    ``,
    preview,
    ``,
    `⚠️ *Possible market impact:*`,
    ...matchedCategories.map(c => `  • ${c.label}`),
    ``,
  ]
  if (date) lines.push(`🕐 ${date} IST`)
  if (item.link) lines.push(`🔗 ${item.link}`)

  return lines.join('\n')
}

// ── Poll RSS ───────────────────────────────────────────────────────────────────
async function poll() {
  try {
    const parser = new Parser({
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RSS reader)' },
      timeout: 15000,
    })
    const feed = await parser.parseURL(RSS_URL)

    const newItems = (feed.items ?? []).filter(item => {
      const guid = item.guid || item.link || item.title
      return guid && !seenGuids.has(guid)
    })

    if (newItems.length === 0) {
      console.log(`[trumpWatcher] No new posts`)
      return
    }

    console.log(`[trumpWatcher] ${newItems.length} new post(s)`)
    const chatIds = await getOptedInChatIds()

    for (const item of newItems) {
      const guid = item.guid || item.link || item.title
      seenGuids.add(guid)

      const text = [item.title, item.contentSnippet, item.content].filter(Boolean).join(' ')
      const matched = detectCategories(text)

      if (matched.length === 0) {
        console.log(`  · Skipped (no market keywords): ${(item.title || '').slice(0, 60)}`)
        continue
      }

      console.log(`  ✓ Market-relevant: ${matched.map(c => c.emoji).join('')} — ${(item.title || '').slice(0, 60)}`)

      if (chatIds.length > 0) {
        const msg = buildMessage(item, matched)
        await sendToMany(chatIds, msg)
        console.log(`    → Sent to ${chatIds.length} user(s)`)
      } else {
        console.log(`    → No opted-in users`)
      }
    }

    await saveSeenGuids()
  } catch (err) {
    console.error(`[trumpWatcher] Poll error:`, err.message)
  }
}

// ── Start ──────────────────────────────────────────────────────────────────────
async function start() {
  console.log('[trumpWatcher] Starting (poll every 15 min)')
  await loadSeenGuids()
  await poll()
  setInterval(poll, POLL_INTERVAL)
}

module.exports = { start }
