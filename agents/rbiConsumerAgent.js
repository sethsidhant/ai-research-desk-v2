// rbiConsumerAgent.js — Fetches RBI Urban Consumer Confidence Survey (bi-monthly)
// Run: node rbiConsumerAgent.js          -> latest round only
// Run: node rbiConsumerAgent.js backfill -> all available rounds

require('dotenv').config({ path: '../.env.local' });

const https = require('https');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const BACKFILL = process.argv[2] === 'backfill';

const MONTHS = {
  january:0, february:1, march:2, april:3, may:4, june:5,
  july:6, august:7, september:8, october:9, november:10, december:11,
};

// -- HTTP helper ---------------------------------------------------------------

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 20000 }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// -- Fetch list of publication IDs --------------------------------------------
// Scrapes the RBI bi-monthly CCS listing page, returns array of { id, pubDate }

async function fetchEntries() {
  const html = await get(
    'https://www.rbi.org.in/Scripts/BimonthlyPublications.aspx?' +
    'head=Urban+Consumer+Confidence+Survey+-+Bi-monthly'
  );

  // Each entry: <td class="tableheader" ...><b>Apr 08, 2026<b></td>
  //             <a href=PublicationsView.aspx?id=23807>Urban Consumer Confidence Survey</a>
  const entries = [];
  // RBI uses malformed <b>Date<b> (no closing slash) — match both variants
  const re = /<b>([A-Za-z]+\s+\d{1,2},\s+\d{4})<\/?b>[\s\S]*?href=PublicationsView\.aspx\?id=(\d+)/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    entries.push({ pubDate: m[1].trim(), id: m[2] });
  }

  console.log(`[rbiConsumerAgent] Found ${entries.length} CCS entries`);
  return BACKFILL ? entries : entries.slice(0, 2);
}

// -- Parse a single CCS publication page --------------------------------------

function parsePage(html) {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  // Survey reference month: "results of March 2026 round" or "January 2026 round"
  const surveyMatch = text.match(/results\s+of\s+([A-Za-z]+)\s+(\d{4})\s+round/i) ||
                      text.match(/([A-Za-z]+)\s+(\d{4})\s+round\s+of\s+its/i);
  if (!surveyMatch) return null;

  const mon = MONTHS[surveyMatch[1].toLowerCase()];
  const yr  = parseInt(surveyMatch[2]);
  if (mon === undefined || yr < 2018) return null;
  const date = new Date(Date.UTC(yr, mon, 1)).toISOString().slice(0, 10);

  // Round number
  const roundMatch = text.match(/Round\s*[:#]?\s*(\d+)/i) ||
                     text.match(/(\d+)(?:th|st|nd|rd)\s+round/i);
  const round_no = roundMatch ? parseInt(roundMatch[1]) : null;

  // CSI: "Current Situation Index (CSI)... at 95.7"
  const csiMatch = text.match(/Current\s+Situation\s+Index\s*\(CSI\)[^.]*?(?:at|stood\s+at|was)\s+([\d.]+)/i) ||
                   text.match(/CSI\)[^.]*?(?:at|to|of)\s+([\d.]+)/i);

  // FEI: "Future Expectations Index (FEI) dropped... to 120.2"
  const feiMatch = text.match(/Future\s+Expectations\s+Index\s*\(FEI\)[^.]*?(?:to|at|stood\s+at|was)\s+([\d.]+)/i) ||
                   text.match(/FEI\)[^.]*?(?:at|to|of)\s+([\d.]+)/i);

  const csi = csiMatch ? parseFloat(csiMatch[1]) : null;
  const fei = feiMatch ? parseFloat(feiMatch[1]) : null;

  if (!csi || !fei) return null;

  return { date, round_no, csi, fei };
}

// -- Main ----------------------------------------------------------------------

async function main() {
  console.log(`[rbiConsumerAgent] Starting${BACKFILL ? ' (backfill)' : ''}...`);

  const entries = await fetchEntries();
  if (entries.length === 0) {
    console.log('[rbiConsumerAgent] No entries found.');
    return;
  }

  let inserted = 0;
  for (const entry of entries) {
    try {
      const html = await get(`https://www.rbi.org.in/Scripts/PublicationsView.aspx?id=${entry.id}`);
      const data = parsePage(html);

      if (!data) {
        console.log(`[rbiConsumerAgent] id=${entry.id} (${entry.pubDate}): parse failed`);
        if (process.env.DEBUG) {
          const text = html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
          console.log('TEXT SAMPLE:', text.slice(28000, 31000));
        }
        continue;
      }

      const { data: existing } = await supabase
        .from('rbi_consumer_confidence').select('date').eq('date', data.date).single();
      if (existing) {
        console.log(`[rbiConsumerAgent] ${data.date}: already stored -- skipping`);
        continue;
      }

      const { error } = await supabase
        .from('rbi_consumer_confidence')
        .insert({ ...data, created_at: new Date().toISOString() });

      if (error) {
        console.error(`[rbiConsumerAgent] DB ${data.date}: ${error.message}`);
        continue;
      }

      console.log(`[rbiConsumerAgent] ${data.date} Rd ${data.round_no ?? '?'}: CSI=${data.csi} FEI=${data.fei} -- inserted`);
      inserted++;

      if (BACKFILL) await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.error(`[rbiConsumerAgent] id=${entry.id}: ${e.message}`);
    }
  }

  console.log(`[rbiConsumerAgent] Done -- ${inserted} rows inserted`);
}

main().catch(e => { console.error('[rbiConsumerAgent]', e.message); process.exit(1); });
