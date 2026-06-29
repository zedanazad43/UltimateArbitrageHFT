// MegaArbitrageBot - Perps + Funding Rate Executor
const CONFIG = { RISK: { PERPS_NOTIONAL_USD: 150, MIN_FUNDING_SPREAD: 0.01 } };

async function fetchAPI(url, options = {}) {
  const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, ...options });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// ---------- Funding Rate Helpers ----------
async function getMEXCFundingRate(symbol) {
  const data = await fetchAPI(`https://contract.mexc.com/api/v1/contract/funding_rate/${symbol.replace('USDT', '_USDT')}`);
  return parseFloat(data.data.rate);
}
async function getBitgetFundingRate(symbol) {
  const data = await fetchAPI(`https://api.bitget.com/api/v2/mix/market/funding-rate?symbol=${symbol}`);
  return parseFloat(data.data[0].fundingRate);
}

// ---------- Trade Execution ----------
async function placeMEXCOrder(env, symbol, side, quantity) {
  const apiKey = env.MEXC_API_KEY, apiSecret = env.MEXC_API_SECRET;
  if (!apiKey) throw new Error('MEXC keys missing');
  const timestamp = Date.now().toString();
  const params = { symbol, side: side.toUpperCase(), type: 'MARKET', quantity, timestamp };
  const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(apiSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(sorted));
  params.signature = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2,'0')).join('');
  const body = new URLSearchParams(params).toString();
  const resp = await fetch('https://api.mexc.com/api/v3/order', { method: 'POST', headers: { 'X-MEXC-APIKEY': apiKey, 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const data = await resp.json();
  if (data.code) throw new Error(data.msg);
  console.log(`? MEXC ${side} ${symbol}: ${data.orderId}`);
  return data;
}

async function placeBitgetOrder(env, symbol, side, amount) {
  const apiKey = env.BITGET_API_KEY, apiSecret = env.BITGET_API_SECRET, apiPassphrase = env.BITGET_API_PASSPHRASE;
  if (!apiKey) throw new Error('Bitget keys missing');
  const timestamp = Date.now().toString();
  const path = '/api/v2/spot/trade/place-order';
  const bodyObj = { symbol, side: side.toLowerCase(), orderType: 'market', force: 'gtc', size: amount };
  const body = JSON.stringify(bodyObj);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(apiSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signStr = `${timestamp}POST${path}${body}`;
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(signStr));
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig)));
  const headers = {
    'ACCESS-KEY': apiKey, 'ACCESS-SIGN': signature, 'ACCESS-TIMESTAMP': timestamp,
    'ACCESS-PASSPHRASE': apiPassphrase, 'Content-Type': 'application/json', 'locale': 'en-US'
  };
  const resp = await fetch(`https://api.bitget.com${path}`, { method: 'POST', headers, body });
  const data = await resp.json();
  if (data.code !== '00000') throw new Error(data.msg);
  console.log(`? Bitget ${side} ${symbol}: ${data.data.orderId}`);
  return data;
}

// ---------- Funding Rate Arbitrage ----------
async function checkFundingRateArbitrage(env) {
  for (const symbol of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']) {
    try {
      const mexcRate = await getMEXCFundingRate(symbol);
      const bitgetRate = await getBitgetFundingRate(symbol);
      const spread = Math.abs(mexcRate - bitgetRate) * 100;
      console.log(`?? Funding ${symbol}: MEXC ${(mexcRate*100).toFixed(4)}% | Bitget ${(bitgetRate*100).toFixed(4)}% | Spread ${spread.toFixed(4)}%`);
      if (spread > CONFIG.RISK.MIN_FUNDING_SPREAD) {
        console.log(`?? ???? ?????? ????? ${symbol}: ??? ???? ??? ${mexcRate < bitgetRate ? 'MEXC' : 'Bitget'} ????? ??? ${mexcRate > bitgetRate ? 'MEXC' : 'Bitget'}`);
        // Open hedge: long spot on lower funding, short perp on higher funding
        const size = CONFIG.RISK.PERPS_NOTIONAL_USD;
        const price = (await fetchAPI(`https://api.mexc.com/api/v3/ticker/price?symbol=${symbol}`)).price;
        const amount = (size / price).toFixed(6);
        if (mexcRate < bitgetRate) {
          await placeMEXCOrder(env, symbol, 'BUY', amount);
          // Open Bitget short perp (needs futures API)
        } else {
          await placeBitgetOrder(env, symbol, 'buy', amount);
          // Open MEXC short perp
        }
      }
    } catch (e) { console.warn(`?? ??? ??? ????? ${symbol}:`, e.message); }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/execute' && request.method === 'POST') {
      const opp = await request.json();
      console.log(`?? ????? ????: ${opp.type || 'unknown'}`, opp);
      if (opp.type === 'cex_arb') {
        const amount = (opp.amount / (opp.buy === 'MEXC' ? opp.mexcPrice : opp.bitgetPrice)).toFixed(6);
        if (opp.buy === 'MEXC') await placeMEXCOrder(env, opp.symbol, 'BUY', amount);
        else await placeBitgetOrder(env, opp.symbol, 'buy', amount);
        if (opp.sell === 'MEXC') await placeMEXCOrder(env, opp.symbol, 'SELL', amount);
        else await placeBitgetOrder(env, opp.symbol, 'sell', amount);
      }
      return new Response('? ?? ????? ??????');
    }
    if (url.pathname === '/funding-scan') {
      await checkFundingRateArbitrage(env);
      return new Response('Funding scan completed');
    }
    return new Response('Perps + Funding Executor');
  }
};
