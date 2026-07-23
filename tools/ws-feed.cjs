#!/usr/bin/env node
/**
 * ws-feed.cjs — Hybrid WebSocket + CCXT/Hyperliquid price feed.
 *
 * Primary path: CCXT REST/WS + Hyperliquid public WS when available.
 * Fallback path: native exchange WebSocket streams.
 * Pushes latest prices to the Cloudflare Worker endpoint.
 *
 * Run:  node tools/ws-feed.cjs
 * Env:  WORKER_URL, ADMIN_TOKEN, SYMBOLS
 */

const https = require('node:https');
const path = require('node:path');
const fs = require('node:fs');

function findWsCandidate() {
  const candidates = [
    path.join(__dirname, '..', 'node_modules', '.pnpm', 'ws@8.21.1', 'node_modules', 'ws', 'index.js'),
    path.join(__dirname, '..', 'node_modules', 'ws', 'index.js'),
    ...(process.env.NODE_PATH ? process.env.NODE_PATH.split(path.delimiter).map(p => path.join(p, 'ws', 'index.js')) : []),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return { wsIndex: p, wsRoot: path.dirname(p) };
  }
  return null;
}

const wsPkg = findWsCached();
if (!wsPkg) {
  console.error('[ws-feed] native ws package not found');
  process.exit(1);
}
const { WebSocket: NativeWebSocket } = require(wsPkg.wsIndex);

// Add resolved path to Module._cache for Node resolution compatibility
try { require.cache[require.resolve(wsPkg.wsRoot)] = { id: wsPkg.wsRoot, filename: wsPkg.wsRoot, loaded: true, exports: { WebSocket: NativeWebSocket } }; } catch {}
function findWsCached() {
  const candidates = [
    path.join(__dirname, '..', 'node_modules', '.pnpm', 'ws@8.21.1', 'node_modules', 'ws', 'index.js'),
    path.join(__dirname, '..', 'node_modules', 'ws', 'index.js'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return { wsIndex: p, wsRoot: path.dirname(p) };
  }
  return null;
}

const WORKER_URL = (process.env.WORKER_URL || 'https://api.ecostamp.net').replace(/\/$/, '');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const SYMBOLS = (process.env.SYMBOLS || 'BTCUSDT,ETHUSDT,BNBUSDT,SOLUSDT,XRPUSDT,ADAUSDT,DOGEUSDT')
  .split(',')
  .map(s => s.trim());

function findCcxt() {
  const candidates = [
    path.join(__dirname, '..', 'node_modules', '.pnpm', 'ccxt@1.95.43', 'node_modules', 'ccxt', 'ccxt.js'),
    path.join(__dirname, '..', 'node_modules', 'ccxt', 'index.js'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return require(p);
  }
  return null;
}

function findHyperliquid() {
  const candidates = [
    path.join(__dirname, '..', 'node_modules', '.pnpm', 'hyperliquid@1.7.7', 'node_modules', 'hyperliquid', 'dist', 'index.js'),
    path.join(__dirname, '..', 'node_modules', 'hyperliquid', 'dist', 'index.js'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return require(p);
  }
  return null;
}

function findMsgPack() {
  const candidates = [
    path.join(__dirname, '..', 'node_modules', '.pnpm', '@msgpack+msgpack@1.12.2', 'node_modules', '@msgpack', 'msgpack', 'dist', 'index.js'),
    path.join(__dirname, '..', 'node_modules', '@msgpack', 'msgpack', 'index.js'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return require(p);
  }
  return null;
}

const ccxtPkg = findCcxt();
const hlPkg = findHyperliquid();
const msgpackPkg = findMsgPack();
const hasLibraries = Boolean(ccxtPkg || hlPkg || msgpackPkg);

if (hasLibraries) {
  console.log('[ws-feed] advanced libraries detected:', { ccxt: Boolean(ccxtPkg), hyperliquid: Boolean(hlPkg), msgpack: Boolean(msgpackPkg) });
} else {
  console.log('[ws-feed] using native WebSocket fallback');
}

const latest = {};
let flushTimer = null;

function pushToWorker() {
  if (!ADMIN_TOKEN) {
    console.error('[ws-feed] ADMIN_TOKEN missing');
    return;
  }
  const payload = Object.entries(latest).map(([sym, ex]) => ({ symbol: sym, prices: ex }));
  const body = JSON.stringify({ ts: Date.now(), feeds: payload, via: hasLibraries ? 'lib' : 'native' });
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

function updateLatest(exchange, sym, price) {
  const s = String(sym || '').toUpperCase();
  if (!s) return;
  if (!latest[s]) latest[s] = {};
  latest[s][exchange] = Number(price || 0);
}

function connectNative(name, cfg) {
  const ws = new NativeWebSocket(cfg.url);
  let pingTimer = null;

  ws.on('open', () => {
    console.log(`[ws-feed] ${name} connected`);
    pingTimer = setInterval(() => {
      if (ws.readyState === NativeWebSocket.OPEN) {
        try { ws.ping(); } catch {}
      }
    }, 25000);
    SYMBOLS.forEach((s) => {
      try { ws.send(JSON.stringify(cfg.sub(s))); } catch {}
    });
  });

  ws.on('message', (raw) => {
    let d;
    try { d = JSON.parse(raw.toString()); } catch { return; }
    const p = cfg.parse(d);
    if (p && p.sym && p.price) updateLatest(name, p.sym, p.price);
  });

  ws.on('close', () => {
    if (pingTimer) clearInterval(pingTimer);
    console.log(`[ws-feed] ${name} closed, retrying in 2s...`);
    setTimeout(() => connectNative(name, cfg), 2000);
  });

  ws.on('error', () => { try { ws.close(); } catch {} });
}

function startHyperliquid() {
  if (!hlPkg) return;
  try {
    const stream = hlPkg.createStream?.();
    if (!stream) return;
    stream.on('trade', (trade) => {
      const sym = String(trade?.coin || trade?.symbol || '').toUpperCase();
      if (!sym) return;
      updateLatest('hyperliquid', sym, Number(trade?.price || trade?.px || 0));
    });
    SYMBOLS.forEach((s) => {
      try { stream.subscribe?.(s.replace(/USDT$/i, '')); } catch {}
    });
    console.log('[ws-feed] Hyperliquid stream started');
  } catch (e) {
    console.warn('[ws-feed] Hyperliquid stream failed:', e.message);
  }
}

function startCcxt() {
  if (!ccxtPkg) return;
  try {
    const ex = new ccxtPkg.binance({ enableRateLimit: false });
    ex.load_markets().catch(() => {});
    SYMBOLS.forEach((s) => {
      try {
        const t = ex.fetch_ticker(s);
        if (t?.last) updateLatest('ccxt-binance', s, Number(t.last));
      } catch {}
    });
    console.log('[ws-feed] CCXT bootstrap completed');
  } catch (e) {
    console.warn('[ws-feed] CCXT bootstrap failed:', e.message);
  }
}

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

console.log('[ws-feed] starting for', SYMBOLS.join(', '));
Object.entries(STREAMS).forEach(([name, cfg]) => connectNative(name, cfg));
if (hasLibraries) {
  startHyperliquid();
  startCcxt();
}
scheduleFlush();
