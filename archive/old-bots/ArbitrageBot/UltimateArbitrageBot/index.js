// UltimateArbitrageBot - WebSocket Enhanced Orchestrator
const CONFIG = {
  PROFIT: { SPATIAL_ARBITRAGE_CEX: 0.001, DEX_ARBITRAGE: 0.1, PERPS_ARBITRAGE: 0.02 },
  RISK: { PERPS_MIN_CONFIDENCE: 60, DEX_MIN_CONFIDENCE: 40 },
  WS: { MEXC: 'wss://wbs.mexc.com/ws', BITGET: 'wss://ws.bitget.com/v2/ws/public' }
};

const SUPPORTED_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'LINKUSDT', 'UNIUSDT'];
let priceCache = { mexc: {}, bitget: {} };
let wsConnections = {};

// ---------- Admin Auth ----------
function checkAdminToken(request, env) {
  if (!env.ADMIN_TOKEN) return true;
  const token =
    request.headers.get('x-admin-token') ||
    (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') ||
    new URL(request.url).searchParams.get('token');
  return token === env.ADMIN_TOKEN;
}

// ---------- Cross-Chain Price Helpers ----------
async function getAlchemyPrice(symbol, apiKey) {
  const url = `https://api.g.alchemy.com/prices/v1/${apiKey}/tokens/by-symbol?symbols[]=${symbol}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Alchemy price request failed with status ${resp.status}`);
  }
  const data = await resp.json();
  const price = data?.data?.[0]?.prices?.[0]?.value;
  if (!price) {
    throw new Error('Alchemy price response missing value');
  }
  return parseFloat(price);
}
async function getPancakePrice(symbol) {
  const response = await fetch(`https://api.pancakeswap.info/api/v2/tokens/${symbol}`);
  if (!response.ok) {
    throw new Error(`PancakeSwap token request failed with status ${response.status}`);
  }
  const data = await response.json();
  const price = data?.data?.price;
  if (price === undefined || price === null) {
    throw new Error('PancakeSwap token response missing price');
  }
  return parseFloat(data.data.price);
}
async function checkCrossChainArbitrage(env) {
  const ethPrice = await getAlchemyPrice('ETH', env.ALCHEMY_API_KEY);
  const bscPrice = await getPancakePrice('0x2170ed0880ac9a755fd29b2688956bd959f933f8'); // WETH on BSC
  const spread = ((bscPrice - ethPrice) / ethPrice) * 100;
  console.log(`🌐 Cross-Chain ETH: Ethereum ${ethPrice.toFixed(2)} | BSC ${bscPrice.toFixed(2)} | Spread ${spread.toFixed(4)}%`);
  if (Math.abs(spread) > 0.5) {
    const direction = spread > 0 ? 'BUY_ETH_SELL_BSC' : 'BUY_BSC_SELL_ETH';
    console.log(`🎯 Cross-chain opportunity: ${direction} | Spread ${spread.toFixed(4)}%`);
    if (env.DEX_EXECUTOR) {
      await env.DEX_EXECUTOR.fetch('https://dex-executor.zedanazad43.workers.dev/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'cross_chain', direction, spread, ethPrice, bscPrice })
      });
    }
  }
}

// ---------- WebSocket Helpers ----------
function connectWebSocket(url, exchange, symbols, env) {
  const ws = new WebSocket(url);
  ws.onopen = () => {
    console.log(`?? WebSocket ${exchange} connected`);
    if (exchange === 'mexc') {
      ws.send(JSON.stringify({ method: 'SUBSCRIPTION', params: symbols.map(s => `spot@public.ticker.v3.api@${s}`) }));
    } else if (exchange === 'bitget') {
      symbols.forEach(s => {
        ws.send(JSON.stringify({ op: 'subscribe', args: [{ channel: 'ticker', instId: s }] }));
      });
    }
  };
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      let symbol, price;
      if (exchange === 'mexc' && data.c) {
        symbol = data.s; price = parseFloat(data.c);
      } else if (exchange === 'bitget' && data.action === 'snapshot' && data.data?.[0]) {
        symbol = data.arg.instId; price = parseFloat(data.data[0].lastPr);
      }
      if (symbol && price) {
        priceCache[exchange][symbol] = { price, timestamp: Date.now() };
        checkForArbitrageOpportunity(symbol, env);
      }
    } catch {}
  };
  ws.onerror = (e) => console.error(`? WebSocket ${exchange} error:`, e);
  ws.onclose = () => { console.log(`?? WebSocket ${exchange} closed, reconnecting...`); setTimeout(() => connectWebSocket(url, exchange, symbols, env), 5000); };
  return ws;
}

// ---------- Arbitrage Check ----------
async function checkForArbitrageOpportunity(symbol, env) {
  const mexcPrice = priceCache.mexc[symbol]?.price;
  const bitgetPrice = priceCache.bitget[symbol]?.price;
  if (!mexcPrice || !bitgetPrice) return;
  
  const spread = ((bitgetPrice - mexcPrice) / mexcPrice) * 100;
  if (Math.abs(spread) > CONFIG.PROFIT.SPATIAL_ARBITRAGE_CEX) {
    console.log(`📊 CEX opportunity ${symbol}: MEXC $${mexcPrice} | Bitget $${bitgetPrice} | Spread ${spread.toFixed(4)}%`);
    if (env.PERPS_EXECUTOR) {
      await env.PERPS_EXECUTOR.fetch('https://arbitrage-bot.zedanazad43.workers.dev/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'cex_arb', symbol, buy: spread > 0 ? 'MEXC' : 'Bitget', sell: spread > 0 ? 'Bitget' : 'MEXC', amount: 100 })
      });
    }
  }
}

// ---------- Scheduled (fallback) ----------
async function scheduledScan(env) {
  console.log('⏰ Scheduled scan (fallback)');
  for (const symbol of SUPPORTED_SYMBOLS) {
    try {
      const mexc = await fetch(`https://api.mexc.com/api/v3/ticker/price?symbol=${symbol}`).then(r => r.json());
      const bitget = await fetch(`https://api.bitget.com/api/v2/spot/market/tickers?symbol=${symbol}`).then(r => r.json());
      priceCache.mexc[symbol] = { price: parseFloat(mexc.price), timestamp: Date.now() };
      priceCache.bitget[symbol] = { price: parseFloat(bitget.data[0].lastPr), timestamp: Date.now() };
      await checkForArbitrageOpportunity(symbol, env);
    } catch {}
  }
  try {
    await checkCrossChainArbitrage(env);
  } catch (e) {
    console.error('❌ Cross-chain scan failed:', e.message);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Protected scan/ws endpoints require admin token when one is configured
    if (['/scan', '/cross-chain-scan', '/start-ws'].includes(url.pathname)) {
      if (!checkAdminToken(request, env)) {
        return new Response('Unauthorized', { status: 401 });
      }
    }

    if (url.pathname === '/scan') {
      ctx.waitUntil(scheduledScan(env));
      return new Response('Scan started (WebSocket enhanced)');
    }
    if (url.pathname === '/cross-chain-scan') {
      ctx.waitUntil(checkCrossChainArbitrage(env).catch(e => console.error('❌ Cross-chain scan error:', e.message)));
      return new Response('Cross-chain scan started');
    }
    if (url.pathname === '/start-ws') {
      if (!wsConnections.mexc) wsConnections.mexc = connectWebSocket(CONFIG.WS.MEXC, 'mexc', SUPPORTED_SYMBOLS, env);
      if (!wsConnections.bitget) wsConnections.bitget = connectWebSocket(CONFIG.WS.BITGET, 'bitget', SUPPORTED_SYMBOLS, env);
      return new Response('WebSocket connections initiated');
    }
    return new Response('UltimateArbitrageBot WebSocket Orchestrator');
  },
  async scheduled(event, env) { await scheduledScan(env); }
};

export class MarketStreamer {}
