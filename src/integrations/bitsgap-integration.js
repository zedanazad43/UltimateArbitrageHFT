#!/usr/bin/env node
// Bitsgap Integration: Backtesting & Strategy Validation
// Bridges local backtest/reporting APIs before live execution.
// Uses Worker-deployed endpoints from this repo.

const CONFIG = {
  BITSGAP_API_URL: process.env.BITSGAP_API_URL || 'https://api.bitsgap.com/v1',
  BITSGAP_API_KEY: process.env.BITSGAP_API_KEY,
  WORKER_URL: 'https://ultimatearbitragehft.zedanazad43.workers.dev',
  BACKTEST_LOOKBACK_DAYS: 30,
  ADMIN_TOKEN: process.env.ADMIN_TOKEN || '',
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
      if (CONFIG.BITSGAP_API_KEY) {
        await this.validateApiKey();
      } else {
        console.warn('⚠️  BITSGAP_API_KEY not set; running local backtest only.');
      }
      await this.runLocalBacktests();
      await this.validateAgainstLiveData();
    } catch (error) {
      console.error('❌ Integration error:', error.message);
      this.isRunning = false;
    }
  }

  async validateApiKey() {
    console.log('🔐 Validating Bitsgap API key...');
    try {
      const response = await fetch(`${CONFIG.BITSGAP_API_URL}/auth/validate`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${CONFIG.BITSGAP_API_KEY}`,
          'Content-Type': 'application/json',
        },
        // Node 18+ global fetch; no timeout polyfill here.
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      console.log('✅ Bitsgap API authenticated');
      console.log(`   User: ${data?.user?.email || 'unknown'}`);
      return data;
    } catch (error) {
      throw new Error(`Bitsgap validation failed: ${error.message}`);
    }
  }

  async runLocalBacktests() {
    const adminHeaders = CONFIG.ADMIN_TOKEN ? { 'x-admin-token': CONFIG.ADMIN_TOKEN } : {};
    console.log('🧪 Running local Worker backtest...');
    const toMs = Date.now();
    const fromMs = toMs - CONFIG.BACKTEST_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

    try {
      const response = await fetch(`${CONFIG.WORKER_URL}/api/backtest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...adminHeaders },
        body: JSON.stringify({
          from_ms: fromMs,
          to_ms: toMs,
          initial_capital: 1000,
          run_monte_carlo: true,
          run_param_sweep: true,
        }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const results = await response.json();

      const entry = {
        strategyId: 'worker-local',
        strategyName: 'LocalWorkerBacktest',
        symbol: 'multi',
        tradeCount: results.trade_count || 0,
        profitPercent: results.return_pct || 0,
        winRate: results.metrics?.win_rate ? results.metrics.win_rate * 100 : 0,
        maxDrawdown: results.metrics?.max_drawdown_pct || 0,
        sharpeRatio: results.metrics?.sharpe || 0,
        timestamp: new Date().toISOString(),
      };

      this.backtestResults = [entry];
      console.log(`   Trades: ${entry.tradeCount}`);
      console.log(`   Return: ${entry.profitPercent.toFixed(2)}%`);
      console.log(`   Sharpe: ${entry.sharpeRatio.toFixed(3)}`);
      return results;
    } catch (error) {
      console.warn('⚠️  Local backtest failed:', error.message);
      return null;
    }
  }

  async validateAgainstLiveData() {
    const adminHeaders = CONFIG.ADMIN_TOKEN ? { 'x-admin-token': CONFIG.ADMIN_TOKEN } : {};
    console.log('📊 Validating against live market data...');

    try {
      const response = await fetch(`${CONFIG.WORKER_URL}/api/opportunities/recent?limit=50`, {
        headers: adminHeaders,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      const opportunities = Array.isArray(data?.items) ? data.items : [];

      console.log(`✅ Comparing with ${opportunities.length} recent opportunities`);

      const validation = {
        backtestCount: this.backtestResults.length,
        liveOpportunities: opportunities.length,
        averageBacktestProfit: this.calculateAverageProfit(),
        confidenceScore: this.calculateConfidenceScore(opportunities),
        timestamp: new Date().toISOString(),
      };

      console.log(`   Avg Backtest Return: ${validation.averageBacktestProfit.toFixed(2)}%`);
      console.log(`   Confidence Score: ${validation.confidenceScore.toFixed(1)}/10`);
      return validation;
    } catch (error) {
      console.warn('⚠️  Live validation failed:', error.message);
      return null;
    }
  }

  calculateAverageProfit() {
    if (this.backtestResults.length === 0) return 0;
    const total = this.backtestResults.reduce((s, r) => s + (r.profitPercent || 0), 0);
    return total / this.backtestResults.length;
  }

  calculateConfidenceScore(opportunities) {
    let score = 5;
    if (opportunities.length > 20) score += 2;
    if (opportunities.length > 50) score += 1;
    const avgProfit = this.calculateAverageProfit();
    if (avgProfit > 1.0) score += 1;
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
      console.log(`  Return: ${result.profitPercent.toFixed(2)}%`);
      console.log(`  Win Rate: ${result.winRate.toFixed(1)}%`);
      console.log(`  Max Drawdown: ${result.maxDrawdown.toFixed(2)}%`);
      console.log(`  Sharpe Ratio: ${result.sharpeRatio.toFixed(2)}`);
    }
    console.log('\n' + '═'.repeat(50));
    console.log('✅ Bitsgap integration complete.');
  }

  async stop() {
    console.log('\n🛑 Shutting down Bitsgap integration...');
    this.isRunning = false;
  }
}

const integration = new BitsgapIntegration();
process.on('SIGINT', async () => { await integration.stop(); process.exit(0); });
process.on('SIGTERM', async () => { await integration.stop(); process.exit(0); });

integration.start()
  .then(() => integration.reportResults())
  .catch(error => { console.error('Fatal error:', error); process.exit(1); });

export default BitsgapIntegration;
