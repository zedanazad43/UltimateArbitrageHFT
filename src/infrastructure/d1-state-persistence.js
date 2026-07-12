// State persistence to D1 for critical trading data backup

export class D1StatePersistence {
  constructor(db) {
    this.db = db;
  }

  async initialize() {
    // Create tables if they don't exist
    await this.db.exec(`
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
    `);
  }

  async savePosition(position) {
    await this.db.prepare(`
      INSERT OR REPLACE INTO backup_positions
      (id, strategy, symbol, buy_exchange, sell_exchange, entry_price,
       current_price, size_usd, pnl, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      position.id,
      position.strategy,
      position.symbol,
      position.buyExchange,
      position.sellExchange,
      position.entryPrice,
      position.currentPrice,
      position.sizeUsd,
      position.pnl,
      position.status,
      position.createdAt,
      Date.now()
    ).run();
  }

  async getActivePositions() {
    const result = await this.db.prepare(`
      SELECT * FROM backup_positions
      WHERE status IN ('open', 'pending')
      ORDER BY updated_at DESC
      LIMIT 100
    `).all();
    return result.results || [];
  }

  async savePrice(symbol, exchange, price) {
    await this.db.prepare(`
      INSERT OR REPLACE INTO backup_prices
      (symbol, exchange, price, timestamp)
      VALUES (?, ?, ?, ?)
    `).bind(symbol, exchange, price, Date.now()).run();
  }

  async getPrices(symbols = []) {
    const placeholders = symbols.map(() => '?').join(',');
    const result = await this.db.prepare(`
      SELECT * FROM backup_prices
      WHERE symbol IN (${placeholders})
      ORDER BY timestamp DESC
    `).bind(...symbols).all();
    return result.results || [];
  }

  async recordOpportunity(opportunity) {
    await this.db.prepare(`
      INSERT INTO backup_opportunities
      (id, strategy, symbol, spread_pct, net_pct, size_usd, confidence, recorded_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      opportunity.id || crypto.randomUUID(),
      opportunity.strategy,
      opportunity.symbol,
      opportunity.spreadPct,
      opportunity.netPct,
      opportunity.sizeUsd,
      opportunity.confidence || 0.5,
      Date.now(),
      'recorded'
    ).run();
  }

  async getRecentOpportunities(limit = 50) {
    const result = await this.db.prepare(`
      SELECT * FROM backup_opportunities
      ORDER BY recorded_at DESC
      LIMIT ?
    `).bind(limit).all();
    return result.results || [];
  }

  async setState(key, value) {
    await this.db.prepare(`
      INSERT OR REPLACE INTO hft_state_sync
      (key, value, last_updated)
      VALUES (?, ?, ?)
    `).bind(key, JSON.stringify(value), Date.now()).run();
  }

  async getState(key) {
    const result = await this.db.prepare(`
      SELECT value FROM hft_state_sync WHERE key = ?
    `).bind(key).first();
    return result ? JSON.parse(result.value) : null;
  }

  async cleanupOldData(olderThanMs = 86400000) {
    // Delete opportunities older than specified time (default 24h)
    const cutoff = Date.now() - olderThanMs;
    await this.db.prepare(`
      DELETE FROM backup_opportunities
      WHERE recorded_at < ?
    `).bind(cutoff).run();

    // Delete closed positions older than 7 days
    const weekCutoff = Date.now() - 604800000;
    await this.db.prepare(`
      DELETE FROM backup_positions
      WHERE status = 'closed' AND updated_at < ?
    `).bind(weekCutoff).run();
  }

  async getHealthStats() {
    const positionCount = await this.db.prepare(
      'SELECT COUNT(*) as count FROM backup_positions WHERE status IN ("open", "pending")'
    ).first();

    const priceCount = await this.db.prepare(
      'SELECT COUNT(*) as count FROM backup_prices'
    ).first();

    const recentOpportunities = await this.db.prepare(
      `SELECT COUNT(*) as count FROM backup_opportunities
       WHERE recorded_at > ?`
    ).bind(Date.now() - 3600000).first();

    return {
      activePositions: positionCount?.count || 0,
      priceCacheSize: priceCount?.count || 0,
      opportunitiesLastHour: recentOpportunities?.count || 0,
    };
  }
}

// Export singleton instance getter
export function getD1StatePersistence(db) {
  return new D1StatePersistence(db);
}
