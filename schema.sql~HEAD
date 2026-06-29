-- جدول التداولات (متوافق مع src/db.js)
CREATE TABLE IF NOT EXISTS trades (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy           TEXT    NOT NULL,
  size_usd           REAL    NOT NULL,
  net_profit_percent REAL    NOT NULL,
  mode               TEXT    NOT NULL DEFAULT 'paper',
  created_at         INTEGER NOT NULL
);

-- جدول سجلات الإدارة (متوافق مع logAdminEvent)
CREATE TABLE IF NOT EXISTS admin_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  action      TEXT    NOT NULL,
  source_ip   TEXT,
  created_at  INTEGER NOT NULL
);

-- جدول سجلات البوت (متوافق مع logBotEvent)
CREATE TABLE IF NOT EXISTS bot_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type  TEXT    NOT NULL,
  details     TEXT,
  created_at  INTEGER NOT NULL
);

-- جدول المراكز الورقية (متوافق مع openPaperPosition / closePaperPosition)
CREATE TABLE IF NOT EXISTS paper_positions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy       TEXT    NOT NULL,
  symbol         TEXT    NOT NULL,
  direction      TEXT    NOT NULL,
  size_usd       REAL    NOT NULL,
  entry_price    REAL    NOT NULL,
  buy_exchange   TEXT    NOT NULL,
  sell_exchange  TEXT    NOT NULL,
  opened_at      INTEGER NOT NULL,
  closed_at      INTEGER,
  exit_price     REAL,
  pnl_usd        REAL
);

-- إذا أردت جداول إضافية (مثل profits, logs, settings) يمكنك إضافتها هنا

-- جدول نتائج الاختبارات السابقة (Backtesting)
CREATE TABLE IF NOT EXISTS backtest_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  config     TEXT    NOT NULL,
  results    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);


-- =====================================================
-- Performance Indexes (added 2026-06-16)
-- =====================================================

-- Trades: fast lookups by strategy, date, mode
CREATE INDEX IF NOT EXISTS idx_trades_strategy ON trades(strategy);
CREATE INDEX IF NOT EXISTS idx_trades_mode ON trades(mode);
CREATE INDEX IF NOT EXISTS idx_trades_created ON trades(created_at);
CREATE INDEX IF NOT EXISTS idx_trades_strategy_mode ON trades(strategy, mode);

-- Admin events: lookups by action type and time
CREATE INDEX IF NOT EXISTS idx_admin_events_action ON admin_events(action);
CREATE INDEX IF NOT EXISTS idx_admin_events_created ON admin_events(created_at);

-- Bot events: fast filtering by event type
CREATE INDEX IF NOT EXISTS idx_bot_events_type ON bot_events(event_type);
CREATE INDEX IF NOT EXISTS idx_bot_events_created ON bot_events(created_at);

-- Paper positions: find open positions, filter by strategy
CREATE INDEX IF NOT EXISTS idx_paper_positions_strategy ON paper_positions(strategy);
CREATE INDEX IF NOT EXISTS idx_paper_positions_symbol ON paper_positions(symbol);
CREATE INDEX IF NOT EXISTS idx_paper_positions_opened ON paper_positions(opened_at);
CREATE INDEX IF NOT EXISTS idx_paper_positions_open ON paper_positions(closed_at) WHERE closed_at IS NULL;

-- Backtest runs: filter by date
CREATE INDEX IF NOT EXISTS idx_backtest_runs_created ON backtest_runs(created_at);
