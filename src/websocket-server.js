// src/websocket-server.js — High-performance WebSocket server for real-time data

import { WebSocketServer, WebSocket } from 'ws';
import { createWriteStream as _createWriteStream } from 'fs';
import { AsyncLogger } from './utils/async-logger.js';
import { KillSwitch } from './infra/kill-switch.js';

const PORT = process.env.WS_PORT || 8788;
const MAX_MESSAGE_SIZE = 1024 * 1024; // 1MB max message
const HEARTBEAT_INTERVAL = 30000; // 30s
const _CLIENT_TIMEOUT = 60000; // 60s

class WebSocketServerClass {
  constructor() {
    this.wss = null;
    this.clients = new Map();
    this.logger = new AsyncLogger();
    this.killSwitch = new KillSwitch();
    this.isRunning = false;
    this.broadcastQueue = [];
    this.isBroadcasting = false;
  }

  /**
   * Start WebSocket server with auto-reconnect
   */
  async start() {
    try {
      this.wss = new WebSocketServer({
        port: PORT,
        maxPayload: MAX_MESSAGE_SIZE,
        perMessageDeflate: {
          zlibDeflate: 9, // Max compression
          zlibInflate: 9,
          threshold: 1024
        }
      });

      this.wss.on('connection', (ws, _req) => {
        const clientId = Date.now().toString(36) + Math.random().toString(36).substr(2);
        this.clients.set(clientId, {
          ws,
          id: clientId,
          connectedAt: Date.now(),
          lastPing: Date.now(),
          messageCount: 0,
          errorCount: 0
        });

        // Send welcome message
        this._send(clientId, {
          type: 'connected',
          timestamp: Date.now(),
          serverTime: Date.now()
        });

        // Set heartbeat
        ws.isAlive = true;
        ws.on('pong', () => {
          ws.isAlive = true;
        });

        // Handle messages from client
        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            this._handleClientMessage(clientId, msg);
          } catch (err) {
            this.logger.warn('Invalid WS message', { error: err.message });
          }
        });

        // Handle disconnect
        ws.on('close', () => {
          this.clients.delete(clientId);
          this.logger.info('Client disconnected', { clientId });
        });

        ws.on('error', (err) => {
          const client = this.clients.get(clientId);
          if (client) client.errorCount++;
          this.logger.error('WS error', { clientId, error: err.message });
        });

        this.logger.info('Client connected', { clientId });
      });

      // Start heartbeat
      this._startHeartbeat();

      // Subscribe to data streams
      this._subscribeToDataStreams();

      this.isRunning = true;
      this.logger.info('WebSocket server started', { port: PORT });
      
      return { success: true, port: PORT };
    } catch (err) {
      this.logger.error('Failed to start WS server', { error: err.message });
      throw err;
    }
  }

  /**
   * Handle messages from connected clients
   */
  _handleClientMessage(clientId, msg) {
    switch (msg.type) {
      case 'subscribe':
        this._handleSubscribe(clientId, msg.channels);
        break;
      case 'unsubscribe':
        this._handleUnsubscribe(clientId, msg.channels);
        break;
      case 'ping':
        this._send(clientId, { type: 'pong', timestamp: Date.now() });
        break;
      case 'command':
        this._handleCommand(clientId, msg.command);
        break;
      default:
        this.logger.warn('Unknown message type', { type: msg.type });
    }
  }

  /**
   * Subscribe client to data channels
   */
  _handleSubscribe(clientId, channels) {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.channels = client.channels || new Set();
    channels.forEach(ch => client.channels.add(ch));
    
    this.logger.info('Client subscribed', { clientId, channels });
  }

  /**
   * Unsubscribe client from data channels
   */
  _handleUnsubscribe(clientId, channels) {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.channels?.forEach(ch => {
      if (channels.includes(ch)) client.channels.delete(ch);
    });
  }

  /**
   * Handle control commands
   */
  _handleCommand(clientId, command) {
    const { action, _params } = command;
    
    switch (action) {
      case 'start_trading':
        this.killSwitch.enableTrading();
        this._broadcast({ type: 'system', event: 'trading_enabled' });
        break;
      case 'stop_trading':
        this.killSwitch.disableTrading();
        this._broadcast({ type: 'system', event: 'trading_disabled' });
        break;
      case 'emergency_stop':
        this.killSwitch.activate();
        this._broadcast({ 
          type: 'system', 
          event: 'emergency_stop',
          reason: 'Manual kill switch activation'
        });
        break;
      case 'request_stats':
        this._sendStats(clientId);
        break;
      default:
        this.logger.warn('Unknown command', { action });
    }
  }

  /**
   * Subscribe to data streams (prices, orders, spreads)
   */
  _subscribeToDataStreams() {
    // Stream price updates (throttled to 100ms)
    setInterval(() => {
      this._broadcastPrices();
    }, 100);

    // Stream order updates (real-time)
    this._setupOrderStream();

    // Stream spread updates
    setInterval(() => {
      this._broadcastSpreads();
    }, 200);

    // Stream PNL updates
    setInterval(() => {
      this._broadcastPNL();
    }, 1000);

    // Stream system health
    setInterval(() => {
      this._broadcastHealth();
    }, 5000);
  }

  /**
   * Broadcast prices to subscribers
   */
  _broadcastPrices() {
    if (!this.killSwitch.isHealthy) return;

    const prices = this._getLatestPrices(); // From price engine
    
    this._broadcastFiltered('price_update', prices, ['prices', 'all']);
  }

  /**
   * Setup order streaming
   */
  _setupOrderStream() {
    // This connects to the order execution engine
    // Orders are pushed to WebSocket in real-time
    const orderStream = this._createOrderStream();
    
    orderStream.on('order', (order) => {
      this._broadcastFiltered('order_update', order, ['orders', 'all']);
    });
  }

  /**
   * Broadcast spreads
   */
  _broadcastSpreads() {
    if (!this.killSwitch.isHealthy) return;

    const spreads = this._getLatestSpreads(); // From spread engine
    
    this._broadcastFiltered('spread_update', spreads, ['spreads', 'all']);
  }

  /**
   * Broadcast PNL
   */
  _broadcastPNL() {
    const pnlData = this._getLatestPNL();
    this._broadcastFiltered('pnl_update', pnlData, ['pnl', 'all']);
  }

  /**
   * Broadcast system health
   */
  _broadcastHealth() {
    const health = {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      clients: this.clients.size,
      latency: this.killSwitch.getLatency(),
      is_healthy: this.killSwitch.isHealthy,
      timestamp: Date.now()
    };

    this._broadcastFiltered('health', health, ['health', 'all']);
  }

  /**
   * Send stats to specific client
   */
  _sendStats(clientId) {
    const stats = {
      type: 'stats',
      data: {
        connectedClients: this.clients.size,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        messageQueue: this.broadcastQueue.length,
        killSwitch: {
          active: this.killSwitch.isActive,
          isHealthy: this.killSwitch.isHealthy
        }
      },
      timestamp: Date.now()
    };

    this._send(clientId, stats);
  }

  /**
   * Broadcast message to all or filtered subscribers
   */
  _broadcast(type, data, filterChannels = ['all']) {
    const message = JSON.stringify({
      type,
      data,
      timestamp: Date.now()
    });

    this.broadcastQueue.push({ message, filterChannels });
    this._flushQueue();
  }

  _broadcastFiltered(type, data, filterChannels) {
    this._broadcast(type, data, filterChannels);
  }

  /**
   * Flush broadcast queue efficiently
   */
  async _flushQueue() {
    if (this.isBroadcasting || this.broadcastQueue.length === 0) return;
    
    this.isBroadcasting = true;

    while (this.broadcastQueue.length > 0) {
      const { message, filterChannels } = this.broadcastQueue.shift();
      
      for (const [_clientId, client] of this.clients) {
        try {
          if (client.ws.readyState === WebSocket.OPEN) {
            if (filterChannels.includes('all') || client.channels?.has('all') || 
                filterChannels.some(ch => client.channels?.has(ch))) {
              client.ws.send(message);
              client.messageCount++;
            }
          }
        } catch (err) {
          this.logger.error('Send failed', { clientId: _clientId, error: err.message });
        }
      }
    }

    this.isBroadcasting = false;
  }

  /**
   * Send message to specific client
   */
  _send(clientId, data) {
    const client = this.clients.get(clientId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) return;

    try {
      const message = JSON.stringify({
        ...data,
        timestamp: Date.now()
      });
      client.ws.send(message);
      client.messageCount++;
    } catch (err) {
      this.logger.error('Send failed', { clientId: _clientId, error: err.message });
    }
  }

  /**
   * Heartbeat mechanism
   */
  _startHeartbeat() {
    setInterval(() => {
      for (const [_clientId, client] of this.clients) {
        if (!client.ws.isAlive) {
          this.clients.delete(_clientId);
          this.logger.warn('Client timeout', { clientId: _clientId });
          continue;
        }

        client.ws.isAlive = false;
        client.ws.ping();
      }
    }, HEARTBEAT_INTERVAL);
  }

  /**
   * Get latest prices (mock - replace with actual price engine)
   */
  _getLatestPrices() {
    // This would connect to real price data
    return {};
  }

  /**
   * Get latest spreads (mock - replace with actual spread engine)
   */
  _getLatestSpreads() {
    return {};
  }

  /**
   * Get latest PNL (mock - replace with actual PNL engine)
   */
  _getLatestPNL() {
    return {};
  }

  /**
   * Create order stream
   */
  _createOrderStream() {
    return {
      on: () => {},
      emit: () => {}
    };
  }

  /**
   * Graceful shutdown
   */
  async stop() {
    this.isRunning = false;
    
    // Close all clients
    for (const [_clientId, client] of this.clients) {
      client.ws.close(1000, 'Server shutting down');
    }

    // Close server
    if (this.wss) {
      await new Promise(resolve => this.wss.close(resolve));
    }

    await this.logger.flush();
    this.logger.info('WebSocket server stopped');
  }
}

// Export singleton instance
export const wsServer = new WebSocketServerClass();
