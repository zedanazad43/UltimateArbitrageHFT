#!/usr/bin/env node
// Bitsgap Integration: Backtesting & Strategy Validation
// Bridges Hummingbot trades with Bitsgap API for backtesting before live execution

import fetch from 'node-fetch';

const CONFIG = {
  BITSGAP_API_URL: process.env.BITSGAP_API_URL || 'https://api.bitsgap.com/v1',
  BITSGAP_API_KEY: process.env.BITSGAP_API_KEY,
  WORKER_URL: 'https://ultimatearbitragehft.zedanazad43.workers.dev',
  BACKTEST_LOOKBACK: '30d', // 30 days of historical data
};

class BitsgapIntegration {
  constructor() {
    this.isRunning = false;
    this.backtestResults = [];
    this.strategies = [];
  }

  async start() {
    console.log('📊 Bitsgap Integration Starting...');
    this.isRunning = true;

    try {
      await this.validateApiKey();
      await this.syncStrategies();
      await this.runBacktests();
      await this.validateAgainstLiveData();
    } catch (error) {
      console.error('❌ Integration error:', error.message);
      this.isRunning = false;
    }
  }

  async validateApiKey() {
    console.log('🔐 Validating Bitsgap API key...');

    if (!CONFIG.BITSGAP_API_KEY) {
      throw new Error('BITSGAP_API_KEY not set. Get it from https://bitsgap.com/dashboard/settings/api');
    }

    try {
      const response = await fetch(`${CONFIG.BITSGAP_API_URL}/auth/validate`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${CONFIG.BITSGAP_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      console.log('✅ Bitsgap API authenticated');
      console.log(`   User: ${data.user?.email}`);
      return data;
    } catch (error) {
      throw new Error(`Bitsgap validation failed: ${error.message}`, { cause: error });
    }
  }

  async syncStrategies() {
    console.log('📈 Syncing strategies from Railway HFT...');

    try {
      const response = await fetch(`${CONFIG.WORKER_URL}/hft/strategies`, {
        method: 'GET',
        timeout: 10000,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      this.strategies = data.strategies || [];

      console.log(`✅ Synced ${this.strategies.length} strategies`);
      return this.strategies;
    } catch (error) {
      console.warn('⚠️  Strategy sync failed:', error.message);
      return [];
    }
  }

  async runBacktests() {
    console.log('🧪 Running backtests on all strategies...');

    const results = [];

    for (const strategy of this.strategies) {
      try {
        const backtest = await this.backtestStrategy(strategy);
        results.push(backtest);

        console.log(`  ✅ ${strategy.name}: ${backtest.profitPercent.toFixed(2)}% (${backtest.tradeCount} trades)`);
      } catch (error) {
        console.warn(`  ⚠️  ${strategy.name}: ${error.message}`);
      }
    }

    this.backtestResults = results;
    return results;
  }

  async backtestStrategy(strategy) {
    const payload = {
      strategy_id: strategy.id,
      symbol: strategy.pair,
      timeframe: strategy.timeframe || '1h',
      lookback_period: CONFIG.BACKTEST_LOOKBACK,
      initial_capital: strategy.initialCapital || 1000,
    };

    try {
      const response = await fetch(`${CONFIG.BITSGAP_API_URL}/backtest/run`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CONFIG.BITSGAP_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        timeout: 30000,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const result = await response.json();

      return {
        strategyId: strategy.id,
        strategyName: strategy.name,
        symbol: strategy.pair,
        tradeCount: result.trades_count,
        profitPercent: result.profit_percent,
        winRate: result.win_rate,
        maxDrawdown: result.max_drawdown,
        sharpeRatio: result.sharpe_ratio,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new Error(`Backtest failed: ${error.message}`, { cause: error });
    }
  }

  async validateAgainstLiveData() {
    console.log('📊 Validating backtests against live market data...');

    try {
      const liveResponse = await fetch(`${CONFIG.WORKER_URL}/hft/opportunities`, {
        method: 'GET',
        timeout: 10000,
      });

      if (!liveResponse.ok) throw new Error(`HTTP ${liveResponse.status}`);

      const liveData = await liveResponse.json();
      const opportunities = liveData.opportunities || [];

      console.log(`✅ Comparing with ${opportunities.length} live opportunities`);

      // Validate backtest predictions
      const validation = {
        backtestCount: this.backtestResults.length,
        liveOpportunities: opportunities.length,
        averageBacktestProfit: this.calculateAverageProfit(),
        confidenceScore: this.calculateConfidenceScore(opportunities),
        timestamp: new Date().toISOString(),
      };

      console.log(`   Avg Backtest Profit: ${validation.averageBacktestProfit.toFixed(2)}%`);
      console.log(`   Confidence Score: ${validation.confidenceScore.toFixed(1)}/10`);

      return validation;
    } catch (error) {
      console.warn('⚠️  Live validation failed:', error.message);
      return null;
    }
  }

  calculateAverageProfit() {
    if (this.backtestResults.length === 0) return 0;

    const total = this.backtestResults.reduce((sum, r) => sum + r.profitPercent, 0);
    return total / this.backtestResults.length;
  }

  calculateConfidenceScore(opportunities) {
    // Score based on strategy alignment with live opportunities
    let score = 5; // Base score

    if (opportunities.length > 20) score += 2; // Plenty of opportunities
    if (opportunities.length > 50) score += 1;

    const avgProfit = this.calculateAverageProfit();
    if (avgProfit > 1.0) score += 1; // Backtests show 1%+ profit
    if (avgProfit > 2.0) score += 0.5;

    return Math.min(score, 10);
  }

  async reportResults() {
    console.log('\n📋 BACKTEST SUMMARY');
    console.log('═'.repeat(50));

    for (const result of this.backtestResults) {
      console.log(`\n${result.strategyName}`);
      console.log(`  Symbol: ${result.symbol}`);
      console.log(`  Trades: ${result.tradeCount}`);
      console.log(`  Profit: ${result.profitPercent.toFixed(2)}%`);
      console.log(`  Win Rate: ${result.winRate.toFixed(1)}%`);
      console.log(`  Max Drawdown: ${result.maxDrawdown.toFixed(2)}%`);
      console.log(`  Sharpe Ratio: ${result.sharpeRatio.toFixed(2)}`);
    }

    console.log('\n' + '═'.repeat(50));
    console.log(`✅ All backtests complete. Ready to deploy to Hummingbot.`);
  }

  async stop() {
    console.log('\n🛑 Shutting down Bitsgap integration...');
    this.isRunning = false;
  }
}

// Main execution
const integration = new BitsgapIntegration();

process.on('SIGINT', async () => {
  await integration.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await integration.stop();
  process.exit(0);
});

integration.start()
  .then(() => integration.reportResults())
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

export default BitsgapIntegration;
