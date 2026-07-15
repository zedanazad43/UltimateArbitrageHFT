const DB_PATH = './data/opportunities.db';
const fs = require('fs');
if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });

function getDb() {
  try {
    const Database = require('better-sqlite3');
    return new Database(DB_PATH, { fileMustExist: false });
  } catch {
    return null;
  }
}

function saveOpportunity(opp) {
  const db = getDb();
  if (!db) return;
  try {
    db.prepare(`INSERT INTO opportunities (symbol,buy_exchange,sell_exchange,buy_price,sell_price,spread_pct,volume_usdt,status) VALUES (?,?,?,?,?,?,?,?)`)
      .run(opp.symbol, opp.buy_exchange, opp.sell_exchange, opp.buy_price, opp.sell_price, opp.spread_pct, opp.volume_usdt || 0, opp.status || 'pending');
  } catch (e) { console.error('DB saveOpportunity:', e.message); }
}

function getRecentOpportunities(limit = 50) {
  const db = getDb();
  if (!db) return [];
  try {
    return db.prepare(`SELECT * FROM opportunities ORDER BY detected_at DESC LIMIT ?`).all(limit);
  } catch { return []; }
}

module.exports = { saveOpportunity, getRecentOpportunities, getDb };
