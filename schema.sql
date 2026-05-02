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
