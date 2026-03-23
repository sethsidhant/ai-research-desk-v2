require("dotenv").config({ path: "../.env.local" });
const { KiteConnect } = require("kiteconnect");

const kc = new KiteConnect({ api_key: process.env.KITE_API_KEY });
kc.setAccessToken(process.env.KITE_ACCESS_TOKEN);

// ── RSI — Wilder's smoothed RSI-14 (matches TradingView / Trendlyne) ──────────
function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;

  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  return Math.round(100 - (100 / (1 + avgGain / avgLoss)));
}

// ── Technicals (RSI + DMA) ────────────────────────────────────────────────────
async function getTechnicals(instrumentToken) {
  try {
    const today = new Date();
    const from  = new Date();
    from.setDate(today.getDate() - 300);

    const candles = await kc.getHistoricalData(instrumentToken, "day", from, today);
    if (!candles || candles.length < 200) {
      console.log(`  Not enough candles (${candles?.length ?? 0}) for token ${instrumentToken}`);
      return { currentPrice: 0, sma50: 0, sma200: 0, rsi: null };
    }

    const closes       = candles.map(c => c.close);
    const currentPrice = closes[closes.length - 1];
    const sma50        = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
    const sma200       = closes.slice(-200).reduce((a, b) => a + b, 0) / 200;
    const rsi          = calculateRSI(closes);

    // 52W high/low from last 252 candles (useful for ETFs not on Screener)
    const last252      = candles.slice(-252);
    const high52w      = Math.max(...last252.map(c => c.high));
    const low52w       = Math.min(...last252.map(c => c.low));
    const pctFromHigh  = high52w ? +((currentPrice - high52w) / high52w * 100).toFixed(2) : null;

    return {
      currentPrice,
      sma50,
      sma200,
      rsi,
      dma50Value:   Math.round(sma50  * 100) / 100,
      dma200Value:  Math.round(sma200 * 100) / 100,
      high52w:      Math.round(high52w  * 100) / 100,
      low52w:       Math.round(low52w   * 100) / 100,
      pctFromHigh,
    };
  } catch (err) {
    console.error(`  Technical fetch error for ${instrumentToken}:`, err.message);
    return { currentPrice: 0, sma50: 0, sma200: 0, rsi: null };
  }
}

// ── Benchmark Index Tokens ─────────────────────────────────────────────────────
const NIFTY50_TOKEN  = 256265;
const NIFTY500_TOKEN = 268041;

// ── Returns: 6M and 1Y ────────────────────────────────────────────────────────
async function getReturns(instrumentToken) {
  try {
    const today = new Date();
    const from  = new Date();
    from.setMonth(from.getMonth() - 15); // 15 months ensures 252 trading days

    const candles = await kc.getHistoricalData(instrumentToken, "day", from, today);
    if (!candles || candles.length < 20) return { r6m: null, r1y: null };

    const closes = candles.map(c => c.close);
    const latest = closes[closes.length - 1];

    const pct = (daysAgo) => {
      const idx  = Math.max(0, closes.length - 1 - daysAgo);
      const base = closes[idx];
      return base ? +((latest - base) / base * 100).toFixed(2) : null;
    };

    // Return candles alongside returns so engine can save index history
    const history = candles.map(c => ({
      date:  c.date.toISOString().slice(0, 10),
      close: c.close,
    }));
    return { r6m: pct(126), r1y: pct(252), history };
  } catch (e) {
    console.log(`  getReturns(${instrumentToken}) error: ${e.message}`);
    return { r6m: null, r1y: null, history: [] };
  }
}

function setKiteToken(token) {
  kc.setAccessToken(token);
}

module.exports = { getTechnicals, getReturns, NIFTY50_TOKEN, NIFTY500_TOKEN, setKiteToken };
