// migrations/schema.js — AUTO-GENERATED from migrations/schema.sql by scripts/sync-schema.mjs.
// Do not edit by hand. Edit migrations/schema.sql and run `npm run db:schema:sync`.
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
CREATE INDEX IF NOT EXISTS idx_opportunities_created_at
ON opportunities(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_status
ON opportunities(status);
CREATE INDEX IF NOT EXISTS idx_opportunities_symbol
ON opportunities(symbol);
CREATE INDEX IF NOT EXISTS idx_opportunities_strategy
ON opportunities(strategy);
CREATE INDEX IF NOT EXISTS idx_perf_created_at
ON performance_snapshots(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_strategy_insights_strategy
ON strategy_insights(strategy, last_updated DESC);
CREATE INDEX IF NOT EXISTS idx_opportunity_audit_opp
ON opportunity_audit(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_backup_positions_status
ON backup_positions(status);
CREATE INDEX IF NOT EXISTS idx_backup_symbol
ON backup_positions(symbol);
CREATE INDEX IF NOT EXISTS idx_backup_prices_timestamp
ON backup_prices(timestamp);
CREATE INDEX IF NOT EXISTS idx_backup_opportunities_recorded_at
ON backup_opportunities(recorded_at);
CREATE INDEX IF NOT EXISTS idx_failover_events_timestamp
ON failover_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_railway_metrics_timestamp
ON railway_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_paper_positions_opened_at
ON paper_positions(opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_paper_positions_closed_at
ON paper_positions(closed_at);
CREATE INDEX IF NOT EXISTS idx_profits_trade_id
ON profits(trade_id);
CREATE INDEX IF NOT EXISTS idx_logs_level
ON logs(level);
CREATE INDEX IF NOT EXISTS idx_logs_created_at
ON logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backtest_runs_created_at
ON backtest_runs(created_at DESC);
`;
