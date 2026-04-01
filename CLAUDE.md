# Noesis — Codebase Guide for Claude

**App name:** Noesis ("Know before you trade.")
**Repo:** ai-research-desk-v2
**V1** (`ai-research-desk\`) is live production — never touch it.

---

## Infrastructure at a Glance

| Layer | Platform | What runs there |
|-------|----------|-----------------|
| Frontend | Vercel | Next.js 15 app (auto-deploys on git push to master) |
| Agents | Railway | All long-running watchers (listener, stockWatcher, macroWatcher, indexWatcher, technicalWatcher) |
| Pipelines | GitHub Actions | Daily batch jobs (engine, fiiAgent, newsAgent, digest, token refresh) |
| Database | Supabase Postgres | Single source of truth for all data |
| Scheduling | cron-job.org | Fires `workflow_dispatch` on GitHub Actions — NOT native GH cron |

**NEVER suggest pm2 commands. User does not use pm2. Everything persistent runs on Railway.**

---

## "User stocks" = both tables

Whenever the user says "my stocks", "user stocks", "watchlist", "portfolio stocks" — always query **both**:
- `user_stocks` — watchlist entries
- `portfolio_holdings` — actual portfolio holdings with quantity/avg_price

Join to `stocks` via `id` (UUID), not `ticker`. Both tables use `stock_id` as a UUID FK.

---

## Database Tables

### Core (always relevant)

| Table | Purpose | Key writers |
|-------|---------|-------------|
| `stocks` | Master stock list. All fundamentals, current_price, mc_scid, analyst data | engine.js, onboardStock.js, stockWatcher (current_price flush) |
| `user_stocks` | Watchlist: user ↔ stock. Has entry_price, nifty50_entry, invested_amount | Frontend actions |
| `portfolio_holdings` | Portfolio: quantity, avg_price, broker, investment_date | /api/portfolio/* |
| `daily_scores` | One row per stock per day. RSI, DMA, composite_score, classification | engine.js, stockWatcher (RSI flush every 5 min intraday) |
| `daily_history` | Append-only OHLCV per stock per day | backfillHistory.js, stockWatcher (volume flush every 5 min intraday) |
| `index_history` | Nifty50 + Nifty500 daily closes | backfillHistory.js, engine.js |
| `app_settings` | Key-value config store: kite_access_token, cron_pipeline_last_run, macro watermarks | Many agents |
| `user_alert_preferences` | Per-user RSI thresholds, DMA alerts, telegram_chat_id | Settings page |
| `notifications_sent` | Dedup log — prevents duplicate alerts | technicalWatcher, stockWatcher |

### Market data

| Table | Purpose | Writer |
|-------|---------|--------|
| `fii_flow` | FII cumulative net flow by date | fiiAgent.js (Screener) |
| `fii_dii_daily` | Daily FII + DII buy/sell/net | fiiAgent.js (NSE) |
| `fii_sector` | Sector-wise FII AUM + sparklines | fiiAgent.js (Screener HTML) |
| `mf_sebi_daily` | MF equity/debt net inflows by date | mfSebiAgent.js (SEBI) |
| `macro_alerts` | Macro news items (Trump, ET Markets) filtered by AI | macroWatcher.js |

---

## Agents (agents/)

### Daily pipeline — GitHub Actions (daily-pipeline.yml)
Runs weekdays, skips NSE holidays (hardcoded list in yml). Triggered by cron-job.org.

1. `backfillHistory.js` — Kite historical API → daily_history (OHLCV). Always fetches min 35 days back.
2. `engine.js` — Kite live prices + technicals → stocks, daily_scores, daily_history. Calls `fetchMCData.js` for analyst data.
3. `fiiAgent.js` — Screener + NSE + SEBI → fii_flow, fii_dii_daily, fii_sector, mf_sebi_daily.
4. `newsAgent.js` — BSE filings + ET Markets RSS → stocks.latest_headlines.
5. `mfSebiAgent.js` — redundant with fiiAgent for MF data.

### Long-running on Railway (index.js starts all)
- `listener.js` — polls for stocks needing onboarding, spawns `onboardStock.js TICKER`. Also polls Telegram bot for /link commands.
- `stockWatcher.js` — polls Kite quotes every 60s during market hours. Sends ±5% price alerts. **Flushes live volume → daily_history and live RSI → daily_scores every 5 min.**
- `macroWatcher.js` — polls RSS (Trump, ET Markets) every 5 min, AI-filters via Haiku (batched per source), inserts macro_alerts.
- `indexWatcher.js` — monitors Nifty50/500 moves.
- `technicalWatcher.js` — RSI/DMA crossover alerts.

### On-demand scripts
- `onboardStock.js TICKER` — full onboarding: Screener fundamentals, Kite technicals, BSE news, AI summary.
- `setScids.js TICKER SCID` — set mc_scid + immediately fetch MC analyst data.
- `fetchMCData.js` — module only (no standalone runner). Called by engine + onboardStock.
- `refreshKiteToken.js` — auto-generates Kite token via TOTP. Writes to app_settings + .kite_token.
- `fundamentalsAgent.js` — bi-weekly Screener fundamentals refresh for all stocks.

### Support modules
- `kiteClient.js` — Kite REST wrapper, auto-refreshes token from Supabase hourly.
- `technicalService.js` — RSI (Wilder's, period=14), DMA, returns calculations.
- `userCache.js` — in-memory cache of user prefs + watchlist + portfolio stocks. Refreshes every 5 min. All watchers read from this.
- `pgHelper.js` — Supabase client + helpers.

---

## Frontend Pages (app/)

| Route | What it shows | Key data sources |
|-------|--------------|-----------------|
| `/` | Dashboard: market status, watchlist/portfolio P&L, macro news, volume breakouts, signals | user_stocks + portfolio_holdings, stocks, daily_scores, macro_alerts |
| `/watchlist` | Watchlist stocks with live prices, RSI, DMA, PE deviation, benchmark returns | user_stocks, stocks, daily_scores |
| `/portfolio` | Holdings: P&L, day change %, sector allocation, portfolio chart | portfolio_holdings, stocks, daily_scores, daily_history |
| `/market-pulse` | FII/DII flows, sector flows, MF flows | fii_flow, fii_dii_daily, fii_sector, mf_sebi_daily |
| `/global-indices` | Nifty50/500/BankNifty, breadth, sector tiles | Kite API via /api/market-indices |
| `/settings` | Alert thresholds, Telegram link | user_alert_preferences |
| `/admin` | System health, API costs, pipeline trigger (admin only) | app_settings, api_usage_log |

**Pattern:** Pages are Next.js server components that fetch from Supabase directly, then pass data as props to client components. Client components handle live polling and UI state.

---

## Key API Routes

| Route | Purpose |
|-------|---------|
| `/api/live-prices` | Live Kite quotes for watchlist + portfolio. 15s cache. Returns `{ last, change, changePct }` per ticker. |
| `/api/portfolio/live-prices` | Same but portfolio only. Used by HoldingsTable for day change display. |
| `/api/market-indices` | Nifty indices + breadth. 15s cache. Falls back to 24h stale. |
| `/api/search-stocks` | Ticker/name autocomplete from stocks table. |
| `/api/stock-chart` | OHLCV data for chart component from daily_history. |
| `/api/portfolio/holdings` | GET/POST/DELETE portfolio_holdings. |
| `/api/portfolio/import-csv` | Bulk CSV import → portfolio_holdings. |

---

## Key Components

| Component | Purpose |
|-----------|---------|
| `HoldingsTable.tsx` | Portfolio holdings. Has live price polling (every 15s), day change display, flash on price move, P&L calc. |
| `WatchlistTable.tsx` | Watchlist stocks with scores, signals, benchmark comparison. |
| `FundamentalsDrawer.tsx` | Wide slide-out panel with full stock analysis incl. earnings history tab. |
| `PortfolioChart.tsx` | Portfolio vs Nifty50/500 return chart. Uses money-weighted benchmark (each stock anchored to its own entry date). |
| `FiiFlowChart.tsx` | Cumulative FII net flow area chart with period selector. |
| `userCache.js` (agent) | Shared cache — always use this in watchers, not direct Supabase queries per poll. |

---

## Critical Patterns

### Kite token
Three fallback sources (checked in order):
1. `.kite_token` file in repo root
2. `app_settings` table (`key = 'kite_access_token'`)
3. `KITE_ACCESS_TOKEN` env var

Token refreshed nightly via `refreshKiteToken.js` (GitHub Actions). If Kite calls return no data locally, fetch token from Supabase first: `node -e "..."` from `agents/` directory.

### Running scripts locally
Always `cd agents/` first. Scripts use `require('dotenv').config({ path: '../.env.local' })`.

### Money-weighted benchmark
Portfolio and watchlist charts use per-stock Nifty entry anchoring — each stock's benchmark starts from its own `added_at` / `investment_date`, weighted by invested amount. Not a single start date.

### mc_scid
MoneyControl scId used for analyst ratings, target prices, earnings forecasts. Set via `setScids.js TICKER SCID` which also immediately fetches MC data. ETFs don't have scIds — skip them.

### Screener login
`getScreenerSession()` in fiiAgent.js / onboardStock.js. Uses `SCREENER_EMAIL` + `SCREENER_PASSWORD` + CSRF. Screener blocks non-Indian IPs — only runs locally or Railway (Indian IPs), never on Vercel/GitHub Actions.

### NSE holiday guard
Hardcoded list in `.github/workflows/daily-pipeline.yml`. Update every January. Pipeline **skips entirely** on holidays — fiiAgent won't run, so FII data won't update on those days.

---

## MoneyControl scId Map (known)

| Ticker | scId |
|--------|------|
| RELIANCE | RI |
| HDFCBANK | HDF01 |
| ADANIENT | AE01 |
| ANANTRAJ | ARI |
| BEL | BE03 |
| CROMPTON | CGC01 |
| CYIENT | IE07 |
| DEEPAKFERT | DFP |
| ITC | ITC |
| JPPOWER | JHP01 |
| KEC | KEC03 |
| LICI | LIC09 |
| PITTIENG | PL |
| SAGILITY | SIL25 |
| LT | not found yet |

---

## Deferred / Roadmap

- **Trade212 API integration** — user has API key, wants portfolio auto-sync into portfolio_holdings, admin-only
- **Earnings forecast column** — code ready in MC data fetch, needs DB column added
- **Multiple watchlists** (5×15 design)
- **News watcher script** + 9:35 AM Task Scheduler job for twice-daily digest
- **Visual overhaul** — 4 stitch design mockups (stitch_preview 1-4) not yet implemented
- **Add fetchMCData to daily pipeline** — currently manual only

---

## Known Stability Issues

- GH Actions cron unreliable — uses cron-job.org as external trigger
- Kite token expires daily — auto-refresh via TOTP in nightly workflow, but local runs need manual fetch from Supabase
- Realtime channel drops — listener.js reconnects on failure
- Railway sleep — laptop-based Task Scheduler jobs (7 PM fiiAgent) may miss if machine sleeps
