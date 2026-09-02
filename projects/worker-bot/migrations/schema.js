// migrations/schema.js
export const schemaSQL = `
CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy TEXT NOT NULL,
  size_usd REAL NOT NULL,
  net_profit_percent REAL NOT NULL,
  mode TEXT NOT NULL DEFAULT 'paper',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  source_ip TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bot_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  details TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS paper_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy TEXT NOT NULL,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL,
  size_usd REAL NOT NULL,
  entry_price REAL NOT NULL,
  buy_exchange TEXT NOT NULL,
  sell_exchange TEXT NOT NULL,
  opened_at INTEGER NOT NULL,
  closed_at INTEGER,
  exit_price REAL,
  pnl_usd REAL
);

CREATE TABLE IF NOT EXISTS profits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_id INTEGER,
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'USDT',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  strategy TEXT NOT NULL,
  buy_exchange TEXT NOT NULL,
  sell_exchange TEXT NOT NULL,
  gross_pct REAL NOT NULL,
  net_pct REAL NOT NULL,
  safety_factor REAL,
  price_buy REAL NOT NULL,
  price_sell REAL NOT NULL,
  est_fee_usd REAL DEFAULT 0,
  est_slippage_usd REAL DEFAULT 0,
  size_usd REAL,
  status TEXT DEFAULT 'open',
  executed INTEGER DEFAULT 0,
  rejected_reason TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER
);

CREATE TABLE IF NOT EXISTS performance_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  total_pnl_usd REAL NOT NULL,
  equity_usd REAL NOT NULL,
  daily_pnl_usd REAL NOT NULL,
  total_trades INTEGER DEFAULT 0,
  win_trades INTEGER DEFAULT 0,
  loss_trades INTEGER DEFAULT 0,
  win_rate REAL DEFAULT 0,
  max_drawdown_usd REAL DEFAULT 0,
  sharpe REAL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS strategy_insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy TEXT NOT NULL,
  symbol TEXT,
  exchange_pair TEXT,
  direction TEXT,
  sample_size INTEGER DEFAULT 0,
  avg_net_pct REAL DEFAULT 0,
  avg_gross_pct REAL DEFAULT 0,
  avg_slippage_pct REAL DEFAULT 0,
  win_rate REAL DEFAULT 0,
  profit_factor REAL DEFAULT 0,
  confidence REAL DEFAULT 0,
  Kelly REAL DEFAULT 0,
  last_updated INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS opportunity_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opportunity_id INTEGER,
  action TEXT NOT NULL,
  reason TEXT,
  pnl_usd REAL,
  latency_ms INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_events_created_at ON admin_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_created_at ON opportunities(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities(status);
CREATE INDEX IF NOT EXISTS idx_opportunities_symbol ON opportunities(symbol);
CREATE INDEX IF NOT EXISTS idx_opportunities_strategy ON opportunities(strategy);
CREATE INDEX IF NOT EXISTS idx_perf_created_at ON performance_snapshots(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_strategy_insights_strategy ON strategy_insights(strategy, last_updated DESC);
CREATE INDEX IF NOT EXISTS idx_opportunity_audit_opp ON opportunity_audit(opportunity_id);
`;
