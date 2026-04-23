// nexus/src/exchange.js — Exchange order placement (MEXC spot + futures)

/**
 * Places a market order on MEXC spot.
 * side: 'BUY' | 'SELL'
 */
export async function placeMarketOrderMEXC(env, symbol, side, quantity) {
  const apiKey = env.MEXC_API_KEY;
  const apiSecret = env.MEXC_API_SECRET;
  if (!apiKey) throw new Error('MEXC_API_KEY is not configured');
  if (!apiSecret) throw new Error('MEXC_API_SECRET is not configured');

  const timestamp = Date.now().toString();
  const params = { symbol, side: side.toUpperCase(), type: 'MARKET', quantity, timestamp };
  const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(apiSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(sorted));
  params.signature = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  const body = new URLSearchParams(params).toString();
  const resp = await fetch('https://api.mexc.com/api/v3/order', {
    method: 'POST',
    headers: {
      'X-MEXC-APIKEY': apiKey,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
  const data = await resp.json();
  if (data.code) throw new Error(data.msg || `MEXC spot error ${data.code}`);
  return data;
}

/**
 * Places a futures (perpetuals) order on MEXC.
 * side: 'LONG' | 'SHORT'
 */
export async function placeMEXCFuturesOrder(env, symbol, side, quantity, leverage) {
  const apiKey = env.MEXC_API_KEY;
  const apiSecret = env.MEXC_API_SECRET;
  if (!apiKey) throw new Error('MEXC_API_KEY is not configured');
  if (!apiSecret) throw new Error('MEXC_API_SECRET is not configured');

  const perpSymbol = symbol.replace('USDT', '_USDT');
  const recvWindow = 5000;
  const timestamp = Date.now();
  // sideCode: 1=open long, 2=open short
  const sideCode = side === 'LONG' ? 1 : 2;

  const orderBody = JSON.stringify({
    symbol: perpSymbol,
    side: sideCode,
    openType: 1,
    type: 5,
    vol: parseFloat(quantity),
    leverage
  });

  const rawSig = `${timestamp}${apiKey}${recvWindow}${orderBody}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(apiSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(rawSig));
  const signature = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  const resp = await fetch('https://contract.mexc.com/api/v1/private/order/submit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'ApiKey': apiKey,
      'Request-Time': timestamp.toString(),
      'Signature': signature,
      'recv-window': recvWindow.toString()
    },
    body: orderBody
  });
  const data = await resp.json();
  if (!data.success) throw new Error(data.message || 'MEXC Futures order error');
  return data;
}
