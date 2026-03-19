-- AI Research Desk V2 — Initial Schema

-- ============================================================
-- STOCKS (master list, replaces Core Universe sheet)
-- ============================================================
CREATE TABLE stocks (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker                  TEXT NOT NULL UNIQUE,
  stock_name              TEXT NOT NULL,
  bse_code                TEXT,
  instrument_token        BIGINT,

  -- Classification
  industry                TEXT,
  industry_pe             NUMERIC,
  industry_pe_high        NUMERIC,
  industry_pe_low         NUMERIC,

  -- Fundamentals (updated daily by engine)
  stock_pe                NUMERIC,
  roe                     NUMERIC,
  roce                    NUMERIC,
  market_cap              NUMERIC,
  pb                      NUMERIC,
  eps                     NUMERIC,
  dividend_yield          NUMERIC,
  debt_to_equity          NUMERIC,
  promoter_holding        NUMERIC,
  fii_holding             NUMERIC,
  dii_holding             NUMERIC,
  pledged_pct             NUMERIC,
  reserves                NUMERIC,
  borrowings              NUMERIC,

  -- Growth metrics
  revenue_growth_1y       NUMERIC,
  revenue_growth_3y       NUMERIC,
  revenue_growth_5y       NUMERIC,
  profit_growth_1y        NUMERIC,
  profit_growth_3y        NUMERIC,
  profit_growth_5y        NUMERIC,
  operating_cash_flow     NUMERIC,
  free_cash_flow          NUMERIC,
  total_debt              NUMERIC,
  current_ratio           NUMERIC,
  interest_coverage       NUMERIC,

  -- Price data
  current_price           NUMERIC,
  high_52w                NUMERIC,
  low_52w                 NUMERIC,
  pct_from_52w_high       NUMERIC,

  -- AI content
  ai_summary              TEXT,
  summary_date            DATE,
  latest_headlines        TEXT,
  last_news_update        TIMESTAMPTZ,

  fundamentals_updated_at TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- USER_STOCKS (per-user watchlist)
-- ============================================================
CREATE TABLE user_stocks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stock_id   UUID NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, stock_id)
);

-- ============================================================
-- DAILY_SCORES (one row per stock per day)
-- ============================================================
CREATE TABLE daily_scores (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id         UUID NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
  date             DATE NOT NULL,

  pe_deviation     NUMERIC,
  rsi              NUMERIC,
  rsi_signal       TEXT,
  dma_50           NUMERIC,
  dma_200          NUMERIC,
  above_50_dma     BOOLEAN,
  above_200_dma    BOOLEAN,

  composite_score  NUMERIC,
  classification   TEXT,
  suggested_action TEXT,

  stock_6m         NUMERIC,
  stock_1y         NUMERIC,
  nifty50_6m       NUMERIC,
  nifty50_1y       NUMERIC,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (stock_id, date)
);

-- ============================================================
-- DAILY_HISTORY (append-only, replaces History sheet)
-- ============================================================
CREATE TABLE daily_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id          UUID NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
  date              DATE NOT NULL,
  week              INT,
  month             INT,
  quarter           INT,
  day_of_week       TEXT,

  closing_price     NUMERIC,
  open              NUMERIC,
  day_high          NUMERIC,
  day_low           NUMERIC,
  volume            BIGINT,

  stock_pe          NUMERIC,
  industry_pe       NUMERIC,
  pe_deviation      NUMERIC,
  pb                NUMERIC,
  market_cap        NUMERIC,
  pct_from_52w_high NUMERIC,

  rsi               NUMERIC,
  rsi_signal        TEXT,
  dma_50            NUMERIC,
  dma_200           NUMERIC,

  composite_score   NUMERIC,
  classification    TEXT,
  suggested_action  TEXT,

  stock_6m          NUMERIC,
  stock_1y          NUMERIC,
  nifty50_6m        NUMERIC,
  nifty50_1y        NUMERIC,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (stock_id, date)
);

-- ============================================================
-- USER_ALERT_PREFERENCES
-- ============================================================
CREATE TABLE user_alert_preferences (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,

  rsi_oversold_threshold    NUMERIC NOT NULL DEFAULT 30,
  rsi_overbought_threshold  NUMERIC NOT NULL DEFAULT 70,
  dma_cross_alert           BOOLEAN NOT NULL DEFAULT true,
  pct_from_high_threshold   NUMERIC NOT NULL DEFAULT -20,
  new_filing_alert          BOOLEAN NOT NULL DEFAULT true,
  digest_time               TIME NOT NULL DEFAULT '19:00',
  whatsapp_number           TEXT,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- NOTIFICATIONS_SENT (dedup log)
-- ============================================================
CREATE TABLE notifications_sent (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stock_id    UUID NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
  alert_type  TEXT NOT NULL,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_daily_scores_stock_date    ON daily_scores(stock_id, date DESC);
CREATE INDEX idx_daily_history_stock_date   ON daily_history(stock_id, date DESC);
CREATE INDEX idx_notifications_user_stock   ON notifications_sent(user_id, stock_id, alert_type, sent_at DESC);
CREATE INDEX idx_user_stocks_user           ON user_stocks(user_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE stocks                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_scores             ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_history            ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_stocks              ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_alert_preferences   ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications_sent       ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read stocks / scores / history
CREATE POLICY "stocks: authenticated read"        ON stocks        FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "daily_scores: authenticated read"  ON daily_scores  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "daily_history: authenticated read" ON daily_history FOR SELECT USING (auth.role() = 'authenticated');

-- Users can only access their own rows
CREATE POLICY "user_stocks: own rows"              ON user_stocks             FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "user_alert_preferences: own rows"   ON user_alert_preferences  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "notifications_sent: own rows"       ON notifications_sent      FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER stocks_updated_at
  BEFORE UPDATE ON stocks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER user_alert_preferences_updated_at
  BEFORE UPDATE ON user_alert_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
