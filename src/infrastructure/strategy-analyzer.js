// src/infrastructure/strategy-analyzer.js
// Diagnose why no opportunities are detected

export class StrategyAnalyzer {
  constructor(db, env) {
    this.db = db;
    this.env = env;
  }

  async diagnoseEmptyStreak(streakLength = 10) {
    console.log(`[StrategyAnalyzer] Diagnosing ${streakLength}+ minute opportunity drought`);

    const diagnostics = {
      timestamp: Date.now(),
      streakLength,
      possibleCauses: [],
      recommendations: [],
      metrics: {},
    };

    try {
      // 1. Check recent trades to verify execution happened
      const recentTrades = await this.db.prepare(`
        SELECT strategy, COUNT(*) as count, AVG(net_profit_percent) as avg_pnl
        FROM trades
        WHERE created_at > ?
        GROUP BY strategy
        ORDER BY created_at DESC
        LIMIT 10
      `).bind(Date.now() - 3600000).all();

      diagnostics.metrics.recentTradesByStrategy = recentTrades.results || [];

      // 2. Check if scanning is running
      if (!recentTrades.results || recentTrades.results.length === 0) {
        diagnostics.possibleCauses.push('❌ No trades in last hour - scanning may be paused');
        diagnostics.recommendations.push('✅ Check if scanner is running: npm run monitor:critical');
      }

      // 3. Check spread parameters
      const spreadChecks = {
        CEX_MAX_SPREAD: this.env.MAX_SPREAD_PCT || 5,
        SCALP_MIN_NET: this.env.SCALP_MIN_NET_PCT || 0.1,
        DEX_MIN_PROFIT: 0.05, // Typical threshold
      };
      diagnostics.metrics.spreadParams = spreadChecks;

      if (parseFloat(spreadChecks.CEX_MAX_SPREAD) > 7) {
        diagnostics.possibleCauses.push('⚠️ Spread cap too high (>7%) - too restrictive');
        diagnostics.recommendations.push('✅ Reduce MAX_SPREAD_PCT in wrangler.toml');
      }

      // 4. Check exchange availability
      const execExchanges = (this.env.EXECUTION_EXCHANGES_ALLOWLIST || '').split(',');
      diagnostics.metrics.allowedExchanges = execExchanges;

      if (execExchanges.length < 3) {
        diagnostics.possibleCauses.push('⚠️ Only ' + execExchanges.length + ' exchanges enabled');
        diagnostics.recommendations.push('✅ Enable more exchanges in EXECUTION_EXCHANGES_ALLOWLIST');
      }

      // 5. Check if strategies are enabled
      const strategyFlags = {
        cex: this.env.STRATEGY_ENABLED_CEX !== 'false',
        dex: this.env.STRATEGY_ENABLED_DEX !== 'false',
        triangular: this.env.STRATEGY_ENABLED_TRIANGULAR !== 'false',
        perps: this.env.STRATEGY_ENABLED_PERPS !== 'false',
      };
      diagnostics.metrics.enabledStrategies = strategyFlags;

      const disabledStrategies = Object.entries(strategyFlags)
        .filter(([_, enabled]) => !enabled)
        .map(([name]) => name);

      if (disabledStrategies.length > 0) {
        diagnostics.possibleCauses.push(
          `⚠️ ${disabledStrategies.length} strategies disabled: ${disabledStrategies.join(', ')}`
        );
        diagnostics.recommendations.push('✅ Enable strategies in config');
      }

      // 6. Check price feed health
      const symbolCount = this.env.SYMBOL_COUNT_CACHED || 0;
      diagnostics.metrics.symbolsCached = symbolCount;

      if (symbolCount < 100) {
        diagnostics.possibleCauses.push(`⚠️ Only ${symbolCount} symbols cached - insufficient coverage`);
        diagnostics.recommendations.push('✅ Run symbol prewarming: npm run check:symbol-catalog');
      }

      // 7. Check for geo-blocking (most likely culprit!)
      if (this.env.CF_COUNTRY === 'US') {
        diagnostics.possibleCauses.push('🌍 🔴 GEO-BLOCKING DETECTED: US region detected');
        diagnostics.recommendations.push('✅ Enable proxy: set BRIGHT_DATA_USER and BRIGHT_DATA_PASSWORD');
        diagnostics.recommendations.push('✅ Or use VPN routing via Cloudflare Tunnel');
      }

      // 8. Check API rate limiting
      const rateLimitHits = await this.db.prepare(`
        SELECT COUNT(*) as count FROM logs
        WHERE message LIKE '%429%' OR message LIKE '%rate%'
        AND created_at > ?
      `).bind(Date.now() - 600000).first();

      if (rateLimitHits && rateLimitHits.count > 5) {
        diagnostics.possibleCauses.push('⚠️ Rate limit hits detected - API throttled');
        diagnostics.recommendations.push('✅ Reduce scan frequency or increase delays');
      }

      // 9. Primary diagnosis summary
      if (diagnostics.possibleCauses.length === 0) {
        diagnostics.possibleCauses.push('✅ System appears healthy - market conditions may simply lack opportunities');
        diagnostics.recommendations.push('💡 Monitor spread caps and symbol diversity');
      }

    } catch (err) {
      diagnostics.error = err.message;
      diagnostics.recommendations.push('❌ Diagnosis failed, check server logs');
    }

    return diagnostics;
  }

  async getStrategyPerformance(hoursBack = 24) {
    const result = await this.db.prepare(`
      SELECT
        strategy,
        COUNT(*) as total_trades,
        SUM(CASE WHEN net_profit_percent > 0 THEN 1 ELSE 0 END) as winning_trades,
        AVG(net_profit_percent) as avg_pnl_pct,
        MAX(net_profit_percent) as best_trade,
        MIN(net_profit_percent) as worst_trade
      FROM trades
      WHERE created_at > ? AND mode = 'live'
      GROUP BY strategy
      ORDER BY avg_pnl_pct DESC
    `).bind(Date.now() - hoursBack * 3600000).all();

    return (result.results || []).map(row => ({
      ...row,
      winRate: row.total_trades > 0 ? (row.winning_trades / row.total_trades * 100).toFixed(1) + '%' : 'N/A',
    }));
  }

  async recommendTunables() {
    return {
      ifNoOpportunities: {
        '📈 Increase spread cap': 'MAX_SPREAD_PCT: 5 → 8',
        '📊 Reduce minimum profit': 'SCALP_MIN_NET_PCT: 0.1 → 0.05',
        '🌐 Enable more exchanges': 'Add to EXECUTION_EXCHANGES_ALLOWLIST',
        '🚀 Enable all strategies': 'Set all STRATEGY_ENABLED_* to true',
      },
      ifRateLimited: {
        '⏱️ Add delays': 'MIN_SECONDS_BETWEEN_TRADES: 1 → 5',
        '🔄 Reduce scan frequency': 'Increase cron interval',
        '📦 Batch requests': 'Use bulk API endpoints',
      },
      ifGeoBlocked: {
        '🌍 Setup proxy': 'Configure BRIGHT_DATA credentials',
        '🔐 Use Tunnel': 'Setup Cloudflare Tunnel with geographic routing',
        '🗺️ Select non-US exchanges': 'Use DIRECT_EXCHANGES setting',
      },
    };
  }
}

export function getStrategyAnalyzer(db, env) {
  return new StrategyAnalyzer(db, env);
}
