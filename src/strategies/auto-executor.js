/**
 * Auto-Executor — Automatic strategy execution engine
 * 
 * Runs all strategies simultaneously (CEX, Perps, Funding, Triangular, DEX)
 * with dynamic prioritization based on profitability, risk management,
 * automatic capital allocation, and loss prevention.
 * 
 * Features:
 * - Parallel strategy execution with priority queue
 * - Dynamic capital allocation across strategies
 * - Automatic stop-loss at portfolio level
 * - Profit reinvestment
 * - Risk-adjusted position sizing
 * - Cross-exchange execution with proxy support
 */

import {
  DATA_ONLY_EXCHANGES,
  getExchangeBalance,
  placeExchangeMarketOrder,
  hasExchangeCredentials,
  extractFillMetrics,
} from '../exchange.js';

import {
  auditLog,
  withRateLimit,
  getRateLimiter,
} from '../infra/security.js';

import { getGlobalProxyPool } from '../infra/proxy-pool.js';
import {
  checkDrawdownGuard,
  checkExposureLimit,
  calculateAdaptiveLeverage,
  calculatePositionSize as riskPositionSize,
  MAX_POSITION_EQUITY_FRACTION,
} from '../risk.js';

// ── Configuration ─────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  maxPositionUsd: 5,             // Default small position size (5 USDT)
  minPositionUsd: 1,             // Hard floor for any position
  safePositionMaxUsd: 500,       // Hard ceiling — never exceeded regardless of config
  maxPortfolioRiskPct: 0.05,     // Max 5% of portfolio at risk
  stopLossPct: 0.02,             // 2% stop-loss per position
  takeProfitPct: 0.05,           // 5% take-profit per position
  minProfitUsd: 0.50,            // Minimum profit to execute
  minSpreadPct: 0.15,            // Minimum spread % to consider
  maxSlippagePct: 0.1,           // Max allowed slippage
  maxOpenPositions: 5,           // Max concurrent positions
  cooldownMs: 30000,             // 30s cooldown between trades
  maxExecutionsPerBatch: 2,      // Limit per cycle to reduce burst risk
  paperMode: true,               // Start in paper mode
  autoReinvest: true,            // Reinvest profits
  strategyFailureLimit: 3,       // Consecutive failures before strategy cooldown
  strategyCooldownMs: 120000,    // 2 min strategy cooldown
  strategies: {
    cex:        { enabled: true, weight: 1.0, maxSpread: 5.0 },
    perps:      { enabled: true, weight: 1.2, maxSpread: 5.0 },
    funding:    { enabled: true, weight: 1.5, maxSpread: 10.0 },
    triangular: { enabled: true, weight: 0.8, maxSpread: 3.0 },
    dex:        { enabled: true, weight: 0.6, maxSpread: 8.0 },
    statistical:{ enabled: true, weight: 1.1, maxSpread: 4.0 },
  },
};

// ── Position Tracking ─────────────────────────────────────────────────────────

class Position {
  constructor(opportunity, sizeUsd) {
    this.id = `pos_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    this.strategy = opportunity.strategy;
    this.symbol = opportunity.symbol;
    this.buyExchange = opportunity.buyExchange;
    this.sellExchange = opportunity.sellExchange;
    this.sizeUsd = sizeUsd;
    this.entrySpreadPct = opportunity.netPct;
    this.openedAt = Date.now();
    this.status = 'open';
    this.pnl = 0;
    this.fillResult = null;
  }
}

// ── Auto-Executor Engine ──────────────────────────────────────────────────────

export class AutoExecutor {
  /**
   * @param {object} env - Cloudflare Worker env bindings
   * @param {object} config - Override default configuration
   */
  constructor(env, config = {}) {
    this.env = env;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.positions = [];
    this.tradeHistory = [];
    this.totalPnl = 0;
    this.totalTrades = 0;
    this.winCount = 0;
    this.lossCount = 0;
    this.lastTradeTime = 0;
    this._running = false;
    this._portfolioBalance = 0;
    this._rateLimiter = getRateLimiter();
    this._proxyPool = getGlobalProxyPool(env);
    this._strategyHealth = new Map();
  }

  getStrategyHealth(strategy) {
    const current = this._strategyHealth.get(strategy);
    if (current) return current;
    const seed = { failures: 0, cooldownUntil: 0, lastError: null };
    this._strategyHealth.set(strategy, seed);
    return seed;
  }

  isStrategyCoolingDown(strategy) {
    const state = this.getStrategyHealth(strategy);
    return state.cooldownUntil > Date.now();
  }

  markStrategySuccess(strategy) {
    const state = this.getStrategyHealth(strategy);
    state.failures = 0;
    state.cooldownUntil = 0;
    state.lastError = null;
  }

  markStrategyFailure(strategy, errorMessage) {
    const state = this.getStrategyHealth(strategy);
    state.failures += 1;
    state.lastError = errorMessage || 'unknown';
    if (state.failures >= this.config.strategyFailureLimit) {
      state.cooldownUntil = Date.now() + this.config.strategyCooldownMs;
      state.failures = 0;
      auditLog({
        type: 'strategy_cooldown',
        level: 'warn',
        details: {
          strategy,
          cooldownMs: this.config.strategyCooldownMs,
          reason: state.lastError,
        },
      });
    }
  }

  /**
   * Returns current portfolio balance across all configured exchanges.
   */
  async refreshPortfolioBalance() {
    const exchanges = ['mexc', 'binance', 'kucoin', 'bitget', 'bitmart', 'htx'];
    const balances = await Promise.allSettled(
      exchanges
        .filter(ex => hasExchangeCredentials(this.env, ex))
        .map(async ex => {
          try {
            const bal = await getExchangeBalance(this.env, ex, 'USDT');
            return { exchange: ex, balance: bal };
          } catch {
            return { exchange: ex, balance: 0 };
          }
        })
    );

    this._portfolioBalance = balances
      .filter(r => r.status === 'fulfilled')
      .reduce((sum, r) => sum + (r.value?.balance || 0), 0);

    auditLog({
      type: 'portfolio_refresh',
      level: 'info',
      details: {
        totalBalance: this._portfolioBalance,
        exchanges: balances
          .filter(r => r.status === 'fulfilled')
          .map(r => r.value),
      },
    });

    return this._portfolioBalance;
  }

  /**
   * Calculates the maximum position size based on portfolio balance and risk.
   * Always clamps between minPositionUsd and safePositionMaxUsd.
   */
  calculatePositionSize(opportunity) {
    const strategyConfig = this.config.strategies[opportunity.strategy];
    if (!strategyConfig) return 0;

    // Use risk.js position sizing for consistency with orchestrator
    const equity = this._portfolioBalance || 1000;
    const winRate = 0.55;
    const riskReward = 2.0;
    const riskCalcSize = riskPositionSize(equity, winRate, riskReward);

    const maxRisk = equity * this.config.maxPortfolioRiskPct;
    const maxByRisk = Math.max(0, maxRisk / (this.config.stopLossPct || 0.02));

    // Leverage for perps/funding strategies
    const leverage = (opportunity.isPerp || opportunity.strategy === 'funding')
      ? calculateAdaptiveLeverage(equity, opportunity.netPct || 0)
      : 1;

    const rawMax = Math.min(
      riskCalcSize * leverage,
      this.config.maxPositionUsd,
      maxByRisk,
      equity * 0.1, // Never more than 10% in one position
      equity * MAX_POSITION_EQUITY_FRACTION
    );

    const clamped = Math.max(0, Math.min(rawMax, opportunity.suggestedSize || rawMax));

    // Apply hard safety bounds regardless of config
    const minUsd = this.config.minPositionUsd ?? 1;
    const maxUsd = this.config.safePositionMaxUsd ?? 500;
    if (clamped <= 0) return 0;
    return Math.max(minUsd, Math.min(maxUsd, clamped));
  }

  /**
   * Checks if a new position can be opened.
   */
  canOpenPosition() {
    if (this.positions.filter(p => p.status === 'open').length >= this.config.maxOpenPositions) {
      return false;
    }
    if (Date.now() - this.lastTradeTime < this.config.cooldownMs) {
      return false;
    }
    return true;
  }

  /**
   * Scores an opportunity based on strategy weight, spread, and risk.
   * Higher score = better opportunity.
   */
  scoreOpportunity(opp) {
    const strategyConfig = this.config.strategies[opp.strategy];
    if (!strategyConfig || !strategyConfig.enabled) return -1;

    const spreadPct = opp.netPct || 0;
    if (spreadPct < this.config.minSpreadPct) return -1;
    if (spreadPct > strategyConfig.maxSpread) return -1; // Likely bad data

    // Weighted score: spread * strategy weight * reliability factor
    const reliabilityFactor = (opp.confidence || 0.5);
    const score = spreadPct * strategyConfig.weight * reliabilityFactor;

    return score;
  }

  /**
   * Prioritizes opportunities by score (descending).
   */
  prioritizeOpportunities(opportunities) {
    return opportunities
      .map(opp => ({ ...opp, score: this.scoreOpportunity(opp) }))
      .filter(opp => !this.isStrategyCoolingDown(opp.strategy))
      .filter(opp => opp.score > 0)
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Executes a single opportunity (paper or live).
   */
  async executeOpportunity(opp, sizeUsd) {
    const position = new Position(opp, sizeUsd);

    auditLog({
      type: 'trade_attempt',
      level: 'info',
      details: {
        positionId: position.id,
        strategy: opp.strategy,
        symbol: opp.symbol,
        buyExchange: opp.buyExchange,
        sellExchange: opp.sellExchange,
        spreadPct: opp.netPct,
        sizeUsd,
        paperMode: this.config.paperMode,
      },
    });

    if (this.config.paperMode) {
      // Paper trade — simulate execution
      const estimatedProfit = sizeUsd * (opp.netPct / 100);
      position.pnl = estimatedProfit;
      position.status = 'closed';
      position.fillResult = { simulated: true, estimatedProfit };
      this.markStrategySuccess(opp.strategy);

      auditLog({
        type: 'trade_paper',
        level: 'info',
        details: {
          positionId: position.id,
          estimatedProfit: estimatedProfit.toFixed(4),
          spreadPct: opp.netPct.toFixed(4),
        },
      });
    } else {
      // Live execution
      try {
        // Validate exchanges are not data-only
        if (DATA_ONLY_EXCHANGES.has(opp.buyExchange) || DATA_ONLY_EXCHANGES.has(opp.sellExchange)) {
          throw new Error(
            `Cannot execute on data-only exchange: ${opp.buyExchange} or ${opp.sellExchange}`
          );
        }

        // Execute buy side
        const buyResult = await withRateLimit(opp.buyExchange, () =>
          placeExchangeMarketOrder(
            this.env, opp.buyExchange, opp.symbol, 'BUY',
            opp.buyQuantity || '0', sizeUsd
          )
        );

        // Execute sell side
        const sellResult = await withRateLimit(opp.sellExchange, () =>
          placeExchangeMarketOrder(
            this.env, opp.sellExchange, opp.symbol, 'SELL',
            opp.sellQuantity || '0', sizeUsd
          )
        );

        // Extract fill metrics
        const buyMetrics = extractFillMetrics(buyResult);
        const sellMetrics = extractFillMetrics(sellResult);

        const buyCost = buyMetrics?.quoteQty || sizeUsd;
        const sellRevenue = sellMetrics?.quoteQty || sizeUsd;
        const buyFee = buyMetrics?.feeQty || 0;
        const sellFee = sellMetrics?.feeQty || 0;

        position.pnl = sellRevenue - buyCost - buyFee - sellFee;
        position.status = 'closed';
        position.fillResult = { buyResult, sellResult, buyMetrics, sellMetrics };
        this.markStrategySuccess(opp.strategy);

        auditLog({
          type: 'trade_live',
          level: position.pnl >= 0 ? 'info' : 'warn',
          details: {
            positionId: position.id,
            pnl: position.pnl.toFixed(4),
            buyExchange: opp.buyExchange,
            sellExchange: opp.sellExchange,
          },
        });
      } catch (err) {
        position.status = 'failed';
        position.pnl = 0;
        this.markStrategyFailure(opp.strategy, err.message);

        auditLog({
          type: 'trade_error',
          level: 'error',
          details: {
            positionId: position.id,
            error: err.message,
            strategy: opp.strategy,
          },
        });
      }
    }

    // Update tracking
    this.positions.push(position);
    this.tradeHistory.push({
      ...position,
      closedAt: Date.now(),
    });
    this.totalPnl += position.pnl;
    this.totalTrades++;
    if (position.pnl >= 0) this.winCount++;
    else this.lossCount++;
    this.lastTradeTime = Date.now();

    return position;
  }

  /**
   * Main execution loop — processes a batch of opportunities.
   * Returns executed positions.
   */
  async executeBatch(opportunities) {
    if (!this._running) {
      await this.refreshPortfolioBalance();
      this._running = true;
    }

    // Pre-batch risk checks
    const equity = this._portfolioBalance || 1000;
    const state = {
      daily_pnl: this._dailyLoss || 0,
      daily_trades: this.totalTrades,
      max_daily_loss_usd: this._maxDailyLoss || 25,
      max_per_trade_loss_pct: this.config.stopLossPct || 0.02,
      initial_capital: 1000,
    };

    const drawdownCheck = checkDrawdownGuard(state, equity);
    if (drawdownCheck.halt) {
      auditLog({
        type: 'auto_stop_drawdown',
        level: 'warn',
        details: { reason: drawdownCheck.reason },
      });
      return [];
    }

    const prioritized = this.prioritizeOpportunities(opportunities);
    const executed = [];

    for (const opp of prioritized) {
      if (!this.canOpenPosition()) break;
      if (executed.length >= this.config.maxExecutionsPerBatch) break;

      const sizeUsd = this.calculatePositionSize(opp);
      if (sizeUsd < 1) continue; // Too small to trade

      const estimatedProfit = sizeUsd * (opp.netPct / 100);
      if (estimatedProfit < this.config.minProfitUsd) continue;

      // Exposure limit check per trade
      const currentExposure = executed.reduce((sum, p) => sum + (p.sizeUsd || 0), 0);
      const exposureCheck = checkExposureLimit(equity, currentExposure, sizeUsd);
      if (!exposureCheck.allowed) {
        auditLog({
          type: 'exposure_limit',
          level: 'warn',
          details: { reason: exposureCheck.reason, sizeUsd },
        });
        break; // Stop adding more positions
      }

      try {
        const position = await this.executeOpportunity(opp, sizeUsd);
        executed.push(position);
      } catch (err) {
        auditLog({
          type: 'execution_error',
          level: 'error',
          details: { error: err.message, opportunity: opp },
        });
      }
    }

    return executed;
  }

  /**
   * Checks open positions for stop-loss / take-profit triggers.
   * (For strategies that hold positions over time like funding rate harvest.)
   */
  checkPositionLimits(currentPrices) {
    const closed = [];
    for (const pos of this.positions) {
      if (pos.status !== 'open') continue;

      const currentPrice = currentPrices[pos.symbol];
      if (!currentPrice) continue;

      const pnlPct = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;

      if (pnlPct <= -this.config.stopLossPct * 100) {
        pos.status = 'stopped_out';
        pos.pnl = pos.sizeUsd * (pnlPct / 100);
        closed.push(pos);
        auditLog({
          type: 'stop_loss',
          level: 'warn',
          details: { positionId: pos.id, pnlPct: pnlPct.toFixed(2) },
        });
      } else if (pnlPct >= this.config.takeProfitPct * 100) {
        pos.status = 'take_profit';
        pos.pnl = pos.sizeUsd * (pnlPct / 100);
        closed.push(pos);
        auditLog({
          type: 'take_profit',
          level: 'info',
          details: { positionId: pos.id, pnlPct: pnlPct.toFixed(2) },
        });
      }
    }
    return closed;
  }

  /**
   * Returns current executor statistics.
   */
  getStats() {
    const openPositions = this.positions.filter(p => p.status === 'open');
    const winRate = this.totalTrades > 0
      ? (this.winCount / this.totalTrades * 100).toFixed(1)
      : '0.0';

    return {
      running: this._running,
      paperMode: this.config.paperMode,
      portfolioBalance: this._portfolioBalance.toFixed(2),
      totalPnl: this.totalPnl.toFixed(4),
      totalTrades: this.totalTrades,
      winRate: `${winRate}%`,
      openPositions: openPositions.length,
      maxPositions: this.config.maxOpenPositions,
      strategyCooldownMs: this.config.strategyCooldownMs,
      strategies: Object.entries(this.config.strategies)
        .filter(([, v]) => v.enabled)
        .map(([k]) => k),
      strategyHealth: Object.fromEntries(
        [...this._strategyHealth.entries()].map(([strategy, value]) => [
          strategy,
          {
            coolingDown: value.cooldownUntil > Date.now(),
            cooldownRemainingMs: Math.max(0, value.cooldownUntil - Date.now()),
            lastError: value.lastError,
          }
        ])
      ),
      proxyRouting: {
        mode: this._proxyPool?.proxyMode || 'auto',
        usingProxy: this._proxyPool?.shouldProxy?.() ?? false,
        availableProxies: this._proxyPool?.availableCount || 0,
      },
      rateLimiterBackoffExchanges: this._rateLimiter?._backoff
        ? [...this._rateLimiter._backoff.keys()]
        : [],
      recentTrades: this.tradeHistory.slice(-10).map(t => ({
        id: t.id,
        strategy: t.strategy,
        symbol: t.symbol,
        pnl: t.pnl?.toFixed(4),
        status: t.status,
      })),
    };
  }

  /**
   * Toggles between paper and live mode.
   */
  setPaperMode(enabled) {
    this.config.paperMode = enabled;
    auditLog({
      type: 'mode_change',
      level: 'warn',
      details: { paperMode: enabled },
    });
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _executor = null;

/**
 * Returns the global auto-executor instance.
 */
export function getAutoExecutor(env, config) {
  if (!_executor) {
    _executor = new AutoExecutor(env, config);
  }
  return _executor;
}
