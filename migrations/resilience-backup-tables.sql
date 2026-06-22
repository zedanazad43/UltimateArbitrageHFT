-- Migration: Add HFT resilience backup tables
-- Adds tables for state persistence, price history, and opportunity tracking

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
  updated_at INTEGER,
  INDEX idx_status (status),
  INDEX idx_symbol (symbol)
);

CREATE TABLE IF NOT EXISTS backup_prices (
  symbol TEXT,
  exchange TEXT,
  price REAL,
  timestamp INTEGER,
  PRIMARY KEY (symbol, exchange),
  INDEX idx_timestamp (timestamp)
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
  status TEXT,
  INDEX idx_strategy (strategy),
  INDEX idx_symbol (symbol),
  INDEX idx_recorded_at (recorded_at)
);

CREATE TABLE IF NOT EXISTS hft_state_sync (
  key TEXT PRIMARY KEY,
  value TEXT,
  last_updated INTEGER,
  INDEX idx_updated (last_updated)
);

-- Analytics for circuit breaker and failover tracking
CREATE TABLE IF NOT EXISTS failover_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER,
  reason TEXT,
  from_service TEXT,
  to_service TEXT,
  severity TEXT,
  INDEX idx_timestamp (timestamp),
  INDEX idx_reason (reason)
);

CREATE TABLE IF NOT EXISTS railway_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER,
  endpoint TEXT,
  latency_ms INTEGER,
  success BOOLEAN,
  data_center TEXT,
  INDEX idx_timestamp (timestamp),
  INDEX idx_endpoint (endpoint)
);
