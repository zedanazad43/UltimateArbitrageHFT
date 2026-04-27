// nexus/src/exchange.js — Exchange order placement (MEXC, Binance, KuCoin, OKX, Bitget, Bitmart)

// ── HMAC-SHA256 helpers ───────────────────────────────────────────────────────

/** Returns HMAC-SHA256 as a lowercase hex string (used by MEXC & Binance). */
async function hmacHex(secret, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Returns HMAC-SHA256 as a base64 string (used by KuCoin, OKX, Bitget, Bitmart). */
async function hmacBase64(secret, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
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

// ── Binance ───────────────────────────────────────────────────────────────────

/**
 * Fetches the Binance spot account balance for a given asset (default: USDT).
 */
export async function getBinanceBalance(env, asset = 'USDT') {
  const apiKey    = env.BINANCE_API_KEY;
  const apiSecret = env.BINANCE_API_SECRET;
  if (!apiKey)    throw new Error('BINANCE_API_KEY is not configured');
  if (!apiSecret) throw new Error('BINANCE_API_SECRET is not configured');

  const timestamp = Date.now().toString();
  const query     = `timestamp=${timestamp}`;
  const signature = await hmacHex(apiSecret, query);

  const resp = await fetch(
    `https://api.binance.com/api/v3/account?${query}&signature=${signature}`,
    { headers: { 'X-MBX-APIKEY': apiKey } }
  );
  const data = await resp.json();
  if (data.code) throw new Error(data.msg || `Binance account error ${data.code}`);

  const bal = (data.balances || []).find(b => b.asset === asset);
  return {
    free:   parseFloat(bal?.free   || '0'),
    locked: parseFloat(bal?.locked || '0')
  };
}

/**
 * Places a market order on Binance spot.
 * BUY uses quoteOrderQty (USDT); SELL uses quantity (base asset).
 */
export async function placeMarketOrderBinance(env, symbol, side, quantity, sizeUsd) {
  const apiKey    = env.BINANCE_API_KEY;
  const apiSecret = env.BINANCE_API_SECRET;
  if (!apiKey)    throw new Error('BINANCE_API_KEY is not configured');
  if (!apiSecret) throw new Error('BINANCE_API_SECRET is not configured');

  const timestamp = Date.now().toString();
  const params    = { symbol, side: side.toUpperCase(), type: 'MARKET', timestamp };

  if (side.toUpperCase() === 'BUY') {
    params.quoteOrderQty = sizeUsd.toFixed(2);
  } else {
    params.quantity = quantity;
  }

  const sorted    = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
  params.signature = await hmacHex(apiSecret, sorted);

  const body = new URLSearchParams(params).toString();
  const resp = await fetch('https://api.binance.com/api/v3/order', {
    method: 'POST',
    headers: {
      'X-MBX-APIKEY': apiKey,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
  const data = await resp.json();
  if (data.code) throw new Error(data.msg || `Binance spot error ${data.code}`);
  return data;
}

// ── KuCoin ────────────────────────────────────────────────────────────────────

/**
 * Fetches the KuCoin trade account balance for a given asset (default: USDT).
 * KuCoin API v2: passphrase is HMAC-SHA256 signed.
 */
export async function getKuCoinBalance(env, asset = 'USDT') {
  const apiKey     = env.KUCOIN_API_KEY;
  const apiSecret  = env.KUCOIN_SECRET_KEY;
  const passphrase = env.KUCOIN_PASSPHRASE;
  if (!apiKey)     throw new Error('KUCOIN_API_KEY is not configured');
  if (!apiSecret)  throw new Error('KUCOIN_SECRET_KEY is not configured');
  if (!passphrase) throw new Error('KUCOIN_PASSPHRASE is not configured');

  const timestamp          = Date.now().toString();
  const path               = `/api/v1/accounts?type=trade&currency=${asset}`;
  const strToSign          = timestamp + 'GET' + path;
  const signature          = await hmacBase64(apiSecret, strToSign);
  const encPassphrase      = await hmacBase64(apiSecret, passphrase);

  const resp = await fetch(`https://api.kucoin.com${path}`, {
    headers: {
      'KC-API-KEY':        apiKey,
      'KC-API-SIGN':       signature,
      'KC-API-TIMESTAMP':  timestamp,
      'KC-API-PASSPHRASE': encPassphrase,
      'KC-API-KEY-VERSION': '2'
    }
  });
  const data = await resp.json();
  if (data.code !== '200000') throw new Error(data.msg || `KuCoin balance error ${data.code}`);

  const accounts = data.data || [];
  const free = accounts.reduce((sum, acc) => sum + parseFloat(acc.available || '0'), 0);
  return { free, locked: 0 };
}

/**
 * Places a market order on KuCoin spot.
 * BUY uses `funds` (USDT amount); SELL uses `size` (base asset amount).
 * Symbol format: BTC-USDT.
 */
export async function placeMarketOrderKuCoin(env, symbol, side, quantity, sizeUsd) {
  const apiKey     = env.KUCOIN_API_KEY;
  const apiSecret  = env.KUCOIN_SECRET_KEY;
  const passphrase = env.KUCOIN_PASSPHRASE;
  if (!apiKey)     throw new Error('KUCOIN_API_KEY is not configured');
  if (!apiSecret)  throw new Error('KUCOIN_SECRET_KEY is not configured');
  if (!passphrase) throw new Error('KUCOIN_PASSPHRASE is not configured');

  const kuSymbol  = symbol.replace(/USDT$/, '-USDT');
  const timestamp = Date.now().toString();
  const path      = '/api/v1/orders';

  const orderObj = {
    clientOid: `nexus_${Date.now()}`,
    side:      side.toLowerCase(),
    symbol:    kuSymbol,
    type:      'market'
  };
  if (side.toUpperCase() === 'BUY') {
    orderObj.funds = sizeUsd.toFixed(2);   // quote currency (USDT, 2 decimal precision)
  } else {
    orderObj.size  = quantity;              // base currency
  }

  const bodyStr        = JSON.stringify(orderObj);
  const strToSign      = timestamp + 'POST' + path + bodyStr;
  const signature      = await hmacBase64(apiSecret, strToSign);
  const encPassphrase  = await hmacBase64(apiSecret, passphrase);

  const resp = await fetch(`https://api.kucoin.com${path}`, {
    method: 'POST',
    headers: {
      'KC-API-KEY':         apiKey,
      'KC-API-SIGN':        signature,
      'KC-API-TIMESTAMP':   timestamp,
      'KC-API-PASSPHRASE':  encPassphrase,
      'KC-API-KEY-VERSION': '2',
      'Content-Type':       'application/json'
    },
    body: bodyStr
  });
  const data = await resp.json();
  if (data.code !== '200000') throw new Error(data.msg || `KuCoin spot error ${data.code}`);
  return data;
}

// ── OKX ───────────────────────────────────────────────────────────────────────

/**
 * Fetches the OKX unified/spot account balance for a given asset (default: USDT).
 */
export async function getOKXBalance(env, asset = 'USDT') {
  const apiKey     = env.OKX_API_KEY;
  const apiSecret  = env.OKX_API_SECRET;
  const passphrase = env.OKX_PASSPHRASE;
  if (!apiKey)     throw new Error('OKX_API_KEY is not configured');
  if (!apiSecret)  throw new Error('OKX_API_SECRET is not configured');
  if (!passphrase) throw new Error('OKX_PASSPHRASE is not configured');

  const timestamp  = new Date().toISOString();
  const path       = `/api/v5/account/balance?ccy=${asset}`;
  const strToSign  = timestamp + 'GET' + path;
  const signature  = await hmacBase64(apiSecret, strToSign);

  const resp = await fetch(`https://www.okx.com${path}`, {
    headers: {
      'OK-ACCESS-KEY':        apiKey,
      'OK-ACCESS-SIGN':       signature,
      'OK-ACCESS-TIMESTAMP':  timestamp,
      'OK-ACCESS-PASSPHRASE': passphrase
    }
  });
  const data = await resp.json();
  if (data.code !== '0') throw new Error(data.msg || `OKX balance error ${data.code}`);

  const details = data.data?.[0]?.details || [];
  const bal     = details.find(d => d.ccy === asset);
  return {
    free:   parseFloat(bal?.availBal || '0'),
    locked: parseFloat(bal?.frozenBal || '0')
  };
}

/**
 * Places a market order on OKX spot.
 * BUY: sz = USDT amount, tgtCcy = quote_ccy.
 * SELL: sz = base asset amount.
 * instId format: BTC-USDT.
 */
export async function placeMarketOrderOKX(env, symbol, side, quantity, sizeUsd) {
  const apiKey     = env.OKX_API_KEY;
  const apiSecret  = env.OKX_API_SECRET;
  const passphrase = env.OKX_PASSPHRASE;
  if (!apiKey)     throw new Error('OKX_API_KEY is not configured');
  if (!apiSecret)  throw new Error('OKX_API_SECRET is not configured');
  if (!passphrase) throw new Error('OKX_PASSPHRASE is not configured');

  const okxInstId  = symbol.replace(/USDT$/, '-USDT');
  const timestamp  = new Date().toISOString();
  const path       = '/api/v5/trade/order';

  const orderObj = {
    instId:  okxInstId,
    tdMode:  'cash',
    side:    side.toLowerCase(),
    ordType: 'market'
  };
  if (side.toUpperCase() === 'BUY') {
    orderObj.sz     = sizeUsd.toFixed(8);  // quote currency (USDT)
    orderObj.tgtCcy = 'quote_ccy';
  } else {
    orderObj.sz = quantity;                // base currency
  }

  const bodyStr   = JSON.stringify(orderObj);
  const strToSign = timestamp + 'POST' + path + bodyStr;
  const signature = await hmacBase64(apiSecret, strToSign);

  const resp = await fetch(`https://www.okx.com${path}`, {
    method: 'POST',
    headers: {
      'OK-ACCESS-KEY':        apiKey,
      'OK-ACCESS-SIGN':       signature,
      'OK-ACCESS-TIMESTAMP':  timestamp,
      'OK-ACCESS-PASSPHRASE': passphrase,
      'Content-Type':         'application/json'
    },
    body: bodyStr
  });
  const data = await resp.json();
  if (data.code !== '0') throw new Error(data.msg || `OKX order error ${data.code}`);
  return data;
}

// ── Bitget ────────────────────────────────────────────────────────────────────

/**
 * Fetches the Bitget spot account balance for a given asset (default: USDT).
 */
export async function getBitgetBalance(env, asset = 'USDT') {
  const apiKey     = env.BITGET_API_KEY;
  const apiSecret  = env.BITGET_SECRET_KEY;
  const passphrase = env.BITGET_API_PASSPHRASE;
  if (!apiKey)     throw new Error('BITGET_API_KEY is not configured');
  if (!apiSecret)  throw new Error('BITGET_SECRET_KEY is not configured');
  if (!passphrase) throw new Error('BITGET_API_PASSPHRASE is not configured');

  const timestamp = Date.now().toString();
  const path      = `/api/v2/spot/account/assets?coin=${asset}`;
  const strToSign = timestamp + 'GET' + path;
  const signature = await hmacBase64(apiSecret, strToSign);

  const resp = await fetch(`https://api.bitget.com${path}`, {
    headers: {
      'ACCESS-KEY':        apiKey,
      'ACCESS-SIGN':       signature,
      'ACCESS-TIMESTAMP':  timestamp,
      'ACCESS-PASSPHRASE': passphrase
    }
  });
  const data = await resp.json();
  if (data.code !== '00000') throw new Error(data.msg || `Bitget balance error ${data.code}`);

  const assets = data.data || [];
  const bal    = assets.find(a => a.coin === asset);
  return {
    free:   parseFloat(bal?.available || '0'),
    locked: parseFloat(bal?.frozen    || '0')
  };
}

/**
 * Places a market order on Bitget spot.
 * BUY: size = USDT amount.
 * SELL: size = base asset amount.
 */
export async function placeMarketOrderBitget(env, symbol, side, quantity, sizeUsd) {
  const apiKey     = env.BITGET_API_KEY;
  const apiSecret  = env.BITGET_SECRET_KEY;
  const passphrase = env.BITGET_API_PASSPHRASE;
  if (!apiKey)     throw new Error('BITGET_API_KEY is not configured');
  if (!apiSecret)  throw new Error('BITGET_SECRET_KEY is not configured');
  if (!passphrase) throw new Error('BITGET_API_PASSPHRASE is not configured');

  const timestamp = Date.now().toString();
  const path      = '/api/v2/spot/trade/place-order';

  const orderObj = {
    symbol,
    side:      side.toLowerCase(),
    orderType: 'market',
    force:     'gtc',
    size:      side.toUpperCase() === 'BUY' ? sizeUsd.toFixed(8) : quantity
  };

  const bodyStr   = JSON.stringify(orderObj);
  const strToSign = timestamp + 'POST' + path + bodyStr;
  const signature = await hmacBase64(apiSecret, strToSign);

  const resp = await fetch(`https://api.bitget.com${path}`, {
    method: 'POST',
    headers: {
      'ACCESS-KEY':        apiKey,
      'ACCESS-SIGN':       signature,
      'ACCESS-TIMESTAMP':  timestamp,
      'ACCESS-PASSPHRASE': passphrase,
      'Content-Type':      'application/json'
    },
    body: bodyStr
  });
  const data = await resp.json();
  if (data.code !== '00000') throw new Error(data.msg || `Bitget order error ${data.code}`);
  return data;
}

// ── Bitmart ───────────────────────────────────────────────────────────────────

/**
 * Fetches the Bitmart spot wallet balance for a given asset (default: USDT).
 * Requires BITMART_MEMO (generated when creating the API key on Bitmart).
 */
export async function getBitmartBalance(env, asset = 'USDT') {
  const apiKey    = env.BITMART_API_KEY;
  const apiSecret = env.BITMART_SECRET_KEY;
  const memo      = env.BITMART_MEMO;
  if (!apiKey)    throw new Error('BITMART_API_KEY is not configured');
  if (!apiSecret) throw new Error('BITMART_SECRET_KEY is not configured');
  if (!memo)      throw new Error('BITMART_MEMO is not configured');

  const timestamp = Date.now().toString();
  const strToSign = `${timestamp}#${memo}#`;
  const signature = await hmacBase64(apiSecret, strToSign);

  const resp = await fetch('https://api-cloud.bitmart.com/spot/v1/wallet', {
    headers: {
      'X-BM-KEY':       apiKey,
      'X-BM-SIGN':      signature,
      'X-BM-TIMESTAMP': timestamp
    }
  });
  const data = await resp.json();
  if (data.code !== 1000) throw new Error(data.message || `Bitmart balance error ${data.code}`);

  const wallet = (data.data?.wallet || []).find(w => w.currency === asset);
  return {
    free:   parseFloat(wallet?.available || '0'),
    locked: parseFloat(wallet?.frozen    || '0')
  };
}

/**
 * Places a market order on Bitmart spot.
 * BUY: notional = USDT amount.
 * SELL: size = base asset amount.
 * Symbol format: BTC_USDT.
 */
export async function placeMarketOrderBitmart(env, symbol, side, quantity, sizeUsd) {
  const apiKey    = env.BITMART_API_KEY;
  const apiSecret = env.BITMART_SECRET_KEY;
  const memo      = env.BITMART_MEMO;
  if (!apiKey)    throw new Error('BITMART_API_KEY is not configured');
  if (!apiSecret) throw new Error('BITMART_SECRET_KEY is not configured');
  if (!memo)      throw new Error('BITMART_MEMO is not configured');

  // Bitmart uses underscore symbol format: BTC_USDT, SHIB_USDT, etc.
  const bmSymbol = symbol.replace(/USDT$/, '_USDT');
  const timestamp = Date.now().toString();

  const orderObj = {
    symbol: bmSymbol,
    side:   side.toLowerCase(),
    type:   'market'
  };
  if (side.toUpperCase() === 'BUY') {
    orderObj.notional = sizeUsd.toFixed(8);  // USDT amount
  } else {
    orderObj.size = quantity;                // base asset amount
  }

  const bodyStr   = JSON.stringify(orderObj);
  const strToSign = `${timestamp}#${memo}#${bodyStr}`;
  const signature = await hmacBase64(apiSecret, strToSign);

  const resp = await fetch('https://api-cloud.bitmart.com/spot/v2/submit_order', {
    method: 'POST',
    headers: {
      'X-BM-KEY':       apiKey,
      'X-BM-SIGN':      signature,
      'X-BM-TIMESTAMP': timestamp,
      'Content-Type':   'application/json'
    },
    body: bodyStr
  });
  const data = await resp.json();
  if (data.code !== 1000) throw new Error(data.message || `Bitmart order error ${data.code}`);
  return data;
}

// ── Exchange dispatchers ──────────────────────────────────────────────────────

/**
 * Required environment variable keys for each exchange.
 * Used by hasExchangeCredentials to verify configuration.
 */
const EXCHANGE_CRED_KEYS = {
  mexc:    ['MEXC_API_KEY', 'MEXC_API_SECRET'],
  binance: ['BINANCE_API_KEY', 'BINANCE_API_SECRET'],
  kucoin:  ['KUCOIN_API_KEY', 'KUCOIN_SECRET_KEY', 'KUCOIN_PASSPHRASE'],
  okx:     ['OKX_API_KEY', 'OKX_API_SECRET', 'OKX_PASSPHRASE'],
  bitget:  ['BITGET_API_KEY', 'BITGET_SECRET_KEY', 'BITGET_API_PASSPHRASE'],
  bitmart: ['BITMART_API_KEY', 'BITMART_SECRET_KEY', 'BITMART_MEMO']
};

/**
 * Returns true if all required API credentials for the given exchange are configured.
 */
export function hasExchangeCredentials(env, exchange) {
  const keys = EXCHANGE_CRED_KEYS[exchange?.toLowerCase()];
  if (!keys) return false;
  return keys.every(k => !!env[k]);
}

/**
 * Returns the list of required credential keys for an exchange (for error messages).
 */
export function getRequiredCredentialKeys(exchange) {
  return EXCHANGE_CRED_KEYS[exchange?.toLowerCase()] || [];
}

/**
 * Gets the free balance for the specified asset on the given exchange.
 * Returns 0 on any error (safe fallback — callers should handle insufficient balance).
 */
export async function getExchangeBalance(env, exchange, asset = 'USDT') {
  try {
    switch (exchange?.toLowerCase()) {
      case 'mexc':    return (await getMEXCBalance(env, asset)).free;
      case 'binance': return (await getBinanceBalance(env, asset)).free;
      case 'kucoin':  return (await getKuCoinBalance(env, asset)).free;
      case 'okx':     return (await getOKXBalance(env, asset)).free;
      case 'bitget':  return (await getBitgetBalance(env, asset)).free;
      case 'bitmart': return (await getBitmartBalance(env, asset)).free;
      default:        return 0;
    }
  } catch (e) {
    console.error(`[exchange] ${exchange} balance check failed:`, e.message);
    return 0;
  }
}

/**
 * Places a spot market order on the specified exchange.
 *
 * @param {object} env       — Cloudflare Worker env bindings
 * @param {string} exchange  — exchange identifier (mexc | binance | kucoin | okx | bitget | bitmart)
 * @param {string} symbol    — trading pair in MEXC format, e.g. 'BTCUSDT'
 * @param {string} side      — 'BUY' | 'SELL'
 * @param {string} quantity  — base asset amount (used for SELL and for MEXC BUY)
 * @param {number} sizeUsd   — quote amount in USDT (used for BUY on Binance, KuCoin, OKX, Bitget, Bitmart)
 */
export async function placeExchangeMarketOrder(env, exchange, symbol, side, quantity, sizeUsd) {
  switch (exchange?.toLowerCase()) {
    case 'mexc':    return placeMarketOrderMEXC(env, symbol, side, quantity);
    case 'binance': return placeMarketOrderBinance(env, symbol, side, quantity, sizeUsd);
    case 'kucoin':  return placeMarketOrderKuCoin(env, symbol, side, quantity, sizeUsd);
    case 'okx':     return placeMarketOrderOKX(env, symbol, side, quantity, sizeUsd);
    case 'bitget':  return placeMarketOrderBitget(env, symbol, side, quantity, sizeUsd);
    case 'bitmart': return placeMarketOrderBitmart(env, symbol, side, quantity, sizeUsd);
    default:
      throw new Error(`No execution layer for exchange: ${exchange}`);
  }
}
