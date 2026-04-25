-- Nexus Arbitrage Hub — canonical D1 schema (combined migrations 0001 + 0002)

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

CREATE INDEX IF NOT EXISTS idx_trades_created_at
  ON trades(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_events_created_at
  ON admin_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_events_created_at
  ON bot_events(created_at DESC);

