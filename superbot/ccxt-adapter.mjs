/**
 * SuperBot CCXT-style adapter — cross-exchange market data + normalized symbol handling.
 *
 * Zero-dependency port of the ccxt fetchTicker pattern over public REST endpoints.
 * Mirrors ccxt semantics: unified symbol (BTC/USDT), per-exchange market parsing,
 * graceful per-exchange failure (one venue down never blocks the scan).
 *
 * If the full ccxt npm package is installed in projects/worker-bot (npm i ccxt),
 * the worker's existing bridges/ccxt-bridge.js already covers execution paths;
 * this adapter keeps the control plane dependency-free for public-data scans.
 */

const UA = { 'User-Agent': 'SuperBot/3.0 (+https://github.com/zedanazad43/UltimateArbitrageHFT)' };
const TIMEOUT_MS = 8000;

async function fetchJson(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Public ticker endpoints per exchange. Each parser returns the unified last price
 * for the unified symbol, ccxt-style: { exchange, symbol, price, ok } | { ok:false, error }.
 */
export const ccxtAdapter = {
  symbol: 'BTC/USDT',

  exchanges: [
    {
      id: 'binance',
      url: (s) => {
        const [base, quote] = s.split('/');
        return `https://api.binance.com/api/v3/ticker/price?symbol=${base}${quote}`;
      },
      parse: (j) => Number(j.price),
    },
    {
      id: 'kucoin',
      url: (s) => {
        const [base, quote] = s.split('/');
        return `https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${base}-${quote}`;
      },
      parse: (j) => Number(j?.data?.price),
    },
    {
      id: 'mexc',
      url: (s) => {
        const [base, quote] = s.split('/');
        return `https://api.mexc.com/api/v3/ticker/price?symbol=${base}${quote}`;
      },
      parse: (j) => Number(j.price),
    },
    {
      id: 'htx',
      url: (s) => {
        const [base, quote] = s.split('/');
        return `https://api.huobi.pro/market/detail/merged?symbol=${base.toLowerCase()}${quote.toLowerCase()}`;
      },
      parse: (j) => Number(j?.tick?.close),
    },
    {
      id: 'bitget',
      url: (s) => {
        const [base, quote] = s.split('/');
        return `https://api.bitget.com/api/v2/spot/market/tickers?symbol=${base}${quote}`;
      },
      parse: (j) => Number(j?.data?.[0]?.lastPr ?? j?.data?.[0]?.closePr),
    },
    {
      id: 'gateio',
      url: (s) => {
        const [base, quote] = s.split('/');
        return `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${base}_${quote}`;
      },
      parse: (j) => Number(j?.[0]?.last),
    },
    {
      id: 'kraken',
      url: (s) => {
        const [base, quote] = s.split('/');
        return `https://api.kraken.com/0/public/Ticker?pair=${base}${quote}`;
      },
      parse: (j) => {
        const key = Object.keys(j?.result || {})[0];
        return key ? Number(j.result[key].c[0]) : NaN;
      },
    },
    {
      id: 'coinbase',
      url: (s) => {
        const [base, quote] = s.split('/');
        return `https://api.exchange.coinbase.com/products/${base}-${quote}/ticker`;
      },
      parse: (j) => Number(j.price),
    },
  ],

  async ticker(exchange, symbol) {
    try {
      const json = await fetchJson(exchange.url(symbol));
      const price = exchange.parse(json);
      if (!Number.isFinite(price) || price <= 0) throw new Error('bad price');
      return { exchange: exchange.id, symbol, price, ok: true, ts: Date.now() };
    } catch (err) {
      return { exchange: exchange.id, symbol, ok: false, error: String(err?.message || err), ts: Date.now() };
    }
  },

  async tickerAll(symbol) {
    return Promise.all(this.exchanges.map((ex) => this.ticker(ex, symbol)));
  },

  /** Spread scan: quotes from all venues + best buy/sell pair. */
  async spreadScan(symbol) {
    const quotes = await this.tickerAll(symbol);
    const ok = quotes.filter((q) => q.ok);
    let best = null;
    if (ok.length >= 2) {
      const lo = ok.reduce((a, b) => (a.price <= b.price ? a : b));
      const hi = ok.reduce((a, b) => (a.price >= b.price ? a : b));
      best = {
        buy: lo.exchange,
        sell: hi.exchange,
        grossPct: ((hi.price - lo.price) / lo.price) * 100,
      };
    }
    return { symbol, quotes, best, ts: Date.now() };
  },
};
