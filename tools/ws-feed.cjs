#!/usr/bin/env node
/**
 * ws-feed.cjs — Local WebSocket price feed for UltimateArbitrageHFT.
 *
 * Connects to public WebSocket streams of major exchanges (Binance, MEXC, KuCoin,
 * Bitget, HTX) and pushes the latest spot prices to the Cloudflare Worker endpoint.
 *
 * Run:  node tools/ws-feed.cjs
 * Env:  WORKER_URL, ADMIN_TOKEN, SYMBOLS
 */
const https = require('https');
const path = require('path');
const fs = require('fs');

function findWs() {
  const candidates = [
    path.join(__dirname, '..', 'node_modules', 'ws', 'index.js'),
    path.join(process.cwd(), 'node_modules', 'ws', 'index.js'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const wsIndex = findWs();
if (!wsIndex) {
  console.error('[ws-feed] ws module not found in project root node_modules');
  process.exit(1);
}
const { WebSocket } = require(wsIndex);

const WORKER_URL = (process.env.WORKER_URL || 'https://api.ecostamp.net').replace(/\/$/, '');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const SYMBOLS = (process.env.SYMBOLS || 'BTCUSDT,ETHUSDT,BNBUSDT,SOLUSDT,XRPUSDT,ADAUSDT,DOGEUSDT')
  .split(',')
  .map((s) => s.trim());

const STREAMS = {
  binance: {
    url: 'wss://stream.binance.com:9443/ws',
    sub: (sym) => ({ method: 'SUBSCRIBE', params: [`${sym.toLowerCase()}@trade`], id: 1 }),
    parse: (d) => (d && d.s && d.p ? { sym: d.s.toUpperCase(), price: parseFloat(d.p) } : null),
  },
  mexc: {
    url: 'wss://wbs.mexc.com/ws',
    sub: (sym) => ({ method: 'SUBSCRIPTION', params: [`spot@public.deals.v3.api@${sym}`] }),
    parse: (d) => (d?.d?.deals?.[0] ? { sym: d.c?.split('@')[0]?.toUpperCase(), price: parseFloat(d.d.deals[0].p) } : null),
  },
  kucoin: {
    url: 'wss://ws-api.kucoin.com/endpoint',
    sub: (sym) => ({ type: 'subscribe', topic: `/market/match:${sym}`, privateChannel: false, response: true }),
    parse: (d) => (d?.data?.price ? { sym: d.subject === 'trade.l3match' ? d.topic.split(':')[1] : null, price: parseFloat(d.data.price) } : null),
  },
  bitget: {
    url: 'wss://ws.bitget.com/spot/v1/stream',
    sub: (sym) => ({ op: 'subscribe', args: [`spot/trade:${sym}`] }),
    parse: (d) => (d?.data?.[0]?.p ? { sym: d.arg?.instId, price: parseFloat(d.data[0].p) } : null),
  },
  htx: {
    url: 'wss://api.htx.com/ws',
    sub: (sym) => ({ sub: `market.${sym}.trade.detail`, id: Date.now() }),
    parse: (d) => (d?.tick?.data?.[0] ? { sym: d.ch.split('.')[1]?.toUpperCase(), price: parseFloat(d.tick.data[0].price) } : null),
  },
};

const latest = {};
let flushTimer = null;

function pushToWorker() {
  if (!ADMIN_TOKEN) {
    console.error('[ws-feed] ADMIN_TOKEN missing');
    return;
  }
  const payload = Object.entries(latest).map(([sym, ex]) => ({ symbol: sym, prices: ex }));
  const body = JSON.stringify({ ts: Date.now(), feeds: payload });
  const url = new URL(`${WORKER_URL}/api/ws-prices`);
  const req = https.request(
    {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': ADMIN_TOKEN,
        'Content-Length': Buffer.byteLength(body),
      },
    },
    () => {}
  );
  req.on('error', () => {});
  req.write(body);
  req.end();
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    if (Object.keys(latest).length) pushToWorker();
  }, 1000);
}

function connect(name, cfg) {
  const ws = new WebSocket(cfg.url);
  let pingTimer = null;

  ws.on('open', () => {
    console.log(`[ws-feed] ${name} connected`);
    pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.ping(); } catch {}
      }
    }, 25000);
    SYMBOLS.forEach((s) => ws.send(JSON.stringify(cfg.sub(s))));
  });

  ws.on('message', (raw) => {
    let d;
    try { d = JSON.parse(raw.toString()); } catch { return; }
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
}

console.log('[ws-feed] starting for', SYMBOLS.join(', '));
Object.entries(STREAMS).forEach(([name, cfg]) => connect(name, cfg));
scheduleFlush();
