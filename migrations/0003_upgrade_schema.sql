-- Migration 0003: Upgrade trades table from old schema to new, add paper_positions
--
-- The original "trades" table (created by the PowerShell setup script) had columns:
--   id, symbol, buy_exchange, sell_exchange, buy_price, sell_price,
--   amount, spread_percent, net_profit, status, created_at
--
-- The current application expects:
--   id, strategy, size_usd, net_profit_percent, mode, created_at
--
-- We rename the old table, recreate it correctly, then drop the backup.
-- All other tables are created with IF NOT EXISTS so this is safe to re-run
-- against a database that already has the new schema.

-- Step 1: Rename the old trades table out of the way
ALTER TABLE trades RENAME TO trades_old;

-- Step 2: Create the correct trades table
CREATE TABLE trades (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy           TEXT    NOT NULL,
  size_usd           REAL    NOT NULL,
  net_profit_percent REAL    NOT NULL,
  mode               TEXT    NOT NULL DEFAULT 'paper',
  created_at         INTEGER NOT NULL
);

-- Step 3: Drop the old table (no data migration — old columns are incompatible)
DROP TABLE trades_old;

-- Step 4: Ensure remaining tables exist (idempotent)
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

-- Step 5: Create indexes
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
