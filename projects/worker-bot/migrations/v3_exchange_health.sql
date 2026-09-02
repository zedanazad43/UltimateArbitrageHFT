-- migrate: v3
CREATE TABLE IF NOT EXISTS exchange_health (
  exchange TEXT PRIMARY KEY,
  status TEXT DEFAULT 'unknown',
  latency_ms INTEGER,
  last_check TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  buy_exchange TEXT NOT NULL,
  sell_exchange TEXT NOT NULL,
  qty REAL NOT NULL,
  buy_price REAL NOT NULL,
  sell_price REAL NOT NULL,
  net_profit_usdt REAL,
  executed_at TEXT DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS performance_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT DEFAULT CURRENT_TIMESTAMP,
  daily_pnl REAL,
  daily_trades INTEGER,
  total_pnl REAL,
  total_trades INTEGER,
  win_rate REAL,
  rtt_ms INTEGER,
  jitter_ms INTEGER
);
