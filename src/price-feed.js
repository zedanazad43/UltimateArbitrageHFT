// src/price-feed.js — Node-only WebSocket price feed manager (NOT for Cloudflare Worker)
// Runs in the standalone Node process alongside websocket-server.js

import { WebSocket } from 'ws';
import { logger } from './utils/async-logger.js';
import { wsServer } from './websocket-server.js';

class PriceFeedManager {
  constructor() {
    this.connections = new Map();
    this.prices = new Map();
    this.isRunning = false;
  }

  connect(exchange, symbols) {
    if (this.connections.has(exchange)) {
      logger.info('WebSocket already connected', { exchange });
      return;
    }

    const wsUrl = this._getWsUrl(exchange, symbols);
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 1024 * 1024 });

    ws.on('open', () => {
      logger.info('WebSocket connected', { exchange, symbols });
      this._subscribe(ws, symbols);
    });

    ws.on('message', (data) => {
      try {
        this._handleMessage(exchange, JSON.parse(data.toString()));
      } catch (err) {
        logger.error('WS parse error', { exchange, error: err.message });
      }
    });

    ws.on('close', (code, reason) => {
      logger.info('WebSocket closed', { exchange, code, reason: reason.toString() });
      this._reconnect(exchange, symbols);
    });

    ws.on('error', (err) => {
      logger.error('WebSocket error', { exchange, error: err.message });
      wsServer?.killSwitch?.recordError();
    });

    this.connections.set(exchange, { ws, symbols, reconnectAttempts: 0 });
  }

  _handleMessage(exchange, msg) {
    switch (msg.type || msg.event) {
      case 'trade':
        this.prices.set(`${exchange}:${msg.symbol}`, {
          price: parseFloat(msg.price),
          quantity: parseFloat(msg.quantity),
          timestamp: Date.now(),
          side: msg.buyerIsMaker ? 'sell' : 'buy'
        });
        wsServer?._broadcastPrices();
        break;
      case 'depth':
        this.prices.set(`${exchange}:depth`, {
          bids: msg.bids?.slice(0, 10) || [],
          asks: msg.asks?.slice(0, 10) || [],
          timestamp: Date.now()
        });
        break;
      case 'ticker':
        if (msg.data) {
          msg.data.forEach(t => {
            this.prices.set(`${exchange}:${t.symbol}`, {
              lastPrice: parseFloat(t.lastPrice),
              volume: parseFloat(t.volume),
              priceChange: parseFloat(t.priceChangePercent)
            });
          });
        }
        break;
      default:
        logger.debug('Unknown WS message type', { type: msg.type });
    }
  }

  getPrice(exchange, symbol) { return this.prices.get(`${exchange}:${symbol}`); }
  getAllPrices() { return Object.fromEntries(this.prices); }

  _reconnect(exchange, symbols) {
    const conn = this.connections.get(exchange);
    if (!conn) return;
    conn.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, conn.reconnectAttempts), 30000);
    logger.info('Reconnecting WebSocket', { exchange, attempt: conn.reconnectAttempts, delay: delay + 'ms' });
    setTimeout(() => this.connect(exchange, symbols), delay);
  }

  _getWsUrl(exchange, symbols) {
    const urls = {
      binance: `wss://stream.binance.com:9443/ws/${symbols.map(s => `${s.toLowerCase()}@trade`).join('/')}`,
      mexc: 'wss://contract.mexc.com/ws',
      bitget: 'wss://ws.bitget.com/v2/ws/public',
      kucoin: 'wss://ws-api-eu.kucoin.com/endpoint',
      htx: 'wss://api.huotrack.com/v1/ws/ws-client'
    };
    return urls[exchange] || '';
  }

  _subscribe(ws, symbols) {
    // Exchange-specific subscription protocol
  }
}

export const priceFeed = new PriceFeedManager();
