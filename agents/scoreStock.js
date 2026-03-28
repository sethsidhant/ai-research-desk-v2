// scoreStock.js — Deterministic stock scoring (replaces AI scoring in engine/runOneStock/onboardStock)
// Inputs: fundamentals + technicals. Output: { composite_score, classification, suggested_action }
// Free at any scale — no API calls.

/**
 * @param {object} p
 * @param {number|null} p.stock_pe
 * @param {number|null} p.industry_pe
 * @param {number|null} p.roe
 * @param {number|null} p.roce
 * @param {number|null} p.debt_to_equity
 * @param {number|null} p.revenue_growth_3y
 * @param {number|null} p.profit_growth_3y
 * @param {number|null} p.promoter_holding
 * @param {number|null} p.pledged_pct
 * @param {number|null} p.rsi
 * @param {boolean|null} p.above50DMA
 * @param {boolean|null} p.above200DMA
 * @returns {{ composite_score: number, classification: string, suggested_action: string, pe_deviation: number|null }}
 */
function scoreStock({ stock_pe, industry_pe, roe, roce, debt_to_equity,
                      revenue_growth_3y, profit_growth_3y,
                      promoter_holding, pledged_pct,
                      rsi, above50DMA, above200DMA }) {

  let score = 5.0; // neutral baseline

  // ── 1. Valuation — PE deviation vs industry (weight ~25%, ±2.5) ──────────
  let peDeviation = null;
  if (stock_pe != null && industry_pe != null && industry_pe > 0) {
    peDeviation = ((stock_pe - industry_pe) / industry_pe) * 100;
    if      (peDeviation < -30) score += 2.5;
    else if (peDeviation < -15) score += 1.5;
    else if (peDeviation <  -5) score += 0.5;
    else if (peDeviation <  15) score += 0;    // fairly valued band
    else if (peDeviation <  30) score -= 0.75;
    else if (peDeviation <  60) score -= 1.5;
    else                        score -= 2.5;
  }

  // ── 2. Quality — ROE + ROCE (weight ~25%, ±2.5) ──────────────────────────
  let qualityPts = 0;
  if (roe != null) {
    if      (roe >= 25) qualityPts += 1.25;
    else if (roe >= 15) qualityPts += 0.75;
    else if (roe >= 10) qualityPts += 0.25;
    else if (roe >=  0) qualityPts -= 0.25;
    else                qualityPts -= 1.0;
  }
  if (roce != null) {
    if      (roce >= 25) qualityPts += 1.25;
    else if (roce >= 15) qualityPts += 0.75;
    else if (roce >= 10) qualityPts += 0.25;
    else if (roce >=  0) qualityPts -= 0.25;
    else                 qualityPts -= 1.0;
  }
  score += Math.max(-2.5, Math.min(2.5, qualityPts));

  // ── 3. Leverage — D/E ratio (weight ~10%, ±1.0) ──────────────────────────
  if (debt_to_equity != null) {
    if      (debt_to_equity === 0)   score += 1.0;
    else if (debt_to_equity <  0.5)  score += 0.5;
    else if (debt_to_equity <  1.0)  score += 0;
    else if (debt_to_equity <  2.0)  score -= 0.5;
    else                             score -= 1.0;
  }

  // ── 4. Growth — 3Y revenue + profit CAGR (weight ~20%, ±2.0) ────────────
  let growthPts = 0;
  if (revenue_growth_3y != null) {
    if      (revenue_growth_3y >= 20) growthPts += 1.0;
    else if (revenue_growth_3y >= 10) growthPts += 0.5;
    else if (revenue_growth_3y >=  0) growthPts += 0;
    else                              growthPts -= 0.5;
  }
  if (profit_growth_3y != null) {
    if      (profit_growth_3y >= 25) growthPts += 1.0;
    else if (profit_growth_3y >= 15) growthPts += 0.5;
    else if (profit_growth_3y >=  0) growthPts += 0;
    else                             growthPts -= 0.5;
  }
  score += Math.max(-2.0, Math.min(2.0, growthPts));

  // ── 5. Technicals — RSI + DMA positioning (weight ~15%, ±1.5) ───────────
  let techPts = 0;
  if (rsi != null) {
    if      (rsi < 30) techPts += 0.5;   // oversold — contrarian buy signal
    else if (rsi < 45) techPts += 0.25;
    else if (rsi < 65) techPts += 0;
    else if (rsi < 75) techPts -= 0.25;
    else               techPts -= 0.5;   // overbought
  }
  if (above50DMA  === true)  techPts += 0.5;
  else if (above50DMA  === false) techPts -= 0.25;
  if (above200DMA === true)  techPts += 0.5;
  else if (above200DMA === false) techPts -= 0.25;
  score += Math.max(-1.5, Math.min(1.5, techPts));

  // ── 6. Governance — pledged penalty / promoter confidence (±0.5) ─────────
  if (pledged_pct != null && pledged_pct > 25)           score -= 0.5;
  if (promoter_holding != null && promoter_holding >= 50) score += 0.25;

  // ── Clamp + round to 1 decimal ──────────────────────────────────────────
  score = Math.max(1.0, Math.min(10.0, Math.round(score * 10) / 10));

  // ── Classification ───────────────────────────────────────────────────────
  let classification;
  const isHighQuality = (roe ?? 0) >= 20 && (roce ?? 0) >= 18;
  const isSpeculative = (debt_to_equity ?? 0) > 2.5 || ((pledged_pct ?? 0) > 40);

  if (isSpeculative) {
    classification = 'Speculative';
  } else if (isHighQuality && peDeviation != null && peDeviation < 40) {
    classification = 'High Quality';
  } else if (peDeviation != null) {
    if      (peDeviation < -15) classification = 'Undervalued';
    else if (peDeviation <= 20) classification = 'Fairly Valued';
    else                        classification = 'Overvalued';
  } else if (isHighQuality) {
    classification = 'High Quality';
  } else {
    classification = 'Fairly Valued';
  }

  // ── Suggested action ─────────────────────────────────────────────────────
  let suggested_action;
  if      (score >= 8.5) suggested_action = 'Strong Buy';
  else if (score >= 7.0) suggested_action = 'Buy';
  else if (score >= 5.5) suggested_action = 'Accumulate';
  else if (score >= 4.0) suggested_action = 'Hold';
  else if (score >= 2.5) suggested_action = 'Reduce';
  else                   suggested_action = 'Avoid';

  return { composite_score: score, classification, suggested_action, pe_deviation: peDeviation };
}

module.exports = { scoreStock };
