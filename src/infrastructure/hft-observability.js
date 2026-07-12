// Enhanced observability metrics for Railway + Cloudflare integration

export class HFTObservability {
  constructor(analyticsEngine, env) {
    this.analytics = analyticsEngine;
    this.env = env;
    this.metrics = {
      railwayLatency: [],
      failoverEvents: [],
      priceUpdateRate: [],
      opportunitiesDetected: [],
      circuitBreakerStateChanges: [],
    };
  }

  // Track Railway API latency
  async recordRailwayLatency(endpoint, latencyMs, success = true) {
    const metric = {
      timestamp: Date.now(),
      endpoint,
      latencyMs,
      success,
      location: this.env.CF_CONNECTING_IP || 'unknown',
      dataCenter: this.env.CF_COLO_REGION || 'unknown',
    };

    this.metrics.railwayLatency.push(metric);

    // Send to Analytics Engine
    if (this.analytics) {
      try {
        await this.analytics.writeDataPoint({
          indexes: ['railway_latency', endpoint],
          blobs: [success ? 'ok' : 'fail'],
          doubles: [latencyMs],
        });
      } catch (err) {
        console.error('Failed to log to Analytics Engine:', err);
      }
    }

    return metric;
  }

  // Track failover events
  async recordFailoverEvent(reason, from, to) {
    const event = {
      timestamp: Date.now(),
      reason,
      from, // 'railway' | 'cloudflare'
      to,   // 'cloudflare' | 'railway'
      severity: reason.includes('critical') ? 'critical' : 'warning',
    };

    this.metrics.failoverEvents.push(event);

    if (this.analytics) {
      try {
        await this.analytics.writeDataPoint({
          indexes: ['failover_event', reason],
          blobs: [`${from}_to_${to}`],
          doubles: [1],
        });
      } catch (err) {
        console.error('Failed to log failover event:', err);
      }
    }

    return event;
  }

  // Track price update frequency
  async recordPriceUpdate(symbol, exchange, updateCount) {
    const event = {
      timestamp: Date.now(),
      symbol,
      exchange,
      updateCount,
      ratePerSecond: updateCount, // Simplified
    };

    if (this.analytics) {
      try {
        await this.analytics.writeDataPoint({
          indexes: ['price_update', symbol, exchange],
          blobs: ['update'],
          doubles: [updateCount],
        });
      } catch (err) {
        console.error('Failed to log price update:', err);
      }
    }

    return event;
  }

  // Track detected opportunities
  async recordOpportunity(opportunity) {
    const event = {
      timestamp: Date.now(),
      strategy: opportunity.strategy,
      symbol: opportunity.symbol,
      spreadPct: opportunity.spreadPct,
      netPct: opportunity.netPct,
      sizeUsd: opportunity.sizeUsd,
      confidence: opportunity.confidence || 0.5,
    };

    this.metrics.opportunitiesDetected.push(event);

    if (this.analytics) {
      try {
        await this.analytics.writeDataPoint({
          indexes: ['opportunity', opportunity.strategy, opportunity.symbol],
          blobs: [opportunity.strategy],
          doubles: [opportunity.netPct, opportunity.sizeUsd, opportunity.confidence],
        });
      } catch (err) {
        console.error('Failed to log opportunity:', err);
      }
    }

    return event;
  }

  // Track circuit breaker state transitions
  async recordCircuitBreakerStateChange(oldState, newState, reason) {
    const event = {
      timestamp: Date.now(),
      oldState,
      newState,
      reason,
      severity: newState === 'open' ? 'critical' : 'info',
    };

    this.metrics.circuitBreakerStateChanges.push(event);

    if (this.analytics) {
      try {
        await this.analytics.writeDataPoint({
          indexes: ['circuit_breaker', newState],
          blobs: [reason],
          doubles: [newState === 'open' ? 1 : 0],
        });
      } catch (err) {
        console.error('Failed to log circuit breaker change:', err);
      }
    }

    return event;
  }

  // Track D1 backup sync
  async recordD1Backup(backupType, recordCount, durationMs) {
    const event = {
      timestamp: Date.now(),
      backupType, // 'positions' | 'prices' | 'opportunities'
      recordCount,
      durationMs,
      success: durationMs < 1000, // Acceptable if < 1s
    };

    if (this.analytics) {
      try {
        await this.analytics.writeDataPoint({
          indexes: ['d1_backup', backupType],
          blobs: [event.success ? 'ok' : 'slow'],
          doubles: [durationMs, recordCount],
        });
      } catch (err) {
        console.error('Failed to log D1 backup:', err);
      }
    }

    return event;
  }

  // Generate health report
  async getHealthReport() {
    const avgRailwayLatency =
      this.metrics.railwayLatency.length > 0
        ? (
          this.metrics.railwayLatency.reduce((sum, m) => sum + m.latencyMs, 0) /
          this.metrics.railwayLatency.length
        ).toFixed(2)
        : 'N/A';

    const failoverCount = this.metrics.failoverEvents.length;
    const criticalFailovers = this.metrics.failoverEvents.filter(
      (e) => e.severity === 'critical'
    ).length;

    const opportunityRate =
      this.metrics.opportunitiesDetected.length > 0
        ? (
          this.metrics.opportunitiesDetected.length /
          ((Date.now() - this.metrics.opportunitiesDetected[0].timestamp) / 3600000)
        ).toFixed(2)
        : 0;

    const circuitBreakerAlerts = this.metrics.circuitBreakerStateChanges.filter(
      (e) => e.newState === 'open'
    ).length;

    return {
      timestamp: Date.now(),
      status: criticalFailovers > 0 ? 'warning' : 'healthy',
      metrics: {
        avgRailwayLatencyMs: avgRailwayLatency,
        totalFailovers: failoverCount,
        criticalFailovers,
        opportunitiesPerHour: opportunityRate,
        circuitBreakerTrips: circuitBreakerAlerts,
      },
      recommendations: this.generateRecommendations({
        avgRailwayLatency: parseFloat(avgRailwayLatency),
        failoverCount,
        opportunityRate: parseFloat(opportunityRate),
      }),
    };
  }

  generateRecommendations(metrics) {
    const recommendations = [];

    if (metrics.avgRailwayLatency > 1000) {
      recommendations.push('⚠️ Railway latency > 1s, consider investigation');
    }
    if (metrics.failoverCount > 5) {
      recommendations.push('🔴 High failover rate, check Railway stability');
    }
    if (metrics.opportunityRate < 1) {
      recommendations.push(
        '⚠️ Low opportunity detection rate, verify price feeds'
      );
    }
    if (recommendations.length === 0) {
      recommendations.push('✅ System operating within normal parameters');
    }

    return recommendations;
  }

  // Clear old metrics (keep last hour)
  async cleanup() {
    const oneHourAgo = Date.now() - 3600000;
    this.metrics.railwayLatency = this.metrics.railwayLatency.filter(
      (m) => m.timestamp > oneHourAgo
    );
    this.metrics.failoverEvents = this.metrics.failoverEvents.filter(
      (m) => m.timestamp > oneHourAgo
    );
    this.metrics.opportunitiesDetected = this.metrics.opportunitiesDetected.filter(
      (m) => m.timestamp > oneHourAgo
    );
    this.metrics.circuitBreakerStateChanges =
      this.metrics.circuitBreakerStateChanges.filter(
        (m) => m.timestamp > oneHourAgo
      );
  }
}

export function getHFTObservability(analyticsEngine, env) {
  return new HFTObservability(analyticsEngine, env);
}
