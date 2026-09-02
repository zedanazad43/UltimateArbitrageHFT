// frontend/src/App.jsx — Main Dashboard Component

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { wsClient } from './lib/ws-client';
import './App.css';

// ── Components ───────────────────────────────────────────────────────────────

function StatusBadge({ connected }) {
  return (
    <span className={`status-badge ${connected ? 'online' : 'offline'}`}>
      {connected ? '● Connected' : '● Disconnected'}
    </span>
  );
}

function ControlPanel({ tradingEnabled, onToggleTrading, onEmergencyStop }) {
  return (
    <div className="panel">
      <h3>🎮 Control Panel</h3>
      <div className="controls">
        <button
          className={`btn ${tradingEnabled ? 'btn-warning' : 'btn-success'}`}
          onClick={onToggleTrading}
        >
          {tradingEnabled ? '⏹ Stop Trading' : '▶ Start Trading'}
        </button>
        <button className="btn btn-danger" onClick={onEmergencyStop}>
          🚨 Emergency Stop
        </button>
      </div>
    </div>
  );
}

function SpreadMonitor({ spreads }) {
  const sortedSpreads = useMemo(() => {
    return Object.entries(spreads)
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => b.spread - a.spread)
      .slice(0, 10);
  }, [spreads]);

  return (
    <div className="panel">
      <h3>📊 Live Spread Monitor</h3>
      <div className="spread-table">
        <table>
          <thead>
            <tr>
              <th>Pair</th>
              <th>Exchange 1</th>
              <th>Exchange 2</th>
              <th>Spread</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sortedSpreads.map((item, idx) => (
              <tr key={idx} className={item.spread > 0 ? 'profitable' : ''}>
                <td>{item.pair}</td>
                <td>{item.price1?.toFixed(2)}</td>
                <td>{item.price2?.toFixed(2)}</td>
                <td className={item.spread > 0 ? 'positive' : 'negative'}>
                  {item.spread.toFixed(4)}%
                </td>
                <td>
                  <span className={`status-dot ${item.spread > 0 ? 'green' : 'red'}`} />
                  {item.spread > 0 ? 'Opportunity' : 'No chance'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OrderHistory({ orders }) {
  const recentOrders = useMemo(() => {
    return orders.slice(-20).reverse();
  }, [orders]);

  return (
    <div className="panel">
      <h3>📝 Order History</h3>
      <div className="order-table">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Pair</th>
              <th>Type</th>
              <th>Side</th>
              <th>Price</th>
              <th>Quantity</th>
              <th>Latency (ms)</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {recentOrders.map((order, idx) => (
              <tr key={idx} className={order.success ? 'success' : 'error'}>
                <td>{new Date(order.timestamp).toLocaleTimeString()}</td>
                <td>{order.pair}</td>
                <td>{order.type}</td>
                <td>{order.side}</td>
                <td>{order.price?.toFixed(4)}</td>
                <td>{order.quantity}</td>
                <td>{order.latencyMs}ms</td>
                <td>
                  <span className={`status ${order.success ? 'success' : 'error'}`}>
                    {order.success ? '✓ Success' : '✗ Failed'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RiskPanel({ killSwitchStatus, onReset }) {
  return (
    <div className="panel">
      <h3>🛡️ Risk Management</h3>
      <div className="risk-stats">
        <div className="stat">
          <label>Status</label>
          <span className={killSwitchStatus.isActive ? 'error' : 'success'}>
            {killSwitchStatus.isActive ? '🚨 KILL SWITCH' : '✓ Active'}
          </span>
        </div>
        <div className="stat">
          <label>Consecutive Errors</label>
          <span>{killSwitchStatus.consecutiveErrors}</span>
        </div>
        <div className="stat">
          <label>Avg Latency</label>
          <span>{killSwitchStatus.avgLatency}ms</span>
        </div>
        <div className="stat">
          <label>Today PnL</label>
          <span className={killSwitchStatus.dailyPnl >= 0 ? 'success' : 'error'}>
            ${killSwitchStatus.dailyPnl.toFixed(2)}
          </span>
        </div>
        <div className="stat">
          <label>Drawdown</label>
          <span>{killSwitchStatus.drawdown}</span>
        </div>
      </div>
      {killSwitchStatus.isActive && (
        <button className="btn btn-warning" onClick={onReset}>
          Reset Kill Switch
        </button>
      )}
    </div>
  );
}

function PriceTicker({ prices }) {
  const priceList = useMemo(() => {
    return Object.entries(prices)
      .filter(([key]) => !key.includes(':depth'))
      .slice(0, 20)
      .map(([key, value]) => ({ key, ...value }));
  }, [prices]);

  return (
    <div className="panel">
      <h3>💰 Live Prices</h3>
      <div className="price-grid">
        {priceList.map((price, idx) => (
          <div key={idx} className="price-card">
            <div className="price-symbol">{price.key.split(':')[1] || price.key}</div>
            <div className="price-value">
              ${price.price?.toFixed(2) || price.lastPrice?.toFixed(2) || '---'}
            </div>
            <div className="price-change">
              {price.priceChange ? (price.priceChange > 0 ? '+' : '') + price.priceChange + '%' : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main App Component ───────────────────────────────────────────────────────

export default function App() {
  const [connected, setConnected] = useState(false);
  const [tradingEnabled, setTradingEnabled] = useState(true);
  const [spreads, setSpreads] = useState({});
  const [orders, setOrders] = useState([]);
  const [prices, setPrices] = useState({});
  const [killSwitch, setKillSwitch] = useState({});
  const [stats, setStats] = useState({});

  // WebSocket connection management
  useEffect(() => {
    // Connect to WebSocket server
    wsClient.connect();

    // Subscribe to all channels
    wsClient.subscribe(['all']);

    // Event listeners
    const unsubConnected = wsClient.on('connected', () => {
      setConnected(true);
      console.log('Connected to WebSocket server');
    });

    const unsubDisconnected = wsClient.on('disconnected', () => {
      setConnected(false);
      console.log('Disconnected from WebSocket server');
    });

    const unsubError = wsClient.on('error', (err) => {
      console.error('WebSocket error:', err);
    });

    // Data listeners
    const unsubPrices = wsClient.on('price_update', (data) => {
      if (data.data) setPrices(data.data);
    });

    const unsubSpreads = wsClient.on('spread_update', (data) => {
      if (data.data) setSpreads(data.data);
    });

    const unsubOrders = wsClient.on('order_update', (data) => {
      if (data.data) {
        setOrders(prev => [...prev, data.data].slice(-100)); // Keep last 100
      }
    });

    const unsubPnl = wsClient.on('pnl_update', (data) => {
      // Update PnL if needed
    });

    const unsubHealth = wsClient.on('health', (data) => {
      if (data.data) setKillSwitch(data.data);
    });

    const unsubStats = wsClient.on('stats', (data) => {
      if (data.data) setStats(data.data);
    });

    // Cleanup on unmount
    return () => {
      unsubConnected();
      unsubDisconnected();
      unsubError();
      unsubPrices();
      unsubSpreads();
      unsubOrders();
      unsubPnl();
      unsubHealth();
      unsubStats();
      wsClient.disconnect();
    };
  }, []);

  // Control handlers
  const handleToggleTrading = useCallback(() => {
    const newStatus = !tradingEnabled;
    wsClient.sendCommand({
      action: newStatus ? 'start_trading' : 'stop_trading'
    });
    setTradingEnabled(newStatus);
  }, [tradingEnabled]);

  const handleEmergencyStop = useCallback(() => {
    wsClient.sendCommand({
      action: 'emergency_stop'
    });
    setTradingEnabled(false);
  }, []);

  const handleResetKillSwitch = useCallback(() => {
    // Would need to implement reset endpoint
    console.log('Reset kill switch');
  }, []);

  // Request stats every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      wsClient.sendCommand({ action: 'request_stats' });
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="dashboard">
      {/* Header */}
      <header className="dashboard-header">
        <div className="header-left">
          <h1>🔷 UltimateArbitrageHFT</h1>
          <StatusBadge connected={connected} />
        </div>
        <div className="header-right">
          <span className="server-time">
            {new Date().toLocaleTimeString()}
          </span>
        </div>
      </header>

      {/* Main Content */}
      <main className="dashboard-main">
        {/* Top Row: Controls + Risk */}
        <div className="dashboard-grid">
          <ControlPanel
            tradingEnabled={tradingEnabled}
            onToggleTrading={handleToggleTrading}
            onEmergencyStop={handleEmergencyStop}
          />
          <RiskPanel
            killSwitchStatus={killSwitch}
            onReset={handleResetKillSwitch}
          />
        </div>

        {/* Second Row: Prices + Spreads */}
        <div className="dashboard-grid">
          <PriceTicker prices={prices} />
          <SpreadMonitor spreads={spreads} />
        </div>

        {/* Third Row: Order History */}
        <OrderHistory orders={orders} />

        {/* Stats Footer */}
        {Object.keys(stats).length > 0 && (
          <div className="stats-footer">
            <div className="stat-item">
              <label>Clients</label>
              <span>{stats.connectedClients || 0}</span>
            </div>
            <div className="stat-item">
              <label>Uptime</label>
              <span>{Math.floor((stats.uptime || 0) / 3600)}h {(Math.floor((stats.uptime || 0) / 60) % 60)}m</span>
            </div>
            <div className="stat-item">
              <label>Queue</label>
              <span>{stats.messageQueue || 0}</span>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
