-- Migration 0003: Add nexus orchestrator columns to trades + create admin_events

-- Add columns used by src/db.js logTrade / getRecentTrades.
-- Existing rows default to NULL so they don't break dashboard queries.
ALTER TABLE trades ADD COLUMN strategy TEXT;
ALTER TABLE trades ADD COLUMN size_usd REAL DEFAULT 0;
ALTER TABLE trades ADD COLUMN net_profit_percent REAL DEFAULT 0;

-- Admin audit log (used by logAdminEvent in src/db.js)
CREATE TABLE IF NOT EXISTS admin_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  action     TEXT    NOT NULL,
  source_ip  TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_events_created_at ON admin_events(created_at DESC);
