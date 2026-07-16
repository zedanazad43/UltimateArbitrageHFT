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

-- Analytics for circuit breaker and failover tracking
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

CREATE INDEX IF NOT EXISTS idx_backup_positions_status ON backup_positions(status);
CREATE INDEX IF NOT EXISTS idx_backup_positions_symbol ON backup_positions(symbol);
CREATE INDEX IF NOT EXISTS idx_backup_prices_timestamp ON backup_prices(timestamp);
CREATE INDEX IF NOT EXISTS idx_backup_opportunities_strategy ON backup_opportunities(strategy);
CREATE INDEX IF NOT EXISTS idx_backup_opportunities_symbol ON backup_opportunities(symbol);
CREATE INDEX IF NOT EXISTS idx_backup_opportunities_recorded_at ON backup_opportunities(recorded_at);
CREATE INDEX IF NOT EXISTS idx_hft_state_sync_updated ON hft_state_sync(last_updated);
CREATE INDEX IF NOT EXISTS idx_failover_events_timestamp ON failover_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_failover_events_reason ON failover_events(reason);
CREATE INDEX IF NOT EXISTS idx_railway_metrics_timestamp ON railway_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_railway_metrics_endpoint ON railway_metrics(endpoint);
