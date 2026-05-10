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

// ── Credential alias helpers ──────────────────────────────────────────────────

/**
 * Alternate env-var names accepted for credential keys that users may have
 * already configured under a different naming convention.
 * Canonical key is tried first; aliases are tried in order.
 */
const CRED_ALIASES = {
  KUCOIN_SECRET_KEY:  ['KUCOIN_API_SECRET'],
  BITGET_SECRET_KEY:  ['BITGET_API_SECRET'],
  BITMART_SECRET_KEY: ['BITMART_API_SECRET'],
};

/**
 * Reads a credential from env by its canonical key name, transparently
 * falling back to any configured aliases when the canonical key is absent.
 * Returns the value string, or undefined if neither the canonical key nor any
 * alias is set in env.
 */
function resolveEnvKey(env, canonicalKey) {
  if (env[canonicalKey]) return env[canonicalKey];
  for (const alias of (CRED_ALIASES[canonicalKey] || [])) {
    if (env[alias]) return env[alias];
  }
  return undefined;
}

/**
 * Returns an error message for a missing credential that includes alias hints.
 */
function missingCredError(canonicalKey) {
  const aliases = CRED_ALIASES[canonicalKey];
  return aliases?.length
    ? `${canonicalKey} (or ${aliases.join(' or ')}) is not configured`
    : `${canonicalKey} is not configured`;
}

// ── Safe JSON parsing ─────────────────────────────────────────────────────────

/** Maximum number of raw-body characters to include in non-JSON error messages. */
const MAX_ERROR_SNIPPET_LENGTH = 200;

/**
 * Reads the response body as text then parses it as JSON.
 * When the body is not valid JSON (e.g. a Cloudflare error page or plain-text
 * rate-limit message), throws a descriptive error that includes the HTTP status
 * code and the first MAX_ERROR_SNIPPET_LENGTH characters of the raw body instead
 * of a cryptic SyntaxError.
 *
 * @param {Response} resp     – fetch() Response object
 * @param {string}   context  – short label for the exchange/call (e.g. "OKX trading")
 */
async function parseJsonResponse(resp, context = '') {
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch (parseErr) {
    const snippet = text.slice(0, MAX_ERROR_SNIPPET_LENGTH);
    const prefix  = context ? `${context}: ` : '';
    throw new Error(`${prefix}Non-JSON response (HTTP ${resp.status}): ${snippet}`, { cause: parseErr });
  }
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
  const data = await parseJsonResponse(resp, 'MEXC account');
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
 * BUY uses quoteOrderQty (USDT amount); SELL uses quantity (base asset).
 */
export async function placeMarketOrderMEXC(env, symbol, side, quantity, sizeUsd) {
  const apiKey    = env.MEXC_API_KEY;
  const apiSecret = env.MEXC_API_SECRET;
  if (!apiKey)    throw new Error('MEXC_API_KEY is not configured');
  if (!apiSecret) throw new Error('MEXC_API_SECRET is not configured');

  const timestamp = Date.now().toString();
  const params = { symbol, side: side.toUpperCase(), type: 'MARKET', timestamp };

  if (side.toUpperCase() === 'BUY') {
    // Use quoteOrderQty only when caller provided a valid positive USDT notional.
    if (typeof sizeUsd === 'number' && Number.isFinite(sizeUsd) && sizeUsd > 0) {
      params.quoteOrderQty = sizeUsd.toFixed(2);
    } else {
      // Fallback: allow market buy by base quantity when sizeUsd isn't provided.
      params.quantity = quantity;
    }
  } else {
    params.quantity = quantity;
  }

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
  const data = await parseJsonResponse(resp, 'MEXC order');
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
  // MEXC Futures side codes: 1=open long, 2=close short (buy), 3=open short, 4=close long
  const sideCode = side === 'LONG' ? 1 : 3;

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
  const data = await parseJsonResponse(resp, 'MEXC futures order');
  if (!data.success) throw new Error(data.message || 'MEXC Futures order error');
  return data;
}

// ── Binance ───────────────────────────────────────────────────────────────────

/**
 * Fetches the Binance spot account balance for a given asset (default: USDT).
 * recvWindow=10000 gives a 10-second window to absorb clock drift between
 * the Cloudflare Worker and Binance servers (default 5 s is often too tight).
 */
export async function getBinanceBalance(env, asset = 'USDT') {
  const apiKey    = env.BINANCE_API_KEY;
  const apiSecret = env.BINANCE_API_SECRET;
  if (!apiKey)    throw new Error('BINANCE_API_KEY is not configured');
  if (!apiSecret) throw new Error('BINANCE_API_SECRET is not configured');

  const timestamp = Date.now().toString();
  const query     = `timestamp=${timestamp}&recvWindow=10000`;
  const signature = await hmacHex(apiSecret, query);

  const resp = await fetch(
    `https://api.binance.com/api/v3/account?${query}&signature=${signature}`,
    { headers: { 'X-MBX-APIKEY': apiKey } }
  );
  const data = await parseJsonResponse(resp, 'Binance account');
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
  const data = await parseJsonResponse(resp, 'Binance order');
  if (data.code) throw new Error(data.msg || `Binance spot error ${data.code}`);
  return data;
}

// ── KuCoin ────────────────────────────────────────────────────────────────────

/**
 * Fetches the KuCoin spot account balance for a given asset (default: USDT).
 * KuCoin API v2: passphrase is HMAC-SHA256 signed.
 *
 * Queries ALL account types (main, trade, margin) without the `type` filter so
 * that funds sitting in the main (deposit) wallet are included.  The `reduce`
 * sums `available` across every returned account entry; `holds` is summed for
 * the locked amount.
 */
export async function getKuCoinBalance(env, asset = 'USDT') {
  const apiKey     = env.KUCOIN_API_KEY;
  const apiSecret  = resolveEnvKey(env, 'KUCOIN_SECRET_KEY');
  const passphrase = env.KUCOIN_PASSPHRASE;
  if (!apiKey)     throw new Error('KUCOIN_API_KEY is not configured');
  if (!apiSecret)  throw new Error(missingCredError('KUCOIN_SECRET_KEY'));
  if (!passphrase) throw new Error('KUCOIN_PASSPHRASE is not configured');

  const timestamp     = Date.now().toString();
  const path          = `/api/v1/accounts?currency=${asset}`;
  const strToSign     = timestamp + 'GET' + path;
  const signature     = await hmacBase64(apiSecret, strToSign);
  const encPassphrase = await hmacBase64(apiSecret, passphrase);

  const resp = await fetch(`https://api.kucoin.com${path}`, {
    headers: {
      'KC-API-KEY':         apiKey,
      'KC-API-SIGN':        signature,
      'KC-API-TIMESTAMP':   timestamp,
      'KC-API-PASSPHRASE':  encPassphrase,
      'KC-API-KEY-VERSION': '2'
    }
  });
  const data = await parseJsonResponse(resp, 'KuCoin balance');
  if (data.code !== '200000') throw new Error(data.msg || `KuCoin balance error ${data.code}`);

  const accounts = data.data || [];
  const free   = accounts.reduce((sum, acc) => sum + parseFloat(acc.available || '0'), 0);
  const locked = accounts.reduce((sum, acc) => sum + parseFloat(acc.holds    || '0'), 0);
  return { free, locked };
}

/**
 * Places a market order on KuCoin spot.
 * BUY uses `funds` (USDT amount); SELL uses `size` (base asset amount).
 * Symbol format: BTC-USDT.
 */
export async function placeMarketOrderKuCoin(env, symbol, side, quantity, sizeUsd) {
  const apiKey     = env.KUCOIN_API_KEY;
  const apiSecret  = resolveEnvKey(env, 'KUCOIN_SECRET_KEY');
  const passphrase = env.KUCOIN_PASSPHRASE;
  if (!apiKey)     throw new Error('KUCOIN_API_KEY is not configured');
  if (!apiSecret)  throw new Error(missingCredError('KUCOIN_SECRET_KEY'));
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
  const data = await parseJsonResponse(resp, 'KuCoin order');
  if (data.code !== '200000') throw new Error(data.msg || `KuCoin spot error ${data.code}`);
  return data;
}

// ── OKX ───────────────────────────────────────────────────────────────────────

/**
 * Fetches the OKX balance for a given asset (default: USDT).
 *
 * OKX has two balance pools:
 *   1. Trading account  — /api/v5/account/balance   (funds available for spot/futures)
 *   2. Funding account  — /api/v5/asset/balances     (deposit wallet, withdraw source)
 *
 * Both are queried and their available balances are summed so that users who
 * have not yet transferred funds from the funding wallet to the trading account
 * still see a non-zero balance.
 */
export async function getOKXBalance(env, asset = 'USDT') {
  const apiKey     = env.OKX_API_KEY;
  const apiSecret  = env.OKX_API_SECRET;
  const passphrase = env.OKX_PASSPHRASE;
  if (!apiKey)     throw new Error('OKX_API_KEY is not configured');
  if (!apiSecret)  throw new Error('OKX_API_SECRET is not configured');
  if (!passphrase) throw new Error('OKX_PASSPHRASE is not configured');

  // ── 1. Trading (unified) account ─────────────────────────────────────────
  const tradingTs   = new Date().toISOString();
  const tradingPath = `/api/v5/account/balance?ccy=${asset}`;
  const tradingSig  = await hmacBase64(apiSecret, tradingTs + 'GET' + tradingPath);

  const tradingResp = await fetch(`https://www.okx.com${tradingPath}`, {
    headers: {
      'OK-ACCESS-KEY':        apiKey,
      'OK-ACCESS-SIGN':       tradingSig,
      'OK-ACCESS-TIMESTAMP':  tradingTs,
      'OK-ACCESS-PASSPHRASE': passphrase
    }
  });
  const tradingData = await parseJsonResponse(tradingResp, 'OKX trading balance');
  if (tradingData.code !== '0') throw new Error(tradingData.msg || `OKX balance error ${tradingData.code}`);

  const details    = tradingData.data?.[0]?.details || [];
  const tradingBal = details.find(d => d.ccy === asset);
  const tradingFree   = parseFloat(tradingBal?.availBal  || '0');
  const tradingLocked = parseFloat(tradingBal?.frozenBal || '0');

  // ── 2. Funding account ────────────────────────────────────────────────────
  const fundingTs   = new Date().toISOString();
  const fundingPath = `/api/v5/asset/balances?ccy=${asset}`;
  const fundingSig  = await hmacBase64(apiSecret, fundingTs + 'GET' + fundingPath);

  const fundingResp = await fetch(`https://www.okx.com${fundingPath}`, {
    headers: {
      'OK-ACCESS-KEY':        apiKey,
      'OK-ACCESS-SIGN':       fundingSig,
      'OK-ACCESS-TIMESTAMP':  fundingTs,
      'OK-ACCESS-PASSPHRASE': passphrase
    }
  });
  const fundingData = await parseJsonResponse(fundingResp, 'OKX funding balance');
  let fundingFree   = 0;
  let fundingLocked = 0;
  if (fundingData.code === '0') {
    const fundingBal = (fundingData.data || []).find(d => d.ccy === asset);
    fundingFree   = parseFloat(fundingBal?.availBal  || '0');
    fundingLocked = parseFloat(fundingBal?.frozenBal || '0');
  }

  return {
    free:   tradingFree   + fundingFree,
    locked: tradingLocked + fundingLocked
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
  const data = await parseJsonResponse(resp, 'OKX order');
  if (data.code !== '0') throw new Error(data.msg || `OKX order error ${data.code}`);
  return data;
}

// ── Bitget ────────────────────────────────────────────────────────────────────

/**
 * Fetches the Bitget spot account balance for a given asset (default: USDT).
 */
export async function getBitgetBalance(env, asset = 'USDT') {
  const apiKey     = env.BITGET_API_KEY;
  const apiSecret  = resolveEnvKey(env, 'BITGET_SECRET_KEY');
  const passphrase = env.BITGET_API_PASSPHRASE;
  if (!apiKey)     throw new Error('BITGET_API_KEY is not configured');
  if (!apiSecret)  throw new Error(missingCredError('BITGET_SECRET_KEY'));
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
  const data = await parseJsonResponse(resp, 'Bitget balance');
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
  const apiSecret  = resolveEnvKey(env, 'BITGET_SECRET_KEY');
  const passphrase = env.BITGET_API_PASSPHRASE;
  if (!apiKey)     throw new Error('BITGET_API_KEY is not configured');
  if (!apiSecret)  throw new Error(missingCredError('BITGET_SECRET_KEY'));
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
  const data = await parseJsonResponse(resp, 'Bitget order');
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
  const apiSecret = resolveEnvKey(env, 'BITMART_SECRET_KEY');
  const memo      = env.BITMART_MEMO;
  if (!apiKey)    throw new Error('BITMART_API_KEY is not configured');
  if (!apiSecret) throw new Error(missingCredError('BITMART_SECRET_KEY'));
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
  const data = await parseJsonResponse(resp, 'Bitmart balance');
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
  const apiSecret = resolveEnvKey(env, 'BITMART_SECRET_KEY');
  const memo      = env.BITMART_MEMO;
  if (!apiKey)    throw new Error('BITMART_API_KEY is not configured');
  if (!apiSecret) throw new Error(missingCredError('BITMART_SECRET_KEY'));
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
  const data = await parseJsonResponse(resp, 'Bitmart order');
  if (data.code !== 1000) throw new Error(data.message || `Bitmart order error ${data.code}`);
  return data;
}

// ── Bybit ─────────────────────────────────────────────────────────────────────

/**
 * Fetches the Bybit unified account wallet balance for a given asset (default: USDT).
 */
export async function getBybitBalance(env, asset = 'USDT') {
  const apiKey    = env.BYBIT_API_KEY;
  const apiSecret = env.BYBIT_API_SECRET;
  if (!apiKey)    throw new Error('BYBIT_API_KEY is not configured');
  if (!apiSecret) throw new Error('BYBIT_API_SECRET is not configured');

  const timestamp  = Date.now().toString();
  const recvWindow = '5000';
  const params     = `accountType=UNIFIED&coin=${asset}`;
  const rawSign    = timestamp + apiKey + recvWindow + params;
  const signature  = await hmacHex(apiSecret, rawSign);

  const resp = await fetch(
    `https://api.bybit.com/v5/account/wallet-balance?${params}`,
    {
      headers: {
        'X-BAPI-API-KEY':     apiKey,
        'X-BAPI-TIMESTAMP':   timestamp,
        'X-BAPI-RECV-WINDOW': recvWindow,
        'X-BAPI-SIGN':        signature
      }
    }
  );
  const data = await parseJsonResponse(resp, 'Bybit balance');
  if (data.retCode !== 0) throw new Error(data.retMsg || `Bybit balance error ${data.retCode}`);

  const coins = data?.result?.list?.[0]?.coin || [];
  const coin  = coins.find(c => c.coin === asset);
  return {
    free:   parseFloat(coin?.availableToWithdraw || coin?.walletBalance || '0'),
    locked: parseFloat(coin?.locked || '0')
  };
}

/**
 * Places a market order on Bybit spot (V5 API).
 * BUY uses marketUnit=quoteCoin (spend USDT); SELL uses marketUnit=baseCoin.
 */
export async function placeMarketOrderBybit(env, symbol, side, quantity, sizeUsd) {
  const apiKey    = env.BYBIT_API_KEY;
  const apiSecret = env.BYBIT_API_SECRET;
  if (!apiKey)    throw new Error('BYBIT_API_KEY is not configured');
  if (!apiSecret) throw new Error('BYBIT_API_SECRET is not configured');

  const timestamp  = Date.now().toString();
  const recvWindow = '5000';

  const orderObj = {
    category:   'spot',
    symbol,
    side:       side === 'BUY' ? 'Buy' : 'Sell',
    orderType:  'Market',
    qty:        side === 'BUY' ? sizeUsd.toFixed(8) : quantity,
    marketUnit: side === 'BUY' ? 'quoteCoin'        : 'baseCoin'
  };

  const bodyStr   = JSON.stringify(orderObj);
  const rawSign   = timestamp + apiKey + recvWindow + bodyStr;
  const signature = await hmacHex(apiSecret, rawSign);

  const resp = await fetch('https://api.bybit.com/v5/order/create', {
    method: 'POST',
    headers: {
      'X-BAPI-API-KEY':     apiKey,
      'X-BAPI-TIMESTAMP':   timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow,
      'X-BAPI-SIGN':        signature,
      'Content-Type':       'application/json'
    },
    body: bodyStr
  });
  const data = await parseJsonResponse(resp, 'Bybit order');
  if (data.retCode !== 0) throw new Error(data.retMsg || `Bybit order error ${data.retCode}`);
  return data;
}

// ── Gate.io ───────────────────────────────────────────────────────────────────

/** Returns HMAC-SHA512 as a lowercase hex string (used by Gate.io). */
async function hmacSha512Hex(secret, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Returns SHA-256 hex digest of a string (used by Gate.io request signing). */
async function sha256Hex(data) {
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Fetches the Gate.io spot account balance for a given asset (default: USDT).
 */
export async function getGateioBalance(env, asset = 'USDT') {
  const apiKey    = env.GATEIO_API_KEY;
  const apiSecret = env.GATEIO_API_SECRET;
  if (!apiKey)    throw new Error('GATEIO_API_KEY is not configured');
  if (!apiSecret) throw new Error('GATEIO_API_SECRET is not configured');

  const method    = 'GET';
  const path      = '/api/v4/spot/accounts';
  const query     = `currency=${asset}`;
  const bodyHash  = await sha256Hex('');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const rawSign   = `${method}\n${path}\n${query}\n${bodyHash}\n${timestamp}`;
  const signature = await hmacSha512Hex(apiSecret, rawSign);

  const resp = await fetch(`https://api.gateio.ws${path}?${query}`, {
    headers: {
      'KEY':       apiKey,
      'SIGN':      signature,
      'Timestamp': timestamp
    }
  });
  const data = await parseJsonResponse(resp, 'Gateio balance');
  if (!Array.isArray(data)) throw new Error(`Gateio balance error: ${JSON.stringify(data)}`);

  const acc = data.find(a => a.currency === asset);
  return {
    free:   parseFloat(acc?.available || '0'),
    locked: parseFloat(acc?.locked    || '0')
  };
}

/**
 * Places a market order on Gate.io spot.
 * BUY: amount is in quote currency (USDT); SELL: amount is in base currency.
 */
export async function placeMarketOrderGateio(env, symbol, side, quantity, sizeUsd) {
  const apiKey    = env.GATEIO_API_KEY;
  const apiSecret = env.GATEIO_API_SECRET;
  if (!apiKey)    throw new Error('GATEIO_API_KEY is not configured');
  if (!apiSecret) throw new Error('GATEIO_API_SECRET is not configured');

  const gateSymbol = symbol.replace(/USDT$/, '_USDT');
  const method     = 'POST';
  const path       = '/api/v4/spot/orders';
  const query      = '';

  const orderObj = {
    currency_pair: gateSymbol,
    type:          'market',
    side:          side.toLowerCase(),
    time_in_force: 'ioc',
    amount:        side === 'BUY' ? sizeUsd.toFixed(8) : quantity
  };

  const bodyStr   = JSON.stringify(orderObj);
  const bodyHash  = await sha256Hex(bodyStr);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const rawSign   = `${method}\n${path}\n${query}\n${bodyHash}\n${timestamp}`;
  const signature = await hmacSha512Hex(apiSecret, rawSign);

  const resp = await fetch(`https://api.gateio.ws${path}`, {
    method: 'POST',
    headers: {
      'KEY':          apiKey,
      'SIGN':         signature,
      'Timestamp':    timestamp,
      'Content-Type': 'application/json'
    },
    body: bodyStr
  });
  const data = await parseJsonResponse(resp, 'Gateio order');
  if (data.label) throw new Error(`Gateio order error: ${data.label} — ${data.message || ''}`);
  return data;
}

// ── HTX (Huobi) ───────────────────────────────────────────────────────────────

/**
 * Fetches the HTX spot account balance for a given asset (default: USDT).
 * Uses HTX REST API v1 with HMAC-SHA256 signature.
 */
export async function getHTXBalance(env, asset = 'usdt') {
  const apiKey    = env.HTX_API_KEY;
  const apiSecret = env.HTX_API_SECRET;
  if (!apiKey)    throw new Error('HTX_API_KEY is not configured');
  if (!apiSecret) throw new Error('HTX_API_SECRET is not configured');

  const method    = 'GET';
  const host      = 'api.huobi.pro';
  const path      = '/v1/account/accounts';
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, '');
  const params    = new URLSearchParams({
    AccessKeyId:      apiKey,
    SignatureMethod:  'HmacSHA256',
    SignatureVersion: '2',
    Timestamp:        timestamp
  });
  const payload    = `${method}\n${host}\n${path}\n${params.toString()}`;
  const signature  = await hmacBase64(apiSecret, payload);
  params.append('Signature', signature);

  const resp = await fetch(`https://${host}${path}?${params}`, { method });
  const data = await parseJsonResponse(resp, 'HTX accounts');
  if (data.status !== 'ok') throw new Error(data['err-msg'] || `HTX accounts error`);

  // Look up the balance for the specific account ID with 'spot' subtype
  const spotAccounts = (data.data || []).filter(a => a.type === 'spot');
  if (spotAccounts.length === 0) return { free: 0, locked: 0 };

  const accountId = spotAccounts[0].id;

  const balPath    = `/v1/account/accounts/${accountId}/balance`;
  const balParams  = new URLSearchParams({
    AccessKeyId:      apiKey,
    SignatureMethod:  'HmacSHA256',
    SignatureVersion: '2',
    Timestamp:        timestamp
  });
  const balPayload   = `${method}\n${host}\n${balPath}\n${balParams.toString()}`;
  const balSignature = await hmacBase64(apiSecret, balPayload);
  balParams.append('Signature', balSignature);

  const balResp = await fetch(`https://${host}${balPath}?${balParams}`);
  const balData = await parseJsonResponse(balResp, 'HTX balance');
  if (balData.status !== 'ok') throw new Error(balData['err-msg'] || 'HTX balance error');

  const lowerAsset = asset.toLowerCase();
  const list       = balData.data?.list || [];
  let free = 0, locked = 0;
  for (const entry of list) {
    if (entry.currency !== lowerAsset) continue;
    if (entry.type === 'trade')  free   = parseFloat(entry.balance || '0');
    if (entry.type === 'frozen') locked = parseFloat(entry.balance || '0');
  }
  return { free, locked };
}

/**
 * Places a market order on HTX spot.
 * BUY: uses buy-market (USDT amount); SELL: uses sell-market (base asset amount).
 */
export async function placeMarketOrderHTX(env, symbol, side, quantity, sizeUsd) {
  const apiKey    = env.HTX_API_KEY;
  const apiSecret = env.HTX_API_SECRET;
  if (!apiKey)    throw new Error('HTX_API_KEY is not configured');
  if (!apiSecret) throw new Error('HTX_API_SECRET is not configured');

  const method     = 'POST';
  const host       = 'api.huobi.pro';
  const timestamp  = new Date().toISOString().replace(/\.\d{3}Z$/, '');
  const htxSymbol  = symbol.toLowerCase();  // BTCUSDT → btcusdt

  // Determine order type: buy-market or sell-market
  const orderType  = side.toUpperCase() === 'BUY' ? 'buy-market' : 'sell-market';
  // buy-market amount is in quote currency (USDT), sell-market in base currency
  const amount     = side.toUpperCase() === 'BUY' ? sizeUsd.toFixed(2) : quantity;

  // Step 1: get spot account ID (cached in practice; fetched once per request here)
  const acctPath  = '/v1/account/accounts';
  const acctQS    = new URLSearchParams({
    AccessKeyId: apiKey, SignatureMethod: 'HmacSHA256',
    SignatureVersion: '2', Timestamp: timestamp
  });
  const acctSig   = await hmacBase64(apiSecret, `GET\n${host}\n${acctPath}\n${acctQS.toString()}`);
  acctQS.append('Signature', acctSig);
  const acctResp  = await fetch(`https://${host}${acctPath}?${acctQS}`);
  const acctData  = await parseJsonResponse(acctResp, 'HTX account lookup');
  if (acctData.status !== 'ok') throw new Error(acctData['err-msg'] || 'HTX account lookup failed');
  const accountId = (acctData.data || []).find(a => a.type === 'spot')?.id;
  if (!accountId) throw new Error('HTX: no spot account found');

  // Step 2: place the order
  const orderPath = '/v1/order/orders/place';
  const orderQS   = new URLSearchParams({
    AccessKeyId: apiKey, SignatureMethod: 'HmacSHA256',
    SignatureVersion: '2', Timestamp: timestamp
  });
  const orderBodyObj = {
    'account-id': accountId,
    symbol:       htxSymbol,
    type:         orderType,
    amount,
    source:       'spot-api'
  };
  const orderBodyStr = JSON.stringify(orderBodyObj);
  const orderSig     = await hmacBase64(
    apiSecret,
    `${method}\n${host}\n${orderPath}\n${orderQS.toString()}`
  );
  orderQS.append('Signature', orderSig);

  const resp = await fetch(`https://${host}${orderPath}?${orderQS}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: orderBodyStr
  });
  const data = await parseJsonResponse(resp, 'HTX order');
  if (data.status !== 'ok') throw new Error(data['err-msg'] || `HTX order error`);
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
  bitmart: ['BITMART_API_KEY', 'BITMART_SECRET_KEY', 'BITMART_MEMO'],
  htx:     ['HTX_API_KEY', 'HTX_API_SECRET'],
  // bybit and gateio are price-data sources only (German regulatory restrictions)
};

/**
 * Exchanges excluded from live execution (data-only price feeds).
 * bybit/gateio: German regulatory restrictions (BaFin).
 * kraken/coinbase: public price feeds used for wider market coverage;
 *   execution credentials are not configured — data-only.
 * NOTE: perp feed labels (mexc_perp, binance_perp, okx_perp, bybit_perp) are
 * opportunity buyExchange/sellExchange values — they are NOT in this set so the
 * DATA_ONLY guard in executeTrade() does not block isPerp opportunities before
 * they reach the perp routing branch.
 */
export const DATA_ONLY_EXCHANGES = new Set(['bybit', 'gateio', 'kraken', 'coinbase']);
export const ACTIVE_EXECUTION_EXCHANGES = [
  'mexc', 'binance', 'kucoin', 'okx', 'bitget', 'bitmart', 'htx'
];

/**
 * Returns true if all required API credentials for the given exchange are configured.
 * Accepts alias key names (e.g. KUCOIN_API_SECRET in place of KUCOIN_SECRET_KEY).
 */
export function hasExchangeCredentials(env, exchange) {
  const keys = EXCHANGE_CRED_KEYS[exchange?.toLowerCase()];
  if (!keys) return false;
  return keys.every(k => !!resolveEnvKey(env, k));
}

/**
 * Returns the list of required credential keys for an exchange (for error messages).
 */
export function getRequiredCredentialKeys(exchange) {
  return EXCHANGE_CRED_KEYS[exchange?.toLowerCase()] || [];
}

/**
 * Returns the list of canonical credential keys that are not configured for the
 * given exchange, accounting for alias names.  A key is NOT considered missing
 * when an accepted alias is present in env.
 * Labels include "(or ALIAS)" hints where aliases exist.
 */
export function getMissingCredentialKeys(env, exchange) {
  const keys = EXCHANGE_CRED_KEYS[exchange?.toLowerCase()] || [];
  return keys
    .filter(k => !resolveEnvKey(env, k))
    .map(k => {
      const aliases = CRED_ALIASES[k];
      return aliases?.length ? `${k} (or ${aliases.join(' or ')})` : k;
    });
}

/**
 * Returns the list of exchanges that have valid credentials configured in env.
 */
export function getConfiguredExchanges(env) {
  return ACTIVE_EXECUTION_EXCHANGES.filter(ex => hasExchangeCredentials(env, ex));
}

/**
 * Selects the best available exchange for execution based on:
 * 1. Credential availability
 * 2. USDT balance (picks highest balance)
 * Returns null if no exchange has sufficient balance.
 *
 * @param {object} env        — Cloudflare Worker env bindings
 * @param {number} requiredUsd — minimum USDT balance needed
 * @returns {Promise<string|null>} exchange name or null
 */
export async function selectBestExchange(env, requiredUsd) {
  const configured = getConfiguredExchanges(env);
  if (configured.length === 0) return null;

  const balances = await Promise.allSettled(
    configured.map(async ex => ({ ex, bal: await getExchangeBalance(env, ex, 'USDT') }))
  );

  let bestEx  = null;
  let bestBal = 0;

  for (const result of balances) {
    if (result.status !== 'fulfilled') continue;
    const { ex, bal } = result.value;
    if (bal >= requiredUsd && bal > bestBal) {
      bestEx  = ex;
      bestBal = bal;
    }
  }

  return bestEx;
}

/**
 * Gets the free balance for the specified asset on the given exchange.
 *
 * Throws on any API or credential error — callers must handle the rejection
 * (e.g. with Promise.allSettled or a per-exchange try/catch).  An unknown
 * exchange name returns 0 as a safe no-op rather than throwing.
 */
export async function getExchangeBalance(env, exchange, asset = 'USDT') {
  switch (exchange?.toLowerCase()) {
    case 'mexc':    return (await getMEXCBalance(env, asset)).free;
    case 'binance': return (await getBinanceBalance(env, asset)).free;
    case 'kucoin':  return (await getKuCoinBalance(env, asset)).free;
    case 'okx':     return (await getOKXBalance(env, asset)).free;
    case 'bitget':  return (await getBitgetBalance(env, asset)).free;
    case 'bitmart': return (await getBitmartBalance(env, asset)).free;
    case 'htx':     return (await getHTXBalance(env, asset.toLowerCase())).free;
    // bybit/gateio: data-only, no live execution
    default:        return 0;
  }
}

/**
 * Places a spot market order on the specified exchange.
 * bybit and gateio throw — they are data-only (German regulatory restrictions).
 *
 * @param {object} env       — Cloudflare Worker env bindings
 * @param {string} exchange  — exchange identifier
 * @param {string} symbol    — trading pair, e.g. 'BTCUSDT'
 * @param {string} side      — 'BUY' | 'SELL'
 * @param {string} quantity  — base asset amount (used for SELL)
 * @param {number} sizeUsd   — quote amount in USDT (used for BUY)
 */
export async function placeExchangeMarketOrder(env, exchange, symbol, side, quantity, sizeUsd) {
  switch (exchange?.toLowerCase()) {
    case 'mexc':    return placeMarketOrderMEXC(env, symbol, side, quantity, sizeUsd);
    case 'binance': return placeMarketOrderBinance(env, symbol, side, quantity, sizeUsd);
    case 'kucoin':  return placeMarketOrderKuCoin(env, symbol, side, quantity, sizeUsd);
    case 'okx':     return placeMarketOrderOKX(env, symbol, side, quantity, sizeUsd);
    case 'bitget':  return placeMarketOrderBitget(env, symbol, side, quantity, sizeUsd);
    case 'bitmart': return placeMarketOrderBitmart(env, symbol, side, quantity, sizeUsd);
    case 'htx':     return placeMarketOrderHTX(env, symbol, side, quantity, sizeUsd);
    case 'bybit':
    case 'gateio':
      throw new Error(
        `${exchange} is not available for live execution (German regulatory restrictions). ` +
        `Use paper trading mode or switch to MEXC, Binance, KuCoin, OKX, Bitget, Bitmart, or HTX.`
      );
    default:
      throw new Error(`No execution layer for exchange: ${exchange}`);
  }
}

function toFiniteNumber(value) {
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

function sumFillFees(fills) {
  if (!Array.isArray(fills)) return 0;
  return fills.reduce((sum, fill) => {
    const commission = toFiniteNumber(
      fill?.commission
      ?? fill?.fee
      ?? fill?.fees
      ?? fill?.fillFee
    );
    return commission ? sum + commission : sum;
  }, 0);
}

/**
 * Extracts best-effort fill metrics from heterogeneous exchange order responses.
 * Returns null when executed quantity or quote quantity cannot be determined.
 */
export function extractFillMetrics(orderResult) {
  const root = orderResult?.data?.[0]
    ?? orderResult?.data
    ?? orderResult?.result
    ?? orderResult;
  if (!root || typeof root !== 'object') return null;

  const executedQty = toFiniteNumber(
    root.executedQty
    ?? root.dealSize
    ?? root.filledSize
    ?? root.accFillSz
    ?? root.filledAmount
  );

  let quoteQty = toFiniteNumber(
    root.cummulativeQuoteQty
    ?? root.cumulativeQuoteQty
    ?? root.dealFunds
    ?? root.filledValue
    ?? root.accFillNotionalUsd
    ?? root.filledAmountQuote
  );

  if (!quoteQty && Array.isArray(root.fills)) {
    quoteQty = root.fills.reduce((sum, fill) => {
      const price = toFiniteNumber(fill?.price);
      const qty = toFiniteNumber(fill?.qty ?? fill?.quantity);
      return (price && qty) ? sum + (price * qty) : sum;
    }, 0);
  }

  const avgPrice = toFiniteNumber(root.avgPrice ?? root.priceAvg ?? root.fillPrice);
  if (!quoteQty && avgPrice && executedQty) {
    quoteQty = avgPrice * executedQty;
  }

  if (!executedQty || !quoteQty || executedQty <= 0 || quoteQty <= 0) return null;

  return {
    executedQty,
    quoteQty,
    avgPrice: quoteQty / executedQty,
    feeQty: sumFillFees(root.fills),
  };
}


