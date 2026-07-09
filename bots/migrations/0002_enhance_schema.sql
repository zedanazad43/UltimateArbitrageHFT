-- Migration 0002: Add mode column to trades + bot_events table

-- Add mode column (paper/live) to existing trades table.
-- DEFAULT 'paper' ensures existing rows are treated as paper trades.
ALTER TABLE trades ADD COLUMN mode TEXT NOT NULL DEFAULT 'paper';

-- Track significant bot lifecycle events (auto-stop, mode change, daily reset).
CREATE TABLE IF NOT EXISTS bot_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT    NOT NULL,
  details    TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bot_events_created_at ON bot_events(created_at DESC);
