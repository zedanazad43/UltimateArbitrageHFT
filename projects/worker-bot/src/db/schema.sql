CREATE TABLE IF NOT EXISTS opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  buy_exchange TEXT NOT NULL,
  sell_exchange TEXT NOT NULL,
  buy_price REAL NOT NULL,
  sell_price REAL NOT NULL,
  spread_pct REAL NOT NULL,
  volume_usdt REAL,
  detected_at TEXT DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','executing','completed','expired','failed'))
);
CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER REFERENCES opportunities(id),
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK(side IN ('spot','futures')),
  buy_exchange TEXT NOT NULL,
  sell_exchange TEXT NOT NULL,
  qty REAL NOT NULL,
  buy_price REAL NOT NULL,
  sell_price REAL NOT NULL,
  net_profit_usdt REAL,
  executed_at TEXT DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','filled','partial','cancelled'))
);
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS exchange_health (
  exchange TEXT PRIMARY KEY,
  status TEXT DEFAULT 'unknown' CHECK(status IN ('unknown','ok','degraded','down')),
  latency_ms INTEGER,
  last_check TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_opp_status ON opportunities(status);
CREATE INDEX IF NOT EXISTS idx_opp_detected ON opportunities(detected_at);
CREATE INDEX IF NOT EXISTS idx_trade_executed ON trades(executed_at);
