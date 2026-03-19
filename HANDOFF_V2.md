# AI Research Desk — V2 Handoff

## V1 Architecture (running, do not touch)
- **Agents**: `C:\Users\SidhantSeth\ai-research-desk\` (Node.js)
- **Dashboard**: `C:\Users\SidhantSeth\ai-dashboard\` (Next.js, Vercel)
- **Data store**: Google Sheets ID `1pm2l2KgSbeXdnc4JdvGXF0RsoammhLy8vZLnU25C304`
- **Sheets**: `Core Universe` (stock fundamentals) + `Daily Scores` (RSI, DMA, PE) + `History` (daily append)
- **Market data**: Kite Connect API (token expires midnight daily — manual refresh in V1)
- **AI**: Claude API `claude-sonnet-4-6` for scoring + summaries
- **WhatsApp**: Twilio sandbox for digest notifications
- **22 stocks** currently tracked

## V1 Daily Pipeline (Mon–Sat 7PM, runs via Task Scheduler)
```
loadInstruments.js     → refresh Kite instruments list
engine.js              → scrape Screener.in fundamentals, calc PE deviation, RSI, DMA, Claude score, append History
newsAgent.js           → fetch BSE filings + ET news per stock
summaryAgent.js        → generate AI research note per stock (skips if no new news)
whatsappNotifier.js    → send RSI + DMA digest to WhatsApp
```

## V1 Data Schema (Google Sheets)

### Core Universe columns
Industry PE, Stock PE, ROE %, ROCE %, Market Cap, Industry Hierarchy,
Industry PE High, Industry PE Low, Latest Headlines, Last News Update,
AI Summary, Summary Date, Current Price, High 52W, Low 52W,
Pct From 52W High, PB, Dividend Yield, EPS, Revenue Growth 1Y,
Revenue Growth 3Y, Revenue Growth 5Y, Profit Growth 1Y, Profit Growth 3Y,
Profit Growth 5Y, Debt to Equity, Promoter Holding, FII Holding, DII Holding,
Revenue 3Y CAGR, Revenue 5Y CAGR, Profit 3Y CAGR, Profit 5Y CAGR,
Operating Cash Flow, Free Cash Flow, Total Debt, Current Ratio,
Fundamentals Updated, Interest Coverage, Pledged %, Reserves, Borrowings

### Daily Scores columns
Stock, PE Deviation %, RSI, RSI Signal, DMA 50 Value, DMA 200 Value,
Composite Score, Classification, Suggested Action,
Stock 6M, Stock 1Y, Nifty50 6M, Nifty50 1Y, Nifty500 6M, Nifty500 1Y, Date

### History columns (30 cols, daily append)
Date, Week, Month, Quarter, Day of Week,
Stock, Ticker, Industry, Closing Price, Open, Day High, Day Low, Volume,
Stock PE, Industry PE, PE Deviation %, PB, Market Cap, Pct From 52W High,
RSI, RSI Signal, DMA 50 Value, DMA 200 Value,
Composite Score, Classification, Suggested Action,
Stock 6M, Stock 1Y, Nifty50 6M, Nifty50 1Y

## V2 Goals
- Multi-user (each user has their own stock watchlist)
- Supabase (Postgres) replaces Google Sheets
- Per-user configurable alerts (RSI thresholds, DMA cross, % from high, new BSE filings)
- WhatsApp alerts per user's preferences
- Stock search autocomplete (Kite instruments list)
- KiteTicker WebSocket for real-time price alerts
- History/charts feature on dashboard using History table data
- PE deviation chart over time per stock

## V2 Tech Stack
- **Backend agents**: Node.js (same pattern as V1, writes to Postgres instead of Sheets)
- **Frontend**: Next.js 15 (new Vercel project)
- **Database**: Supabase (Postgres + Auth + Realtime)
- **Auth**: Supabase Auth (magic link)
- **Market data**: Kite Connect (same API keys)
- **AI**: Claude API claude-sonnet-4-6 (same)
- **WhatsApp**: Twilio (same account, upgrade to proper number later)

## V2 Database Schema

### Core tables
```sql
-- Managed by Supabase Auth
users (id, email, created_at)

-- Master stock list (replaces Core Universe sheet)
stocks (
  id, ticker, stock_name, bse_code,
  instrument_token,  -- Kite token for market data
  industry, industry_pe, industry_pe_high, industry_pe_low,
  -- Fundamentals (updated daily by engine)
  stock_pe, roe, roce, market_cap, pb, eps, dividend_yield,
  debt_to_equity, promoter_holding, fii_holding, dii_holding,
  pledged_pct, reserves, borrowings,
  revenue_growth_1y, revenue_growth_3y, revenue_growth_5y,
  profit_growth_1y, profit_growth_3y, profit_growth_5y,
  operating_cash_flow, free_cash_flow, total_debt,
  current_price, high_52w, low_52w, pct_from_52w_high,
  ai_summary, summary_date, latest_headlines, last_news_update,
  fundamentals_updated_at, created_at, updated_at
)

-- Per-user watchlist
user_stocks (
  id, user_id, stock_id,
  added_at
)

-- Daily scores (replaces Daily Scores sheet, one row per stock per day)
daily_scores (
  id, stock_id, date,
  pe_deviation, rsi, rsi_signal,
  dma_50, dma_200, above_50_dma, above_200_dma,
  composite_score, classification, suggested_action,
  stock_6m, stock_1y, nifty50_6m, nifty50_1y,
  created_at
)

-- History (replaces History sheet)
daily_history (
  id, stock_id, date, week, month, quarter, day_of_week,
  closing_price, open, day_high, day_low, volume,
  stock_pe, industry_pe, pe_deviation, pb, market_cap, pct_from_52w_high,
  rsi, rsi_signal, dma_50, dma_200,
  composite_score, classification, suggested_action,
  stock_6m, stock_1y, nifty50_6m, nifty50_1y,
  created_at
)

-- Per-user alert preferences
user_alert_preferences (
  id, user_id,
  rsi_oversold_threshold DEFAULT 30,
  rsi_overbought_threshold DEFAULT 70,
  dma_cross_alert BOOLEAN DEFAULT true,
  pct_from_high_threshold DEFAULT -20,
  new_filing_alert BOOLEAN DEFAULT true,
  digest_time TIME DEFAULT '19:00',
  whatsapp_number,
  created_at, updated_at
)

-- Dedup log so same alert isn't sent twice
notifications_sent (
  id, user_id, stock_id, alert_type, sent_at
)
```

## V2 Build Order
1. Supabase project setup + schema migration
2. Rewrite engine.js to write to Postgres (keep same scraping logic)
3. Supabase Auth + Next.js frontend with login
4. Per-user stock watchlist UI
5. Stock search autocomplete (Kite instruments)
6. Dashboard reads from Supabase
7. Per-user alert preferences UI
8. WhatsApp notifier reads from Postgres per user
9. KiteTicker for real-time alerts
10. History charts on dashboard

## Environment Variables needed for V2
```
# Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=

# Kite (same as V1)
KITE_API_KEY=
KITE_ACCESS_TOKEN=  # still manual refresh for now

# Anthropic (same)
ANTHROPIC_API_KEY=

# Twilio (same)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=

# Google Sheets (V1 only, not needed in V2)
GOOGLE_SHEET_ID=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
```

## Key constants from V1
- NIFTY50 token: 256265
- NIFTY500 token: 268041
- RSI: Wilder's smoothed 14-period
- Returns: 126 trading days = 6M, 252 = 1Y
- Industry PE: median of companies with mcap > 5000 Cr, positive PE
- Engine runs: ~25 min for 22 stocks, ~$0.35 cost
