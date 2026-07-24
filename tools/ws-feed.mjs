/**
 * ws-feed.mjs — guarded CCXT/Hyperliquid/CoinCap feed with Windows-safe startup.
 */

import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ADVANCED = process.env.WS_FEED_ADVANCED !== 'false';
const WORKER_URL = process.env.WORKER_URL || 'https://ultimatearbitragehft.zedanazad43.workers.dev';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '309400';
const HL_TIMEOUT_MS = Number(process.env.HL_TIMEOUT_MS || 3000);
const CCXT_TIMEOUT_MS = Number(process.env.CCXT_TIMEOUT_MS || 4000);

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
    ...(process.env.NODE_PATH ? process.env.NODE_PATH.split(path.delimiter).map(x => path.join(x, 'ws', 'index.js')) : []),
  ];
  for (const p of candidates) if (fs.existsSync(p)) return { wsIndex: p };
  return null;
}
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const transport = u.protocol === 'https:' ? https : http;
    const req = transport.get(url, { headers: { 'User-Agent': 'ws-feed/1.0', Accept: 'application/json' } }, (res) => {
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
    const text = await httpGet(`https://api.coincap.io/v2/assets/${sym}`);
    const data = JSON.parse(text);
    const price = Number(data?.data?.priceUsd || 0);
    if (!price) return null;
    return { exchange: 'coincap', price, updatedAt: Date.now() };
  } catch { return null; }
}
async function fetchBinance(symbol) {
  try {
    const text = await httpGet(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
    const data = JSON.parse(text);
    const price = Number(data?.price || 0);
    if (!price) return null;
    return { exchange: 'binance_public', price, updatedAt: Date.now() };
  } catch { return null; }
}
async function fetchMEXC(symbol) {
  try {
    const text = await httpGet(`https://api.mexc.com/api/v3/ticker/price?symbol=${symbol}`);
    const data = JSON.parse(text);
    const price = Number(data?.price || 0);
    if (!price) return null;
    return { exchange: 'mexc_public', price, updatedAt: Date.now() };
  } catch { return null; }
}
async function fetchBybit(symbol) {
  try {
    const text = await httpGet(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`);
    const data = JSON.parse(text);
    const price = Number(data?.result?.list?.[0]?.lastPrice || 0);
    if (!price) return null;
    return { exchange: 'bybit_public', price, updatedAt: Date.now() };
  } catch { return null; }
}
async function fetchGateio(symbol) {
  try {
    const text = await httpGet(`https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${symbol}`);
    const data = JSON.parse(text);
    const price = Number(data?.[0]?.last || 0);
    if (!price) return null;
    return { exchange: 'gateio_public', price, updatedAt: Date.now() };
  } catch { return null; }
}
async function pullPrices(symbol) {
  const [cc, bn, mx, by, gt] = await Promise.allSettled([
    fetchCoinCap(symbol), fetchBinance(symbol), fetchMEXC(symbol), fetchBybit(symbol), fetchGateio(symbol),
  ]);
  const arr = [cc, bn, mx, by, gt].map(r => (r.status === 'fulfilled' && r.value ? r.value : null)).filter(Boolean);
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
async function postToWorker(payload) {
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
    }, (res) => { res.on('data', () => {}); res.on('end', resolve); });
    req.on('error', resolve);
    req.setTimeout(10000, () => { req.destroy(); resolve(); });
    req.write(payload);
    req.end();
  }).catch(() => {});
}
async function bootstrapCcxtGuarded() {
  if (!ADVANCED) return;
  const ccxtPkg = findCcxt();
  if (!ccxtPkg) { console.warn('[ws-feed] ccxt not installed'); return; }
  try {
    const start = Date.now();
    const mod = await import(ccxtPkg.ccxtIndex);
    if (Date.now() - start > CCXT_TIMEOUT_MS) { console.warn('[ws-feed] ccxt load exceeded timeout'); return; }
    const ex = new mod.ccxt.binance({ enableRateLimit: false });
    for (const symbol of ['BTC/USDT', 'ETH/USDT']) {
      try {
        const ticker = await ex.fetchTicker(symbol);
        if (ticker?.last) console.log(`[ccxt] ${symbol} binance=${Number(ticker.last).toFixed(2)}`);
      } catch {}
    }
  } catch (e) {
    console.warn('[ws-feed] CCXT bootstrap failed:', e?.message || e);
  }
}
async function bootstrapHyperliquidGuarded() {
  if (!ADVANCED || !('hyperliquid' in (await import('node:module')).global || false)) return;
  try {
    const start = Date.now();
    const mod = await import('hyperliquid');
    if (Date.now() - start > HL_TIMEOUT_MS) { console.warn('[ws-feed] hyperliquid load exceeded timeout'); return; }
    const client = new mod.HyperLanClient?.({}).catch?.(() => {}) || mod;
    console.log('[ws-feed] Hyperliquid SDK warmed');
  } catch (e) {
    console.warn('[ws-feed] Hyperliquid bootstrap failed:', e?.message || e);
  }
}

const SYMBOLS = (process.env.SYMBOLS || 'BTCUSDT,ETHUSDT').split(',').map(s => s.trim()).filter(Boolean);
console.log(`[ws-feed] starting for ${SYMBOLS.join(', ')}`);
bootstrapCcxtGuarded().catch(() => {});
bootstrapHyperliquidGuarded().catch(() => {});

const FEED_INTERVAL_MS = Number(process.env.FEED_INTERVAL_MS || 5000);
(async () => {
  for (;;) {
    const results = await Promise.allSettled(SYMBOLS.map((s) => pullPrices(s)));
    const latest = {};
    for (const r of results) {
      if (r.status !== 'fulfilled' || !r.value) continue;
      latest[r.value.symbol] = r.value;
      console.log(`[ws-feed] ${r.value.symbol} mid=${r.value.mid.toFixed(4)} bid=${r.value.bid.toFixed(4)} ask=${r.value.ask.toFixed(4)} sources=${r.value.sources.map(x => x.exchange).join(',')}`);
    }
    const payload = JSON.stringify({ type: 'ws-feed', ts: Date.now(), symbols: latest });
    await postToWorker(payload);
    await new Promise((r) => setTimeout(r, FEED_INTERVAL_MS));
  }
})();
