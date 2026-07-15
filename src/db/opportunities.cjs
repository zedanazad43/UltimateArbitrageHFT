const fs = require('fs');
function getDb() {
  // This module is for local dev only. Cloudflare Workers should use D1 binding.
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    try {
      const Database = require('better-sqlite3');
      const DB_PATH = './data/opportunities.db';
      if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
      const db = new Database(DB_PATH, { fileMustExist: false });
      db.exec(`CREATE TABLE IF NOT EXISTS opportunities (id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT NOT NULL, buy_exchange TEXT NOT NULL, sell_exchange TEXT NOT NULL, buy_price REAL NOT NULL, sell_price REAL NOT NULL, spread_pct REAL NOT NULL, volume_usdt REAL, detected_at TEXT DEFAULT CURRENT_TIMESTAMP, status TEXT DEFAULT 'pending');`);
      db.exec(`CREATE TABLE IF NOT EXISTS trades (id INTEGER PRIMARY KEY AUTOINCREMENT, opportunity_id INTEGER, symbol TEXT NOT NULL, side TEXT NOT NULL, buy_exchange TEXT NOT NULL, sell_exchange TEXT NOT NULL, qty REAL NOT NULL, buy_price REAL NOT NULL, sell_price REAL NOT NULL, net_profit_usdt REAL, executed_at TEXT DEFAULT CURRENT_TIMESTAMP, status TEXT DEFAULT 'pending');`);
      db.exec(`CREATE TABLE IF NOT EXISTS exchange_health (exchange TEXT PRIMARY KEY, status TEXT DEFAULT 'unknown', latency_ms INTEGER, last_check TEXT DEFAULT CURRENT_TIMESTAMP);`);
      return db;
    } catch (e) { console.warn('[DB] SQLite unavailable:', e.message); }
  }
  return null;
}
function saveOpportunity() {}
function getRecentOpportunities() { return []; }
module.exports = { getDb, saveOpportunity, getRecentOpportunities };
