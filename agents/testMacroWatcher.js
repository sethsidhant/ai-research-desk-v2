// testMacroWatcher.js — tests all macro feed candidates
// node testMacroWatcher.js

const RSSParser = require('rss-parser');
const parser = new RSSParser({ timeout: 12000, headers: { 'User-Agent': 'Mozilla/5.0' } });

const RSS_URLS = [
  // Trump Telegram via various RSSHub instances
  { label: 'Trump — rsshub.app',          url: 'https://rsshub.app/telegram/channel/trump_ts_posts' },
  { label: 'Trump — rsshub.ktachibana',   url: 'https://rsshub.ktachibana.party/telegram/channel/trump_ts_posts' },
  { label: 'Trump — rss.fatpandaclub',    url: 'https://rss.fatpandaclub.com/telegram/channel/trump_ts_posts' },
  { label: 'Trump — hub.slarker.me',      url: 'https://hub.slarker.me/telegram/channel/trump_ts_posts' },

  // MoneyControl — try different endpoints
  { label: 'MC — marketsnews',            url: 'https://www.moneycontrol.com/rss/marketsnews.xml' },
  { label: 'MC — economy',               url: 'https://www.moneycontrol.com/rss/economy.xml' },
  { label: 'MC — business',              url: 'https://www.moneycontrol.com/rss/business.xml' },

  // Fallbacks — proven financial RSS sources
  { label: 'ET Markets (proven)',         url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms' },
  { label: 'Reuters Business',           url: 'https://feeds.reuters.com/reuters/businessNews' },
  { label: 'Reuters Markets',            url: 'https://www.reutersagency.com/feed/?best-topics=business-finance&post_type=best' },
];

async function testRSS({ label, url }) {
  process.stdout.write(`${label}: `);
  try {
    const feed = await parser.parseURL(url);
    const latest = feed.items?.[0];
    console.log(`✓ ${feed.items?.length ?? 0} items — "${(latest?.title ?? '').slice(0, 60)}"`);
  } catch (e) {
    console.log(`✗ ${e.message.split('\n')[0]}`);
  }
}

async function testTmeDirect() {
  console.log('\n── t.me/s/ direct fetch ──');
  for (const channel of ['trump_ts_posts', 'moneycontrolcom']) {
    process.stdout.write(`t.me/s/${channel}: `);
    try {
      const res = await fetch(`https://t.me/s/${channel}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Dest': 'document',
        },
        signal: AbortSignal.timeout(12000),
      });
      const html = await res.text();
      const postCount = (html.match(/data-post="/g) || []).length;
      const hasContent = html.includes('tgme_widget_message_text');
      console.log(`HTTP ${res.status} — ${html.length} chars — ${postCount} data-post attrs — text divs: ${hasContent}`);
    } catch (e) {
      console.log(`✗ ${e.message}`);
    }
  }
}

(async () => {
  console.log('── RSS feeds ──');
  for (const feed of RSS_URLS) {
    await testRSS(feed);
  }
  await testTmeDirect();
  console.log('\nDone.');
})();
