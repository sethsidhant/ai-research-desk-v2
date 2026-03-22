// fetchMCData.js — Fetches MoneyControl analyst data for a given scId
// Endpoints are public (no auth needed).
// Returns: analyst_rating, analyst_buy/hold/sell_pct, analyst_count,
//          target_mean/high/low, earnings_history (last 8 quarters)

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
};

async function fetchMCData(scId) {
  if (!scId) return null;

  const result = {};

  // 1. Analyst rating
  try {
    const res  = await fetch(
      `https://api.moneycontrol.com/mcapi/v1/stock/estimates/analyst-rating?deviceType=W&scId=${scId}&ex=N`,
      { headers: HEADERS, signal: AbortSignal.timeout(8000) }
    );
    const json = await res.json();
    if (json.success && json.data) {
      const ratings = json.data.ratings ?? [];
      const get = name => {
        const r = ratings.find(r => r.name === name);
        return r ? parseFloat(r.value) : 0;
      };
      result.analyst_rating   = json.data.finalRating ?? null;
      result.analyst_count    = json.data.analystCount ? parseInt(json.data.analystCount) : null;
      result.analyst_buy_pct  = get('Buy') + get('Outperform');
      result.analyst_hold_pct = get('Hold');
      result.analyst_sell_pct = get('Underperform') + get('Sell');
    }
  } catch { /* skip */ }

  // 2. Price forecast (consensus target)
  try {
    const res  = await fetch(
      `https://api.moneycontrol.com/mcapi/v1/stock/estimates/price-forecast?scId=${scId}&ex=N&deviceType=W`,
      { headers: HEADERS, signal: AbortSignal.timeout(8000) }
    );
    const json = await res.json();
    if (json.success && json.data) {
      result.target_mean = json.data.mean ? parseFloat(json.data.mean) : null;
      result.target_high = json.data.high ? parseFloat(json.data.high) : null;
      result.target_low  = json.data.low  ? parseFloat(json.data.low)  : null;
    }
  } catch { /* skip */ }

  // 3. Earnings hits/misses (type only — estimates locked behind subscription)
  try {
    const res  = await fetch(
      `https://api.moneycontrol.com/mcapi/v1/stock/estimates/hits-misses?deviceType=W&scId=${scId}&ex=N&type=eps&financialType=S`,
      { headers: HEADERS, signal: AbortSignal.timeout(8000) }
    );
    const json = await res.json();
    if (json.success && json.data?.list) {
      result.earnings_history = json.data.list.slice(0, 8).map(item => ({
        quarter: item.quarter,
        actual:  item.actual !== '' ? parseFloat(item.actual) : null,
        type:    item.type, // 'positive' (beat) | 'inline' | 'negative' (miss)
      }));
    }
  } catch { /* skip */ }

  return Object.keys(result).length > 0 ? result : null;
}

module.exports = { fetchMCData };
