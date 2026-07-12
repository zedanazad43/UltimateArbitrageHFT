#!/usr/bin/env node
/**
 * ws-feed.cjs — Local WebSocket price feed for UltimateArbitrageHFT.
 *
 * Connects to public WebSocket streams of major exchanges (Binance, MEXC, KuCoin,
 * Bitget, HTX) and pushes the latest spot prices to the Cloudflare Worker's KV
 * store via its public API. This gives the bot SUB-SECOND price freshness
 * (latency arbitrage) instead of slow REST polling through serveo.
 *
 * Run:  node tools/ws-feed.cjs
 * Env:  WORKER_URL (default https://api.ecostamp.net), ADMIN_TOKEN, SYMBOLS
 */
const https = require('https');
const http = require('http');
const { WebSocket } = require('ws');

const WORKER_URL = (process.env.WORKER_URL || 'https://api.ecostamp.net').replace(/\/$/, '');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const SYMBOLS = (process.env.SYMBOLS || 'BTCUSDT,ETHUSDT,BNBUSDT,SOLUSDT,XRPUSDT,ADAUSDT,DOGEUSDT').split(',').map(s => s.trim());

// exchange -> websocket endpoint + message parser
const STREAMS = {
  binance: {
    url: 'wss://stream.binance.com:9443/ws',
    sub: (sym) => ({ method: 'SUBSCRIBE', params: [`${sym.toLowerCase()}@trade`], id: 1 }),
    parse: (d) => d && d.s && d.p ? { sym: d.s.toUpperCase(), price: parseFloat(d.p) } : null,
  },
  mexc: {
    url: 'wss://wbs.mexc.com/ws',
    sub: (sym) => ({ method: 'SUBSCRIPTION', params: [`spot@public.deals.v3.api@${sym}`] }),
    parse: (d) => d?.d?.deals?.[0] ? { sym: d.c?.split('@')[0]?.toUpperCase(), price: parseFloat(d.d.deals[0].p) } : null,
  },
  kucoin: {
    url: 'wss://ws-api.kucoin.com/endpoint',
    sub: (sym) => ({ type: 'subscribe', topic: `/market/match:${sym}`, privateChannel: false, response: true }),
    parse: (d) => d?.data?.price ? { sym: d.subject === 'trade.l3match' ? d.topic.split(':')[1] : null, price: parseFloat(d.data.price) } : null,
  },
  bitget: {
    url: 'wss://ws.bitget.com/spot/v1/stream',
    sub: (sym) => ({ op: 'subscribe', args: [`spot/trade:${sym}`] }),
    parse: (d) => d?.data?.[0]?.p ? { sym: d.arg?.instId, price: parseFloat(d.data[0].p) } : null,
  },
  htx: {
    url: 'wss://api.htx.com/ws',
    sub: (sym) => ({ sub: `market.${sym}.trade.detail`, id: Date.now() }),
    parse: (d) => d?.tick?.data?.[0] ? { sym: d.ch.split('.')[1]?.toUpperCase(), price: parseFloat(d.tick.data[0].price) } : null,
  },
};

const latest = {}; // sym -> { exchange: price }
let flushTimer = null;

function pushToWorker() {
  if (!ADMIN_TOKEN) { console.error('[ws-feed] ADMIN_TOKEN missing'); return; }
  const payload = Object.entries(latest).map(([sym, ex]) => ({
    symbol: sym,
    prices: ex,
  }));
  const body = JSON.stringify({ ts: Date.now(), feeds: payload });
  const url = new URL(`${WORKER_URL}/api/ws-prices`);
  const req = https.request({
    hostname: url.hostname,
    path: url.pathname,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN, 'Content-Length': Buffer.byteLength(body) },
  }, (res) => { res.resume(); });
  req.on('error', () => {});
  req.write(body);
  req.end();
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    if (Object.keys(latest).length) pushToWorker();
  }, 1000); // flush every 1s
}

function connect(name, cfg) {
  const ws = new WebSocket(cfg.url);
  let alive = true;
  let pingTimer = null;

  ws.on('open', () => {
    console.log(`[ws-feed] ${name} connected`);
    // Keepalive: send ping every 25s to prevent idle disconnect
    pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.ping(); } catch {}
      }
    }, 25000);
    SYMBOLS.forEach((s) => ws.send(JSON.stringify(cfg.sub(s))));
  });
  ws.on('message', (raw) => {
    let d; try { d = JSON.parse(raw.toString()); } catch { return; }
    const p = cfg.parse(d);
    if (p && p.sym && p.price) {
      const sym = p.sym.toUpperCase();
      if (!latest[sym]) latest[sym] = {};
      latest[sym][name] = p.price;
    }
  });
  ws.on('close', () => {
    if (pingTimer) clearInterval(pingTimer);
    console.log(`[ws-feed] ${name} closed, retrying in 2s...`);
    setTimeout(() => connect(name, cfg), 2000);
  });
  ws.on('error', () => { try { ws.close(); } catch {} });
  // Heartbeat: detect dead connections
  ws.on('pong', () => { alive = true; });
}

console.log('[ws-feed] starting for', SYMBOLS.join(', '));
Object.entries(STREAMS).forEach(([name, cfg]) => connect(name, cfg));
scheduleFlush();
