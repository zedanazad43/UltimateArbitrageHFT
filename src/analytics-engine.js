#!/usr/bin/env node
/**
 * Analytics & Strategy Analysis Module
 * 
 * Features:
 * - Real-time strategy performance tracking
 * - Advanced statistical analysis
 * - Risk/Reward metrics
 * - Equity curve generation
 * - Correlation analysis
 */

class AnalyticsEngine {
  constructor() {
    this.trades = [];
    this.strategies = new Map();
    this.portfolio = {
      initialCapital: 0,
      currentCapital: 0,
      equity: [],
      drawdown: []
    };
  }

  /**
   * Track trade execution
   */
  recordTrade(trade) {
    const enrichedTrade = {
      ...trade,
      timestamp: trade.timestamp || new Date(),
      id: `${trade.strategy}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      pnl: trade.exitPrice 
        ? (trade.exitPrice - trade.entryPrice) * trade.quantity
        : 0,
      pnlPercent: trade.exitPrice
        ? ((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * 100
        : 0,
      duration: trade.exitTime 
        ? new Date(trade.exitTime) - new Date(trade.entryTime)
        : null
    };

    this.trades.push(enrichedTrade);
    this.updateStrategyStats(enrichedTrade);
    return enrichedTrade.id;
  }

  /**
   * Update strategy performance
   */
  updateStrategyStats(trade) {
    const strategyName = trade.strategy;
    
    if (!this.strategies.has(strategyName)) {
      this.strategies.set(strategyName, {
        name: strategyName,
        trades: 0,
        wins: 0,
        losses: 0,
        totalPnL: 0,
        avgWin: 0,
        avgLoss: 0,
        winRate: 0,
        profitFactor: 0,
        sharpeRatio: 0,
        maxDD: 0
      });
    }

    const stats = this.strategies.get(strategyName);
    stats.trades++;
    stats.totalPnL += trade.pnl;

    if (trade.pnl > 0) {
      stats.wins++;
      stats.avgWin = ((stats.avgWin * (stats.wins - 1)) + trade.pnl) / stats.wins;
    } else if (trade.pnl < 0) {
      stats.losses++;
      stats.avgLoss = ((stats.avgLoss * (stats.losses - 1)) + Math.abs(trade.pnl)) / stats.losses;
    }

    stats.winRate = stats.trades > 0 ? (stats.wins / stats.trades) * 100 : 0;
    stats.profitFactor = stats.avgLoss > 0 ? stats.avgWin / stats.avgLoss : 0;
  }

  /**
   * Calculate Sharpe Ratio
   */
  calculateSharpeRatio(returns, riskFreeRate = 0.02) {
    if (returns.length < 2) return 0;

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, r) => a + Math.pow(r - mean, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    return stdDev > 0 ? (mean - riskFreeRate / 252) / (stdDev * Math.sqrt(252)) : 0;
  }

  /**
   * Calculate Maximum Drawdown
   */
  calculateMaxDrawdown(equity) {
    if (equity.length < 2) return 0;

    let maxDD = 0;
    let peak = equity[0];

    for (const value of equity) {
      if (value > peak) peak = value;
      const dd = (peak - value) / peak;
      if (dd > maxDD) maxDD = dd;
    }

    return maxDD;
  }

  /**
   * Generate equity curve
   */
  generateEquityCurve(initialCapital) {
    const curve = [initialCapital];
    let current = initialCapital;

    for (const trade of this.trades) {
      current += trade.pnl;
      curve.push(current);
    }

    this.portfolio.initialCapital = initialCapital;
    this.portfolio.currentCapital = current;
    this.portfolio.equity = curve;
    this.portfolio.drawdown = this.calculateDrawdownCurve(curve);

    return curve;
  }

  /**
   * Calculate drawdown curve
   */
  calculateDrawdownCurve(equity) {
    const drawdowns = [];
    let peak = equity[0];

    for (const value of equity) {
      if (value > peak) peak = value;
      drawdowns.push((peak - value) / peak);
    }

    return drawdowns;
  }

  /**
   * Get comprehensive performance report
   */
  getPerformanceReport(initialCapital = 10000) {
    this.generateEquityCurve(initialCapital);

    const returns = [];
    for (let i = 1; i < this.portfolio.equity.length; i++) {
      returns.push(
        (this.portfolio.equity[i] - this.portfolio.equity[i - 1]) / this.portfolio.equity[i - 1]
      );
    }

    const totalReturn = ((this.portfolio.currentCapital - initialCapital) / initialCapital) * 100;
    const monthlyReturn = totalReturn / (this.trades.length > 0 ? Math.ceil(this.trades.length / 20) : 1);

    return {
      summary: {
        totalTrades: this.trades.length,
        totalPnL: this.trades.reduce((sum, t) => sum + t.pnl, 0).toFixed(2),
        totalReturn: totalReturn.toFixed(2) + '%',
        monthlyReturn: monthlyReturn.toFixed(2) + '%',
        finalEquity: this.portfolio.currentCapital.toFixed(2)
      },
      performance: {
        winRate: (this.trades.filter(t => t.pnl > 0).length / this.trades.length * 100).toFixed(2) + '%',
        avgWin: this.trades.filter(t => t.pnl > 0).length > 0
          ? (this.trades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0) / this.trades.filter(t => t.pnl > 0).length).toFixed(2)
          : '0.00',
        avgLoss: this.trades.filter(t => t.pnl < 0).length > 0
          ? (Math.abs(this.trades.filter(t => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0)) / this.trades.filter(t => t.pnl < 0).length).toFixed(2)
          : '0.00',
        sharpeRatio: this.calculateSharpeRatio(returns).toFixed(2),
        maxDrawdown: (this.calculateMaxDrawdown(this.portfolio.equity) * 100).toFixed(2) + '%'
      },
      strategies: Array.from(this.strategies.values()).map(s => ({
        ...s,
        avgWin: s.avgWin.toFixed(2),
        avgLoss: s.avgLoss.toFixed(2),
        winRate: s.winRate.toFixed(2),
        profitFactor: s.profitFactor.toFixed(2),
        totalPnL: s.totalPnL.toFixed(2)
      }))
    };
  }

  /**
   * Get equity curve data
   */
  getEquityCurveData() {
    return this.portfolio.equity.map((value, index) => ({
      timestamp: new Date(Date.now() - (this.portfolio.equity.length - index) * 1000),
      equity: value.toFixed(2),
      drawdown: (this.portfolio.drawdown[index] * 100).toFixed(2)
    }));
  }

  /**
   * Export report to JSON
   */
  exportReport() {
    return {
      generatedAt: new Date().toISOString(),
      summary: this.getPerformanceReport(),
      equityCurve: this.getEquityCurveData(),
      allTrades: this.trades.map(t => ({
        ...t,
        pnl: t.pnl.toFixed(2),
        pnlPercent: t.pnlPercent.toFixed(2)
      }))
    };
  }

  /**
   * Reset analytics
   */
  reset() {
    this.trades = [];
    this.strategies.clear();
    this.portfolio = {
      initialCapital: 0,
      currentCapital: 0,
      equity: [],
      drawdown: []
    };
  }
}

export default AnalyticsEngine;
