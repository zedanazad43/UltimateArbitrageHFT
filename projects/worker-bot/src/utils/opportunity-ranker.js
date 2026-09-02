// src/utils/opportunity-ranker.js — Opportunity Selection & Ranking Engine
//
// Ranks and filters opportunities by multiple criteria, enables returning
// top-N results instead of single best, and provides scoring metrics.

/**
 * Opportunity object structure
 * @typedef {object} Opportunity
 * @property {string} strategy        — strategy name (triangular, dex, cex, etc.)
 * @property {string} symbol          — trading pair
 * @property {string} buyExchange     — entry exchange
 * @property {string} sellExchange    — exit exchange
 * @property {number} buyPrice        — entry price
 * @property {number} sellPrice       — exit price
 * @property {number} grossPct        — gross profit %
 * @property {number} netPct          — net profit % (after fees)
 * @property {number} safetyFactor    — confidence metric (net/gross)
 * @property {string} direction       — human-readable direction
 * @property {boolean} isPerp         — perpetuals?
 * @property {number} timestamp       — creation timestamp
 * @property {number} score           — composite rank score
 */

export class OpportunityRanker {
  /**
   * @param {object} config — { weights: {}, filters: {} }
   */
  constructor(config = {}) {
    this.config = {
      weights: {
        netProfit: 0.5,      // 50% weight on net profit
        safety: 0.3,         // 30% weight on safety factor
        timing: 0.1,         // 10% weight on recency
        efficiency: 0.1,     // 10% weight on execution efficiency
      },
      filters: {
        minNetPct: 0.01,     // minimum 0.01% net
        minSafetyFactor: 0.35, // minimum 35% net/gross
        maxExecutionTime: 10000, // max 10 seconds
      },
      ...config,
    };
    this.history = [];
  }

  /**
   * Calculate composite score for an opportunity.
   *
   * @param {Opportunity} opp
   * @returns {number} composite score (0-100)
   */
  score(opp) {
    const now = Date.now();
    const ageMs = now - (opp.timestamp ?? now);
    const recency = Math.max(0, 1 - (ageMs / 60000)); // 0-1, half-weight at 60s

    const netScore = Math.min(opp.netPct / 0.1, 1.0);        // normalize to 0.1% = 1.0
    const safetyScore = Math.min(opp.safetyFactor / 1.0, 1.0); // normalize by 1.0
    const timingScore = recency;
    const efficiencyScore = Math.min((opp.safetyFactor * opp.netPct) / 0.05, 1.0);

    const composite =
      (netScore * this.config.weights.netProfit) +
      (safetyScore * this.config.weights.safety) +
      (timingScore * this.config.weights.timing) +
      (efficiencyScore * this.config.weights.efficiency);

    return Math.min(composite * 100, 100);
  }

  /**
   * Check if opportunity meets minimum filters.
   *
   * @param {Opportunity} opp
   * @returns {boolean}
   */
  meetsMinimumFilters(opp) {
    const cfg = this.config.filters;
    if ((opp.netPct ?? 0) < cfg.minNetPct) return false;
    if ((opp.safetyFactor ?? 1) < cfg.minSafetyFactor) return false;
    return true;
  }

  /**
   * Rank opportunities and return top N.
   *
   * @param {Array<Opportunity>} opportunities
   * @param {number} topN — return top N (default 5)
   * @returns {Array<Opportunity>} ranked and scored
   */
  rankTopN(opportunities, topN = 5) {
    if (!Array.isArray(opportunities)) return [];

    // Filter by minimum criteria
    const candidates = opportunities.filter(opp => this.meetsMinimumFilters(opp));

    // Score each
    const scored = candidates.map(opp => ({
      ...opp,
      score: this.score(opp),
    }));

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Return top N
    const top = scored.slice(0, topN);

    // Record in history
    for (const opp of top) {
      this.history.push({
        opportunity: opp,
        rankedAt: Date.now(),
        rank: top.indexOf(opp) + 1,
      });
    }

    return top;
  }

  /**
   * Diversify top opportunities by strategy/exchange.
   * Reduces correlation between opportunities (don't pick all from same exchange).
   *
   * @param {Array<Opportunity>} opportunities
   * @param {object} opts — { maxSameExchange: number, maxSameStrategy: number }
   * @returns {Array<Opportunity>}
   */
  diversify(opportunities, opts = {}) {
    const {
      maxSameExchange = 2,
      maxSameStrategy = 3,
    } = opts;

    const selected = [];
    const exchangeCount = {};
    const strategyCount = {};

    for (const opp of opportunities) {
      const exch = opp.buyExchange;
      const strat = opp.strategy;

      if ((exchangeCount[exch] ?? 0) >= maxSameExchange) continue;
      if ((strategyCount[strat] ?? 0) >= maxSameStrategy) continue;

      selected.push(opp);
      exchangeCount[exch] = (exchangeCount[exch] ?? 0) + 1;
      strategyCount[strat] = (strategyCount[strat] ?? 0) + 1;
    }

    return selected;
  }

  /**
   * Filter opportunities by strategy type.
   *
   * @param {Array<Opportunity>} opportunities
   * @param {Array<string>} strategies — strategies to include
   * @returns {Array<Opportunity>}
   */
  filterByStrategy(opportunities, strategies) {
    return opportunities.filter(opp => strategies.includes(opp.strategy));
  }

  /**
   * Filter opportunities by exchange.
   *
   * @param {Array<Opportunity>} opportunities
   * @param {Array<string>} exchanges
   * @returns {Array<Opportunity>}
   */
  filterByExchange(opportunities, exchanges) {
    return opportunities.filter(opp =>
      exchanges.includes(opp.buyExchange) || exchanges.includes(opp.sellExchange)
    );
  }

  /**
   * Get ranking history (last N records).
   *
   * @param {number} limit
   * @returns {Array}
   */
  getHistory(limit = 100) {
    return this.history.slice(-limit);
  }

  /**
   * Get statistics about ranked opportunities.
   *
   * @returns {object}
   */
  getStats() {
    const avgScore = this.history.length > 0
      ? this.history.reduce((sum, h) => sum + h.opportunity.score, 0) / this.history.length
      : 0;

    const strategyDistribution = {};
    for (const h of this.history) {
      const s = h.opportunity.strategy;
      strategyDistribution[s] = (strategyDistribution[s] ?? 0) + 1;
    }

    return {
      totalRanked: this.history.length,
      averageScore: avgScore.toFixed(2),
      strategyDistribution,
      lastRankedAt: this.history.length > 0 ? this.history[this.history.length - 1].rankedAt : null,
    };
  }

  /**
   * Clear history to save memory.
   */
  clearHistory() {
    this.history = [];
  }
}

// ── Global instance ───────────────────────────────────────────────────────────

export const globalRanker = new OpportunityRanker({
  weights: {
    netProfit: 0.5,
    safety: 0.3,
    timing: 0.1,
    efficiency: 0.1,
  },
  filters: {
    minNetPct: 0.01,
    minSafetyFactor: 0.35,
    maxExecutionTime: 10000,
  },
});

/**
 * Helper: rank and return top N opportunities.
 *
 * @param {Array<Opportunity>} opportunities
 * @param {number} topN
 * @returns {Array<Opportunity>}
 */
export function getTopOpportunities(opportunities, topN = 5) {
  return globalRanker.rankTopN(opportunities, topN);
}

/**
 * Helper: get best opportunity (top 1).
 *
 * @param {Array<Opportunity>} opportunities
 * @returns {Opportunity|null}
 */
export function getBestOpportunity(opportunities) {
  const top = globalRanker.rankTopN(opportunities, 1);
  return top.length > 0 ? top[0] : null;
}
