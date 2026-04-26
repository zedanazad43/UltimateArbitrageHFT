New-Item -ItemType Directory -Force -Path migrations | Out-Null

@'
-- جدول التداولات
CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  buy_exchange TEXT NOT NULL,
  sell_exchange TEXT NOT NULL,
  buy_price REAL NOT NULL,
  sell_price REAL NOT NULL,
  amount REAL NOT NULL,
  spread_percent REAL NOT NULL,
  net_profit REAL,
  status TEXT DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- جدول الأرباح
CREATE TABLE IF NOT EXISTS profits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_id INTEGER,
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'USDT',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trade_id) REFERENCES trades(id)
);

-- جدول السجلات
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- جدول إعدادات المستخدم
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- إعدادات افتراضية
INSERT OR IGNORE INTO settings (key, value) VALUES ('min_spread', '0.1');
INSERT OR IGNORE INTO settings (key, value) VALUES ('max_trade_amount', '100');
INSERT OR IGNORE INTO settings (key, value) VALUES ('auto_trade', 'false');
INSERT OR IGNORE INTO settings (key, value) VALUES ('telegram_alerts', 'true');
'@ | Set-Content -Path migrations\schema.sql