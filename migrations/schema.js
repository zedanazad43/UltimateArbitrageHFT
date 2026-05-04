// migrations/schema.js — canonical D1 schema, single source of truth.
// Imported by src/db.js#ensureSchema() for runtime self-healing initialisation.
// For manual migration: npx wrangler d1 execute ultimate-arbitrage-db --file=./migrations/schema.sql --remote
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

INSERT OR IGNORE INTO settings (key, value) VALUES ('min_spread', '0.1');
INSERT OR IGNORE INTO settings (key, value) VALUES ('max_trade_amount', '100');
INSERT OR IGNORE INTO settings (key, value) VALUES ('auto_trade', 'false');
INSERT OR IGNORE INTO settings (key, value) VALUES ('telegram_alerts', 'true');

CREATE TABLE IF NOT EXISTS backtest_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  config TEXT NOT NULL,
  results TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_strategy ON trades(strategy);
CREATE INDEX IF NOT EXISTS idx_trades_mode ON trades(mode);
CREATE INDEX IF NOT EXISTS idx_admin_events_created_at ON admin_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_events_created_at ON bot_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_paper_positions_opened_at ON paper_positions(opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_paper_positions_closed_at ON paper_positions(closed_at);
CREATE INDEX IF NOT EXISTS idx_profits_trade_id ON profits(trade_id);
CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backtest_runs_created_at ON backtest_runs(created_at DESC);
`;