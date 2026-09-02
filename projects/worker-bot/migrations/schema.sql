-- Nexus Arbitrage Hub — canonical D1 schema (combined migrations 0001 + 0002 + 0003)
-- Run: wrangler d1 execute ultimate-arbitrage-db --file=./migrations/schema.sql --remote

CREATE TABLE IF NOT EXISTS trades (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy           TEXT    NOT NULL,
  size_usd           REAL    NOT NULL,
  net_profit_percent REAL    NOT NULL,
  mode               TEXT    NOT NULL DEFAULT 'paper',
  created_at         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  action     TEXT    NOT NULL,
  source_ip  TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bot_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT    NOT NULL,
  details    TEXT,
  created_at INTEGER NOT NULL
);

-- Paper trading simulation: tracks open/closed virtual positions for realistic P&L.
-- Positions are opened on each paper-mode signal and closed on the next scan cycle
-- at the then-current market price, giving a more realistic P&L estimate than an
-- instant-fill assumption.
CREATE TABLE IF NOT EXISTS paper_positions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy      TEXT    NOT NULL,
  symbol        TEXT    NOT NULL,
  direction     TEXT    NOT NULL,
  size_usd      REAL    NOT NULL,
  entry_price   REAL    NOT NULL,
  buy_exchange  TEXT    NOT NULL,
  sell_exchange TEXT    NOT NULL,
  opened_at     INTEGER NOT NULL,
  closed_at     INTEGER,
  exit_price    REAL,
  pnl_usd       REAL
);

CREATE TABLE IF NOT EXISTS profits (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_id   INTEGER,
  amount     REAL    NOT NULL,
  currency   TEXT    DEFAULT 'USDT',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  level      TEXT    NOT NULL,
  message    TEXT    NOT NULL,
  metadata   TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- All setting values are stored as TEXT (SQLite/D1 convention).
-- Application code must cast to the appropriate type when reading.
-- Keys and their expected types:
--   min_spread       -> REAL (percentage, e.g. '0.1')
--   max_trade_amount -> REAL (USD, e.g. '100')
--   auto_trade       -> BOOLEAN ('true'/'false')
--   telegram_alerts  -> BOOLEAN ('true'/'false')
-- Note: updated_at is set on INSERT only; application code must supply
--       a new value for updated_at when running UPDATE statements.
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT    NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('min_spread',       '0.1');
INSERT OR IGNORE INTO settings (key, value) VALUES ('max_trade_amount', '100');
INSERT OR IGNORE INTO settings (key, value) VALUES ('auto_trade',       'false');
INSERT OR IGNORE INTO settings (key, value) VALUES ('telegram_alerts',  'true');

CREATE TABLE IF NOT EXISTS backtest_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  config     TEXT    NOT NULL,
  results    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);

-- Indices for time-range queries and filtering
CREATE INDEX IF NOT EXISTS idx_trades_created_at
  ON trades(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_strategy
  ON trades(strategy);
CREATE INDEX IF NOT EXISTS idx_trades_mode
  ON trades(mode);
CREATE INDEX IF NOT EXISTS idx_admin_events_created_at
  ON admin_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_events_created_at
  ON bot_events(created_at DESC);

-- ═══ HFT RESILIENCE BACKUP TABLES ═══
-- These tables provide state persistence for failover scenarios
CREATE TABLE IF NOT EXISTS backup_positions (
  id TEXT PRIMARY KEY,
  strategy TEXT,
  symbol TEXT,
  buy_exchange TEXT,
  sell_exchange TEXT,
  entry_price REAL,
  current_price REAL,
  size_usd REAL,
  pnl REAL,
  status TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS backup_prices (
  symbol TEXT,
  exchange TEXT,
  price REAL,
  timestamp INTEGER,
  PRIMARY KEY (symbol, exchange)
);

CREATE TABLE IF NOT EXISTS backup_opportunities (
  id TEXT PRIMARY KEY,
  strategy TEXT,
  symbol TEXT,
  spread_pct REAL,
  net_pct REAL,
  size_usd REAL,
  confidence REAL,
  recorded_at INTEGER,
  status TEXT
);

CREATE TABLE IF NOT EXISTS hft_state_sync (
  key TEXT PRIMARY KEY,
  value TEXT,
  last_updated INTEGER
);

CREATE TABLE IF NOT EXISTS failover_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER,
  reason TEXT,
  from_service TEXT,
  to_service TEXT,
  severity TEXT
);

CREATE TABLE IF NOT EXISTS railway_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER,
  endpoint TEXT,
  latency_ms INTEGER,
  success BOOLEAN,
  data_center TEXT
);

-- Indices for resilience tables
CREATE INDEX IF NOT EXISTS idx_backup_positions_status
  ON backup_positions(status);
CREATE INDEX IF NOT EXISTS idx_backup_prices_timestamp
  ON backup_prices(timestamp);
CREATE INDEX IF NOT EXISTS idx_backup_opportunities_recorded_at
  ON backup_opportunities(recorded_at);
CREATE INDEX IF NOT EXISTS idx_failover_events_timestamp
  ON failover_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_railway_metrics_timestamp
  ON railway_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_paper_positions_opened_at
  ON paper_positions(opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_paper_positions_closed_at
  ON paper_positions(closed_at);
CREATE INDEX IF NOT EXISTS idx_profits_trade_id
  ON profits(trade_id);
CREATE INDEX IF NOT EXISTS idx_logs_level
  ON logs(level);
CREATE INDEX IF NOT EXISTS idx_logs_created_at
  ON logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backtest_runs_created_at
  ON backtest_runs(created_at DESC);

