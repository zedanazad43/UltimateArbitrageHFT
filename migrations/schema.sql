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
CREATE INDEX IF NOT EXISTS idx_paper_positions_opened_at
  ON paper_positions(opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_paper_positions_closed_at
  ON paper_positions(closed_at);

