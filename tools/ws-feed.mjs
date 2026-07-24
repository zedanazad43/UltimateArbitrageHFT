/**
 * ws-feed.mjs — Hybrid CCXT REST + CoinCap WebSocket price feed.
 *
 * Uses CCXT REST endpoints via node-fetch for public market data.
 * Falls back to CoinCap public WebSocket for real-time updates.
 * Run: node tools/ws-feed.mjs
 */

import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ADVANCED = process.env.WS_FEED_ADVANCED !== 'false';
const WORKER_URL = process.env.WORKER_URL || 'https://ultimatearbitragehft.zedanazad43.workers.dev';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '309400';

function findCcxt() {
  const candidates = [
    path.join(__dirname, '..', 'node_modules', '.pnpm', 'ccxt@4.5.67', 'node_modules', 'ccxt', 'index.js'),
    path.join(__dirname, '..', 'node_modules', 'ccxt', 'index.js'),
  ];
  for (const p of candidates) if (fs.existsSync(p)) return { ccxtIndex: p };
  return null;
}

function findWs() {
  const candidates = [
    path.join(__dirname, '..', 'node_modules', '.pnpm', 'ws@8.21.1', 'node_modules', 'ws', 'index.js'),
    path.join(__dirname, '..', 'node_modules', 'ws', 'index.js'),
    ...(process.env.NODE_PATH ? process.env.NODE_PATH.split(path.delimiter).map(p => path.join(p, 'ws', 'index.js')) : []),
  ];
  for (const p of candidates) if (fs.existsSync(p)) return { wsIndex: p };
  return null;
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const transport = u.protocol === 'https:' ? https : http;
    const req = transport.get(url, { headers: { 'User-Agent': 'ws-feed/1.0' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function fetchCoinCap(symbol, base = 'USDT') {
  try {
    const sym = String(symbol).replace(new RegExp(`${base}$`, 'i'), '').toLowerCase();
    const url = `https://api.coincap.io/v2/assets/${sym}`;
    const text = await httpGet(url);
    const data = JSON.parse(text);
    const price = Number(data?.data?.priceUsd || 0);
    if (!price) return null;
    return { exchange: 'coincap', price, updatedAt: Date.now() };
  } catch {
    return null;
  }
}

async function fetchBinance(symbol) {
  try {
    const text = await httpGet(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
    const data = JSON.parse(text);
    const price = Number(data?.price || 0);
    if (!price) return null;
    return { exchange: 'binance_public', price, updatedAt: Date.now() };
  } catch {
    return null;
  }
}

async function fetchMEXC(symbol) {
  try {
    const text = await httpGet(`https://api.mexc.com/api/v3/ticker/price?symbol=${symbol}`);
    const data = JSON.parse(text);
    const price = Number(data?.price || 0);
    if (!price) return null;
    return { exchange: 'mexc_public', price, updatedAt: Date.now() };
  } catch {
    return null;
  }
}

async function fetchBybit(symbol) {
  try {
    const text = await httpGet(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`);
    const data = JSON.parse(text);
    const price = Number(data?.result?.list?.[0]?.lastPrice || 0);
    if (!price) return null;
    return { exchange: 'bybit_public', price, updatedAt: Date.now() };
  } catch {
    return null;
  }
}

async function fetchGateio(symbol) {
  try {
    const text = await httpGet(`https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${symbol}`);
    const data = JSON.parse(text);
    const price = Number(data?.[0]?.last || 0);
    if (!price) return null;
    return { exchange: 'gateio_public', price, updatedAt: Date.now() };
  } catch {
    return null;
  }
}

async function pullPrices(symbol) {
  const [cc, bn, mx, by, gt] = await Promise.allSettled([
    fetchCoinCap(symbol),
    fetchBinance(symbol),
    fetchMEXC(symbol),
    fetchBybit(symbol),
    fetchGateio(symbol),
  ]);
  const arr = [cc, bn, mx, by, gt]
    .map(r => (r.status === 'fulfilled' && r.value ? r.value : null))
    .filter(Boolean);
  if (!arr.length) return null;
  arr.sort((a, b) => a.price - b.price);
  return {
    timestamp: Date.now(),
    symbol,
    bid: arr[0].price,
    ask: arr[arr.length - 1].price,
    mid: (arr[0].price + arr[arr.length - 1].price) / 2,
    sources: arr,
  };
}

// ---- Optional CCXT bootstrap (best-effort, non-blocking on errors) ----

let ccxtPkg = null;
if (ADVANCED) {
  ccxtPkg = findCcxt();
}

async function bootstrapCcxt() {
  if (!ADVANCED || !ccxtPkg) return;
  try {
    const { ccxt } = await import(ccxtPkg.ccxtIndex);
    const ex = new ccxt.binance({ enableRateLimit: false });
    for (const symbol of ['BTC/USDT','ETH/USDT']) {
      try {
        const ticker = await ex.fetchTicker(symbol);
        if (ticker?.last) {
          console.log(`[ccxt] ${symbol} binance=${Number(ticker.last).toFixed(2)}`);
        }
      } catch {}
    }
  } catch (e) {
    console.warn('[ws-feed] CCXT bootstrap failed:', e?.message || e);
  }
}

// ---- Loop ----

const SYMBOLS = (process.env.SYMBOLS || 'BTCUSDT,ETHUSDT').split(',').map(s => s.trim()).filter(Boolean);
console.log(`[ws-feed] starting for ${SYMBOLS.join(', ')}`);
setTimeout(bootstrapCcxt, 0);

const FEED_INTERVAL_MS = Number(process.env.FEED_INTERVAL_MS || 5000);
(async () => {
  for (;;) {
    const results = await Promise.allSettled(SYMBOLS.map((s) => pullPrices(s)));
    const latest = {};
    for (const r of results) {
      if (r.status !== 'fulfilled' || !r.value) continue;
      latest[r.value.symbol] = r.value;
      console.log(`[ws-feed] ${r.value.symbol} mid=${r.value.mid.toFixed(4)} bid=${r.value.bid.toFixed(4)} ask=${r.value.ask.toFixed(4)} sources=${r.value.sources.map(x=>x.exchange).join(',')}`);
    }

    const payload = JSON.stringify({
      type: 'ws-feed',
      ts: Date.now(),
      symbols: latest,
    });

    await new Promise((resolve) => {
      const req = https.request({
        hostname: new URL(WORKER_URL).hostname,
        path: '/api/ws-prices',
        method: 'POST',
        headers: {
          'x-admin-token': ADMIN_TOKEN,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
      }, (res) => {
        res.on('data', () => {});
        res.on('end', resolve);
      });
      req.on('error', resolve);
      req.write(payload);
      req.end();
    }).catch(() => {});

    await new Promise((r) => setTimeout(r, FEED_INTERVAL_MS));
  }
})();
