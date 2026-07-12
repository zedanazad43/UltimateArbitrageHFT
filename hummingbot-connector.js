#!/usr/bin/env node
// Hummingbot Auto-Trading Connector
// Bridges Hummingbot to Railway HFT Engine via geo-bypassed Cloudflare Worker

import fetch from 'node-fetch';
import { WebSocket } from 'ws';

const CONFIG = {
  WORKER_URL: 'https://ultimatearbitragehft.zedanazad43.workers.dev',
  RAILWAY_HFT_URL: process.env.HFT_ENGINE_URL || 'https://ultimatearbitragehft-production.up.railway.app',
  HUMMINGBOT_API: process.env.HUMMINGBOT_API_URL || 'http://localhost:8000',
  POLLING_INTERVAL: 5000,
  MAX_RETRIES: 3,
};

class HummingbotConnector {
  constructor() {
    this.isRunning = false;
    this.activeStrategies = new Map();
    this.executionQueue = [];
  }

  async start() {
    console.log('🤖 Hummingbot Auto-Trading Connector Starting...');
    this.isRunning = true;

    try {
      await this.initializeHummingbot();
      await this.monitorOpportunities();
    } catch (error) {
      console.error('❌ Connector error:', error.message);
      this.isRunning = false;
    }
  }

  async initializeHummingbot() {
    console.log('📡 Initializing Hummingbot connection...');

    try {
      const response = await fetch(`${CONFIG.HUMMINGBOT_API}/status`, {
        method: 'GET',
        timeout: 5000,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const status = await response.json();
      console.log('✅ Hummingbot connected');
      console.log(`   Mode: ${status.mode}`);
      console.log(`   Balance: ${JSON.stringify(status.balances || {})}`);

      return status;
    } catch (error) {
      console.error('❌ Cannot connect to Hummingbot:', error.message);
      throw error;
    }
  }

  async monitorOpportunities() {
    console.log('🔍 Monitoring arbitrage opportunities...');

    while (this.isRunning) {
      try {
        const opportunities = await this.fetchOpportunities();

        if (opportunities.length > 0) {
          console.log(`📊 Found ${opportunities.length} opportunities`);
          await this.processOpportunities(opportunities);
        }

        await this.sleep(CONFIG.POLLING_INTERVAL);
      } catch (error) {
        console.error('❌ Monitoring error:', error.message);
        await this.sleep(CONFIG.POLLING_INTERVAL * 2);
      }
    }
  }

  async fetchOpportunities() {
    try {
      // Get opportunities from Railway HFT Engine via geo-bypass Worker
      const response = await fetch(`${CONFIG.WORKER_URL}/hft/opportunities`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        timeout: 10000,
      });

      if (!response.ok) {
        if (response.status === 429) {
          console.warn('⚠️  Rate limited, retrying...');
          await this.sleep(5000);
          return [];
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      return Array.isArray(data.opportunities) ? data.opportunities : [];
    } catch (error) {
      console.error('❌ Fetch error:', error.message);
      return [];
    }
  }

  async processOpportunities(opportunities) {
    for (const opp of opportunities) {
      try {
        // Validate opportunity
        if (!this.validateOpportunity(opp)) {
          console.warn(`⚠️  Invalid opportunity: ${opp.id}`);
          continue;
        }

        // Queue for execution
        await this.executeOpportunity(opp);
      } catch (error) {
        console.error(`❌ Processing error for ${opp.id}:`, error.message);
      }
    }
  }

  validateOpportunity(opp) {
    return (
      opp.id &&
      opp.buyExchange && opp.sellExchange &&
      opp.symbol &&
      opp.buyPrice > 0 &&
      opp.sellPrice > 0 &&
      opp.profit > 0.5 // Minimum 0.5% profit
    );
  }

  async executeOpportunity(opp) {
    console.log(`⚡ Executing: ${opp.symbol} ${opp.buyExchange} → ${opp.sellExchange} (+${opp.profit.toFixed(2)}%)`);

    try {
      // Send execution request to Hummingbot
      const execution = await this.sendHummingbotOrder({
        symbol: opp.symbol,
        buyExchange: opp.buyExchange,
        sellExchange: opp.sellExchange,
        buyPrice: opp.buyPrice,
        sellPrice: opp.sellPrice,
        quantity: opp.quantity || 1,
        profitMargin: opp.profit,
      });

      // Log to Railway HFT for analytics
      await this.logExecution(execution);

      console.log(`✅ Execution queued: ${execution.orderId}`);
      return execution;
    } catch (error) {
      console.error(`❌ Execution failed: ${error.message}`);
      throw error;
    }
  }

  async sendHummingbotOrder(order) {
    const payload = {
      action: 'place_order',
      orders: [
        {
          exchange: order.buyExchange,
          symbol: order.symbol,
          side: 'buy',
          quantity: order.quantity,
          price: order.buyPrice,
          timeInForce: 'IOC',
        },
        {
          exchange: order.sellExchange,
          symbol: order.symbol,
          side: 'sell',
          quantity: order.quantity,
          price: order.sellPrice,
          timeInForce: 'IOC',
        },
      ],
    };

    const response = await fetch(`${CONFIG.HUMMINGBOT_API}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: 8000,
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const result = await response.json();
    return {
      orderId: result.id || `hmb-${Date.now()}`,
      status: 'submitted',
      timestamp: new Date().toISOString(),
      ...order,
    };
  }

  async logExecution(execution) {
    try {
      await fetch(`${CONFIG.WORKER_URL}/hft/execution-log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(execution),
        timeout: 5000,
      });
    } catch (error) {
      console.warn('⚠️  Log submission failed:', error.message);
    }
  }

  async stop() {
    console.log('\n🛑 Shutting down connector...');
    this.isRunning = false;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Main execution
const connector = new HummingbotConnector();

process.on('SIGINT', async () => {
  await connector.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await connector.stop();
  process.exit(0);
});

connector.start().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
