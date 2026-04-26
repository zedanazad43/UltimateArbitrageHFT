// nexus/src/exchange.js — Exchange order placement (MEXC spot + futures)

// ── HMAC-SHA256 helper ────────────────────────────────────────────────────────
async function hmacHex(secret, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Fetches the MEXC spot account balance for a given asset (default: USDT).
 * Returns { free: number, locked: number } or throws on error.
 */
export async function getMEXCBalance(env, asset = 'USDT') {
  const apiKey    = env.MEXC_API_KEY;
  const apiSecret = env.MEXC_API_SECRET;
  if (!apiKey)    throw new Error('MEXC_API_KEY is not configured');
  if (!apiSecret) throw new Error('MEXC_API_SECRET is not configured');

  const timestamp = Date.now().toString();
  const query     = `timestamp=${timestamp}`;
  const signature = await hmacHex(apiSecret, query);

  const resp = await fetch(
    `https://api.mexc.com/api/v3/account?${query}&signature=${signature}`,
    { headers: { 'X-MEXC-APIKEY': apiKey } }
  );
  const data = await resp.json();
  if (data.code) throw new Error(data.msg || `MEXC account error ${data.code}`);

  const bal = (data.balances || []).find(b => b.asset === asset);
  return {
    free:   parseFloat(bal?.free   || '0'),
    locked: parseFloat(bal?.locked || '0')
  };
}

/**
 * Returns true when free USDT balance >= requiredUsd.
 * Returns false (safe default) when the API call fails.
 */
export async function hasSufficientUSDT(env, requiredUsd) {
  try {
    const bal = await getMEXCBalance(env, 'USDT');
    return bal.free >= requiredUsd;
  } catch (e) {
    console.error('[exchange] balance check failed:', e.message);
    return false;
  }
}

/**
 * Places a market order on MEXC spot.
 * side: 'BUY' | 'SELL'
 */
export async function placeMarketOrderMEXC(env, symbol, side, quantity) {
  const apiKey    = env.MEXC_API_KEY;
  const apiSecret = env.MEXC_API_SECRET;
  if (!apiKey)    throw new Error('MEXC_API_KEY is not configured');
  if (!apiSecret) throw new Error('MEXC_API_SECRET is not configured');

  const timestamp = Date.now().toString();
  const params = { symbol, side: side.toUpperCase(), type: 'MARKET', quantity, timestamp };
  const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
  params.signature = await hmacHex(apiSecret, sorted);

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
  const apiKey    = env.MEXC_API_KEY;
  const apiSecret = env.MEXC_API_SECRET;
  if (!apiKey)    throw new Error('MEXC_API_KEY is not configured');
  if (!apiSecret) throw new Error('MEXC_API_SECRET is not configured');

  const perpSymbol = symbol.replace('USDT', '_USDT');
  const recvWindow = 5000;
  const timestamp  = Date.now();
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

  const rawSig  = `${timestamp}${apiKey}${recvWindow}${orderBody}`;
  const signature = await hmacHex(apiSecret, rawSig);

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
