// nexus/index.js — Nexus Arbitrage System v1.0 — Unified Hub
//
// Architecture:
//   MarketStreamer (Durable Object) — WebSocket price cache per symbol
//   runScan (orchestrator)          — runs CEX + DEX + Perps strategies in parallel
//   renderDashboard                 — unified HTML control center
//
// Endpoints:
//   GET  /                        public  — dashboard
//   GET  /dashboard               public  — dashboard (alias)
//   GET  /checklist               public  — go-live checklist
//   GET  /health | /status        public  — JSON status
//   GET  /strategy/{cex|dex|perps}/status  public — last scan per strategy
//   GET  /start                   🔒      — enable trading
//   GET  /stop                    🔒      — disable trading
//   GET  /scan                    🔒      — trigger immediate scan
//   GET  /mode/paper              🔒      — switch to paper mode
//   GET  /mode/live               🔒      — switch to live mode
//   POST /config                  🔒      — update risk parameters
//   GET  /test-ws?symbol=X        🔒      — connect WebSocket for symbol

import { runScan }                     from './src/orchestrator.js';
import { renderDashboard, renderChecklist } from './src/dashboard.js';
import { logAdminEvent, logBotEvent }   from './src/db.js';

const DEFAULT_RISK = {
  MAX_DAILY_LOSS_USD:         25,
  MIN_SECONDS_BETWEEN_TRADES: 30,
  MAX_PER_TRADE_LOSS_PCT:     0.02,
  MAX_SPREAD_PCT:             5.0
};

// ── Admin auth ────────────────────────────────────────────────────────────────

function checkAdminToken(request, env) {
  if (!env.ADMIN_TOKEN) {
    console.warn('⚠️  ADMIN_TOKEN not set — protected endpoints are unguarded');
    return true;
  }
  const token =
    request.headers.get('x-admin-token') ||
    (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') ||
    new URL(request.url).searchParams.get('token');
  return token === env.ADMIN_TOKEN;
}

// ── Execution lock (prevents concurrent scans) ────────────────────────────────

const LOCK_KEY  = 'execution_lock';
const LOCK_TTL  = 30; // seconds

async function acquireExecutionLock(env) {
  try {
    const existing = await env.BOT_STATE.get(LOCK_KEY);
    if (existing) {
      const lock = JSON.parse(existing);
      if (Date.now() - lock.acquired_at < LOCK_TTL * 1000) return false;
    }
    await env.BOT_STATE.put(
      LOCK_KEY,
      JSON.stringify({ acquired_at: Date.now() }),
      { expirationTtl: LOCK_TTL }
    );
    return true;
  } catch (_) { return true; } // allow if KV unavailable
}

async function releaseExecutionLock(env) {
  try { await env.BOT_STATE.delete(LOCK_KEY); } catch (_) {}
}

// ── Daily reset ───────────────────────────────────────────────────────────────

function todayDateStr() {
  return new Date().toISOString().slice(0, 10);
}

function applyDailyResetIfNeeded(state) {
  if (state.daily_reset_date !== todayDateStr()) {
    state.daily_pnl            = 0;
    state.daily_trades         = 0;
    state.daily_used_usd       = 0;
    state.auto_stopped         = false;
    state.auto_stop_reason     = null;
    state.last_trade_timestamp = 0;
    state.daily_reset_date     = todayDateStr();
  }
  return state;
}

// ── Telegram alert ────────────────────────────────────────────────────────────

async function sendTelegramAlert(env, msg) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: msg })
    });
  } catch (_) {}
}

// ── Full scan cycle (called from cron + /scan endpoint) ───────────────────────

async function runScanCycle(env) {
  const locked = await acquireExecutionLock(env);
  if (!locked) {
    console.log('⏳ Scan skipped — execution lock held by another invocation');
    return;
  }
  try {
    let state = await env.BOT_STATE.get('trading_state', 'json') || {
      trading_enabled: true, paper_trading: false,
      daily_pnl: 0, daily_trades: 0, total_pnl: 0, total_trades: 0,
      win_rate: 0.55, risk_reward_ratio: 2.0, last_trade_timestamp: 0
    };

    // Daily reset (clears auto_stopped if a new day started)
    const wasAutoStopped = state.auto_stopped;
    state = applyDailyResetIfNeeded(state);
    if (wasAutoStopped && !state.auto_stopped) {
      state.trading_enabled = true;
      await env.BOT_STATE.put('trading_state', JSON.stringify(state));
      await sendTelegramAlert(env, '🔄 Nexus: Auto-restarted after daily reset');
      await logBotEvent(env, 'daily_reset_restart');
      console.log('🔄 Auto-restarted after daily reset');
    }

    if (!state.trading_enabled) return;

    // ── Circuit breaker: daily loss limit ──────────────────────────────────────
    const maxDailyLoss   = state.max_daily_loss_usd           ?? DEFAULT_RISK.MAX_DAILY_LOSS_USD;
    const minSecsBetween = state.min_seconds_between_trades   ?? DEFAULT_RISK.MIN_SECONDS_BETWEEN_TRADES;
    const dailyPnl       = state.daily_pnl || 0;

    if (dailyPnl < 0 && Math.abs(dailyPnl) >= maxDailyLoss) {
      state.trading_enabled  = false;
      state.auto_stopped     = true;
      state.auto_stop_reason = `تجاوز حد الخسارة اليومية ($${maxDailyLoss})`;
      await env.BOT_STATE.put('trading_state', JSON.stringify(state));
      await sendTelegramAlert(env, `🛑 Nexus Auto-stopped: ${state.auto_stop_reason}`);
      await logBotEvent(env, 'auto_stop', { reason: state.auto_stop_reason });
      console.log(`🛑 ${state.auto_stop_reason}`);
      return;
    }

    // ── Cooldown between trades ────────────────────────────────────────────────
    const lastTs = state.last_trade_timestamp || 0;
    if (lastTs && (Date.now() - lastTs) / 1000 < minSecsBetween) {
      console.log(`⏳ Cooldown active — ${minSecsBetween}s between trades`);
      return;
    }

    // ── Run all strategies via orchestrator ────────────────────────────────────
    const result = await runScan(env, state, sendTelegramAlert);

    // Save updated state (orchestrator mutates state counters in place)
    await env.BOT_STATE.put('trading_state', JSON.stringify(state));

    if (result) {
      const { opportunity: opp } = result;
      console.log(
        `✅ Nexus trade: [${opp.strategy.toUpperCase()}] ${opp.symbol} ${opp.direction}` +
        ` daily_pnl=$${state.daily_pnl.toFixed(2)} total_pnl=$${state.total_pnl.toFixed(2)}`
      );
    }
  } finally {
    await releaseExecutionLock(env);
  }
}

// ── MarketStreamer Durable Object ─────────────────────────────────────────────

export class MarketStreamer {
  constructor(state, env) {
    this.state       = state;
    this.env         = env;
    this.symbol      = state.idFromName;
    this.currentPrice = 0;
    this.lastUpdate  = 0;
    this.ws          = null;
    this.volatility  = 0;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/price') {
      return new Response(JSON.stringify({
        symbol:     this.symbol,
        price:      this.currentPrice,
        lastUpdate: this.lastUpdate,
        volatility: this.volatility
      }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/connect') {
      if (!this.ws) this.connectWebSocket();
      return new Response('WebSocket connection initiated');
    }
    return new Response('MarketStreamer Active', { status: 200 });
  }

  connectWebSocket() {
    this.ws = new WebSocket('wss://wbs.mexc.com/ws');
    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({
        method: 'SUBSCRIPTION',
        params: [`spot@public.miniTicker.v3.api@${this.symbol}@UTC+8`],
        id: Date.now()
      }));
    };
    this.ws.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        if (data.c) {
          this.currentPrice = parseFloat(data.c);
          this.lastUpdate   = Date.now();
          this.state.storage.put('lastPrice',  this.currentPrice);
          this.state.storage.put('lastUpdate', this.lastUpdate);
        }
      } catch (_) {}
    };
    this.ws.onerror = err  => console.error(`[${this.symbol}] WS error:`, err);
    this.ws.onclose = ()   => {
      this.ws = null;
      setTimeout(() => this.connectWebSocket(), 1000);
    };
  }
}

// ── Main Worker ───────────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const url  = new URL(request.url);
    const path = url.pathname;

    // ── Public routes ──────────────────────────────────────────────────────────
    if (path === '/' || path === '/dashboard') return renderDashboard(env);
    if (path === '/checklist')                 return renderChecklist(env);

    if (path === '/health' || path === '/status') {
      const [state, lastScan] = await Promise.all([
        env.BOT_STATE.get('trading_state', 'json').then(s => s || {}),
        env.BOT_STATE.get('nexus_last_scan', 'json').catch(() => null)
      ]);
      return new Response(JSON.stringify({
        status:          'ok',
        version:         'nexus-v1',
        trading_enabled: state.trading_enabled !== false,
        paper_trading:   state.paper_trading   !== false,
        auto_stopped:    state.auto_stopped    || false,
        auto_stop_reason: state.auto_stop_reason || null,
        daily_trades:    state.daily_trades    || 0,
        daily_pnl:       state.daily_pnl       || 0,
        total_pnl:       state.total_pnl       || 0,
        equity:          (state.initial_capital || 1000) + (state.total_pnl || 0),
        last_scan:       lastScan?.timestamp
          ? new Date(lastScan.timestamp).toISOString() : null,
        timestamp:       new Date().toISOString()
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // ── Per-strategy status ────────────────────────────────────────────────────
    if (path.startsWith('/strategy/')) {
      const stratName = path.split('/')[2]; // 'cex' | 'dex' | 'perps'
      if (!['cex', 'dex', 'perps'].includes(stratName)) {
        return new Response('Unknown strategy', { status: 404 });
      }
      const lastScan = await env.BOT_STATE.get('nexus_last_scan', 'json').catch(() => null);
      return new Response(JSON.stringify({
        strategy:         stratName,
        last_scan:        lastScan?.timestamp
          ? new Date(lastScan.timestamp).toISOString() : null,
        best_opportunity: lastScan?.[stratName] || null
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // ── Admin-protected routes ─────────────────────────────────────────────────
    const PROTECTED = ['/start', '/stop', '/scan', '/mode/paper', '/mode/live', '/config', '/test-ws'];
    if (PROTECTED.some(p => path === p || path.startsWith(p + '/'))) {
      if (!checkAdminToken(request, env)) {
        return new Response('Unauthorized', { status: 401 });
      }
    }

    if (path === '/start') {
      const state = await env.BOT_STATE.get('trading_state', 'json') || {};
      state.trading_enabled  = true;
      state.auto_stopped     = false;
      state.auto_stop_reason = null;
      await env.BOT_STATE.put('trading_state', JSON.stringify(state));
      await logAdminEvent(env, 'start', request);
      await sendTelegramAlert(env, '▶️ Nexus: Trading enabled');
      return new Response('✅ تم تشغيل التداول');
    }

    if (path === '/stop') {
      const state = await env.BOT_STATE.get('trading_state', 'json') || {};
      state.trading_enabled = false;
      await env.BOT_STATE.put('trading_state', JSON.stringify(state));
      await logAdminEvent(env, 'stop', request);
      await sendTelegramAlert(env, '⏸️ Nexus: Trading disabled');
      return new Response('✅ تم إيقاف التداول');
    }

    if (path === '/scan') {
      ctx.waitUntil(runScanCycle(env));
      return new Response('✅ بدأ المسح الفوري عبر جميع الاستراتيجيات (CEX + DEX + Perps)');
    }

    if (path === '/mode/paper') {
      const state = await env.BOT_STATE.get('trading_state', 'json') || {};
      state.paper_trading = true;
      await env.BOT_STATE.put('trading_state', JSON.stringify(state));
      await sendTelegramAlert(env, '📄 Nexus: Paper trading mode active');
      return new Response('✅ تم تفعيل وضع التداول الورقي');
    }

    if (path === '/mode/live') {
      const state = await env.BOT_STATE.get('trading_state', 'json') || {};
      state.paper_trading = false;
      await env.BOT_STATE.put('trading_state', JSON.stringify(state));
      await sendTelegramAlert(env, '🔴 Nexus: Live trading mode active');
      return new Response('✅ تم تفعيل وضع التداول الحقيقي');
    }

    if (path === '/config' && request.method === 'POST') {
      let body;
      try { body = await request.json(); }
      catch (_) { return new Response('Invalid JSON', { status: 400 }); }

      const state = await env.BOT_STATE.get('trading_state', 'json') || {};
      const allowed = [
        'max_daily_loss_usd', 'min_seconds_between_trades',
        'max_per_trade_loss_pct', 'initial_capital', 'max_spread_pct'
      ];
      for (const key of allowed) {
        if (body[key] !== undefined) {
          const v = parseFloat(body[key]);
          if (!isNaN(v) && v > 0) state[key] = v;
        }
      }
      await env.BOT_STATE.put('trading_state', JSON.stringify(state));
      return new Response(JSON.stringify({ status: 'updated', state }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (path === '/test-ws') {
      const symbol = url.searchParams.get('symbol') || 'BTCUSDT';
      const id  = env.MARKET_STREAMER.idFromName(symbol);
      const obj = env.MARKET_STREAMER.get(id);
      await obj.fetch('https://dummy/connect');
      return new Response(`✅ بدأ اتصال WebSocket لـ ${symbol}`);
    }

    return new Response(
      '🔷 Nexus Arbitrage System v1.0 — Unified Hub. Open /dashboard',
      { status: 200 }
    );
  },

  // ── Cron trigger (every minute) ─────────────────────────────────────────────
  async scheduled(_event, env) {
    const state = await env.BOT_STATE.get('trading_state', 'json') || { trading_enabled: true };
    if (!state.trading_enabled) return;
    await runScanCycle(env);
  }
};
