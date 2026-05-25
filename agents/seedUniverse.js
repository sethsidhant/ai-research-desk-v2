// seedUniverse.js — Bulk-seed all NSE EQ stocks with Screener fundamentals + history.
// No live prices, no technicals, no AI calls — zero Anthropic cost.
//
// When a user adds a seeded stock → onboardStock.js skips steps 1 + 1.5
// (already done) and only fetches news — near-instant onboarding.
//
// Usage (from agents/ dir):
//   node seedUniverse.js              — seed all, skip recently updated
//   node seedUniverse.js --force      — re-seed even if recently updated
//   node seedUniverse.js --limit 20   — seed only first 20 (for testing)
//   node seedUniverse.js --ticker BEL — seed a single stock

require('dotenv').config({ path: '../.env.local' });
const { execFileSync }  = require('child_process');
const { createClient }  = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const args   = process.argv.slice(2);
const FORCE  = args.includes('--force');
const LIMIT  = args.includes('--limit')  ? parseInt(args[args.indexOf('--limit')  + 1]) : null;
const SINGLE = args.includes('--ticker') ? args[args.indexOf('--ticker') + 1].toUpperCase() : null;

const DELAY_MS   = 1500; // 1.5s between stocks — Screener-safe
const STALE_DAYS = 30;   // re-seed if fundamentals older than 30 days

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Kite instruments ──────────────────────────────────────────────────────────

async function getKiteInstruments() {
  const { data: tokenRow } = await supabase
    .from('app_settings').select('value').eq('key', 'kite_access_token').single();
  const token = tokenRow?.value || process.env.KITE_ACCESS_TOKEN;
  if (!token) throw new Error('No Kite token — run refreshKiteToken.js first');

  const res = await fetch('https://api.kite.trade/instruments', {
    headers: {
      'X-Kite-Version': '3',
      'Authorization': `token ${process.env.KITE_API_KEY}:${token}`,
    },
  });
  if (!res.ok) throw new Error(`Kite instruments: HTTP ${res.status}`);

  const csv     = await res.text();
  const lines   = csv.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());

  return lines.slice(1)
    .map(line => {
      const cols = line.split(',');
      const row  = {};
      headers.forEach((h, j) => { row[h] = cols[j]?.trim() ?? ''; });
      return row;
    })
    .filter(r => r.exchange === 'NSE' && r.instrument_type === 'EQ')
    .map(r => ({
      ticker:           r.tradingsymbol,
      instrument_token: parseInt(r.instrument_token) || null,
      stock_name:       r.name || r.tradingsymbol,
    }));
}

// ── Per-stock seeding ─────────────────────────────────────────────────────────

function runPython(script, ticker) {
  return execFileSync('python3', [script, ticker], {
    encoding: 'utf8', cwd: __dirname, timeout: 30000,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
}

async function seedStock({ ticker, instrument_token, stock_name }) {
  // Ensure row exists (no-op if ticker already present)
  await supabase.from('stocks').upsert(
    { ticker, instrument_token, stock_name: stock_name || ticker },
    { onConflict: 'ticker', ignoreDuplicates: true }
  );

  const { data: row } = await supabase
    .from('stocks')
    .select('id, fundamentals_updated_at, earnings_history')
    .eq('ticker', ticker)
    .single();

  if (!row) return { status: 'failed', reason: 'row missing after upsert' };

  const staleThreshold    = new Date(Date.now() - STALE_DAYS * 86400000).toISOString();
  const fundamentalsFresh = !FORCE && !!row.fundamentals_updated_at && row.fundamentals_updated_at > staleThreshold;
  const historyFresh      = !FORCE && !!row.earnings_history;

  if (fundamentalsFresh && historyFresh) return { status: 'skipped' };

  // ── Screener fundamentals ──────────────────────────────────────────────────
  if (!fundamentalsFresh) {
    try {
      const f = JSON.parse(runPython('fetchScreenerFundamentals.py', ticker));

      await supabase.from('stocks').update({
        stock_name:          f.name              || stock_name || ticker,
        stock_pe:            f.pe                ?? null,
        roe:                 f.roe               ?? null,
        roce:                f.roce              ?? null,
        market_cap:          f.market_cap        ?? null,
        industry:            f.industry_hierarchy ?? null,
        current_price:       f.current_price     ?? null,
        high_52w:            f.high_52w          ?? null,
        low_52w:             f.low_52w           ?? null,
        pct_from_52w_high:   f.pct_from_52w_high ?? null,
        pb:                  f.pb                ?? null,
        dividend_yield:      f.dividend_yield    ?? null,
        eps:                 f.eps               ?? null,
        debt_to_equity:      f.debt_to_equity    ?? null,
        promoter_holding:    f.promoter_holding  ?? null,
        fii_holding:         f.fii_holding       ?? null,
        dii_holding:         f.dii_holding       ?? null,
        pledged_pct:         f.pledged_pct       ?? null,
        reserves:            f.reserves          ?? null,
        borrowings:          f.borrowings        ?? null,
        revenue_growth_1y:   f.revenue_growth_1y ?? null,
        revenue_growth_3y:   f.revenue_growth_3y ?? null,
        revenue_growth_5y:   f.revenue_growth_5y ?? null,
        profit_growth_1y:    f.profit_growth_1y  ?? null,
        profit_growth_3y:    f.profit_growth_3y  ?? null,
        profit_growth_5y:    f.profit_growth_5y  ?? null,
        operating_cash_flow: f.operating_cash_flow ?? null,
        free_cash_flow:      f.free_cash_flow      ?? null,
        total_debt:          f.total_debt          ?? null,
        current_ratio:       f.current_ratio       ?? null,
        interest_coverage:   f.interest_coverage   ?? null,
        ...(f.bse_code ? { bse_code: f.bse_code } : {}),
        fundamentals_updated_at: new Date().toISOString(),
      }).eq('id', row.id);

    } catch {
      // ETF, SME, or not on Screener — stamp so listener doesn't loop on this stock
      await supabase.from('stocks')
        .update({ fundamentals_updated_at: new Date().toISOString() })
        .eq('id', row.id);
      return { status: 'no_screener' };
    }
  }

  // ── Screener history ───────────────────────────────────────────────────────
  if (!historyFresh) {
    try {
      const h = JSON.parse(runPython('fetchScreenerHistory.py', ticker));
      await supabase.from('stocks').update({
        earnings_history: {
          quarterly:     h.quarterly     ?? null,
          annual_pl:     h.annual_pl     ?? null,
          balance_sheet: h.balance_sheet ?? null,
          cash_flow:     h.cash_flow     ?? null,
          ratios:        h.ratios        ?? null,
          shareholding:  h.shareholding  ?? null,
        },
      }).eq('id', row.id);
    } catch {
      // History is optional — don't fail the whole stock
    }
  }

  return { status: 'seeded' };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[seedUniverse] ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);
  console.log(`[seedUniverse] force=${FORCE} | limit=${LIMIT ?? 'all'} | ticker=${SINGLE ?? 'all NSE EQ'}\n`);

  let instruments;

  if (SINGLE) {
    instruments = [{ ticker: SINGLE, instrument_token: null, stock_name: SINGLE }];
  } else {
    process.stdout.write('[seedUniverse] Fetching Kite instruments... ');
    try {
      instruments = await getKiteInstruments();
      console.log(`${instruments.length} NSE EQ stocks found\n`);
    } catch (e) {
      console.error(`\n[seedUniverse] Failed: ${e.message}`);
      process.exit(1);
    }
  }

  if (LIMIT) instruments = instruments.slice(0, LIMIT);

  const counts  = { seeded: 0, skipped: 0, no_screener: 0, failed: 0 };
  const startMs = Date.now();

  for (let i = 0; i < instruments.length; i++) {
    const inst   = instruments[i];
    const prefix = `[${String(i + 1).padStart(4)}/${instruments.length}] ${inst.ticker.padEnd(15)}`;

    try {
      const { status, reason } = await seedStock(inst);
      counts[status] = (counts[status] ?? 0) + 1;

      if      (status === 'seeded')      console.log(`${prefix} ✓`);
      else if (status === 'skipped')     process.stdout.write('.');
      else if (status === 'no_screener') console.log(`${prefix} — not on Screener`);
      else                               console.log(`${prefix} ✗ ${reason ?? 'failed'}`);

      if (status !== 'skipped') await sleep(DELAY_MS);
    } catch (e) {
      counts.failed++;
      console.log(`${prefix} ✗ ${e.message}`);
    }
  }

  const elapsed = Math.round((Date.now() - startMs) / 1000);
  console.log(`\n\n[seedUniverse] Done in ${elapsed}s`);
  console.log(`  Seeded: ${counts.seeded} | Skipped: ${counts.skipped} | No Screener: ${counts.no_screener} | Failed: ${counts.failed}`);
}

main().catch(e => { console.error('[seedUniverse]', e.message); process.exit(1); });
