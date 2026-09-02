// nexus/src/brokerage.js — Unified brokerage adapters (free-first)

const DEFAULT_ALPACA_BASE_URL = 'https://paper-api.alpaca.markets';
const DEFAULT_IBKR_BRIDGE_TIMEOUT_MS = 15000;

export const SUPPORTED_BROKERS = ['alpaca', 'ibkr', 'paper'];

function normalizeTrimmed(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  return raw.length > 0 ? raw : '';
}

function getAlpacaConfig(env) {
  const key = normalizeTrimmed(env?.APCA_API_KEY_ID || env?.ALPACA_API_KEY);
  const secret = normalizeTrimmed(env?.APCA_API_SECRET_KEY || env?.ALPACA_API_SECRET);
  const baseUrl = normalizeTrimmed(env?.ALPACA_BASE_URL) || DEFAULT_ALPACA_BASE_URL;
  return { key, secret, baseUrl };
}

function getIbkrConfig(env) {
  const bridgeUrl = normalizeTrimmed(env?.IBKR_BRIDGE_URL);
  const bridgeToken = normalizeTrimmed(env?.IBKR_BRIDGE_TOKEN);
  const accountId = normalizeTrimmed(env?.IBKR_ACCOUNT_ID);
  const timeoutMs = Math.max(1000, Number(env?.IBKR_BRIDGE_TIMEOUT_MS || DEFAULT_IBKR_BRIDGE_TIMEOUT_MS));
  return { bridgeUrl, bridgeToken, accountId, timeoutMs };
}

function normalizeBrokerSymbol(symbol) {
  const s = String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.endsWith('USDT')) return `${s.slice(0, -4)}USD`;
  if (s.endsWith('USD')) return s;
  return s;
}

function buildAlpacaHeaders(config) {
  return {
    'APCA-API-KEY-ID': config.key,
    'APCA-API-SECRET-KEY': config.secret,
    'Content-Type': 'application/json',
  };
}

function buildIbkrHeaders(config) {
  const headers = { 'Content-Type': 'application/json' };
  if (config.bridgeToken) {
    headers.Authorization = `Bearer ${config.bridgeToken}`;
  }
  return headers;
}

async function fetchIbkrBridge(config, path, options = {}) {
  if (!config.bridgeUrl) {
    throw new Error('IBKR_BRIDGE_URL is not configured');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const resp = await fetch(`${config.bridgeUrl.replace(/\/$/, '')}${path}`, {
      ...options,
      headers: { ...buildIbkrHeaders(config), ...(options.headers || {}) },
      signal: controller.signal,
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => 'ibkr bridge request failed');
      throw new Error(`IBKR bridge error HTTP ${resp.status}: ${detail.slice(0, 200)}`);
    }
    return resp.json();
  } finally {
    clearTimeout(timeout);
  }
}

export function hasBrokerCredentials(env, broker) {
  switch (String(broker || '').toLowerCase()) {
    case 'alpaca': {
      const cfg = getAlpacaConfig(env);
      return Boolean(cfg.key && cfg.secret);
    }
    case 'ibkr': {
      const cfg = getIbkrConfig(env);
      return Boolean(cfg.bridgeUrl);
    }
    case 'paper':
      return true;
    default:
      return false;
  }
}

export function getMissingBrokerCredentialKeys(env, broker) {
  switch (String(broker || '').toLowerCase()) {
    case 'alpaca': {
      const missing = [];
      if (!normalizeTrimmed(env?.APCA_API_KEY_ID || env?.ALPACA_API_KEY)) {
        missing.push('APCA_API_KEY_ID (or ALPACA_API_KEY)');
      }
      if (!normalizeTrimmed(env?.APCA_API_SECRET_KEY || env?.ALPACA_API_SECRET)) {
        missing.push('APCA_API_SECRET_KEY (or ALPACA_API_SECRET)');
      }
      return missing;
    }
    case 'ibkr': {
      const missing = [];
      if (!normalizeTrimmed(env?.IBKR_BRIDGE_URL)) {
        missing.push('IBKR_BRIDGE_URL');
      }
      return missing;
    }
    case 'paper':
      return [];
    default:
      return ['Unsupported broker'];
  }
}

export async function getBrokerAccountSummary(env, broker) {
  const brokerName = String(broker || '').toLowerCase();
  if (brokerName === 'paper') {
    return {
      broker: 'paper',
      accountId: 'paper-local',
      accountStatus: 'active',
      currency: 'USD',
      buyingPower: null,
      cash: null,
      equity: null,
      paper: true,
      note: 'Simulated broker adapter for strategy testing',
    };
  }

  if (brokerName === 'ibkr') {
    const config = getIbkrConfig(env);
    if (!config.bridgeUrl) {
      throw new Error('IBKR bridge is not configured');
    }

    const data = await fetchIbkrBridge(config, '/account', { method: 'GET' });
    return {
      broker: 'ibkr',
      accountId: data?.accountId || config.accountId || null,
      accountStatus: data?.status || 'connected',
      currency: data?.currency || 'USD',
      buyingPower: Number(data?.buyingPower || 0),
      cash: Number(data?.cash || 0),
      equity: Number(data?.equity || 0),
      paper: Boolean(data?.paper),
      bridge: config.bridgeUrl,
    };
  }

  if (brokerName !== 'alpaca') {
    throw new Error(`Unsupported broker: ${brokerName}`);
  }

  const config = getAlpacaConfig(env);
  if (!config.key || !config.secret) {
    throw new Error('Alpaca credentials are not configured');
  }

  const resp = await fetch(`${config.baseUrl}/v2/account`, {
    method: 'GET',
    headers: buildAlpacaHeaders(config),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => 'alpaca account request failed');
    throw new Error(`Alpaca account error HTTP ${resp.status}: ${detail.slice(0, 200)}`);
  }

  const data = await resp.json();
  return {
    broker: 'alpaca',
    accountId: data?.id || null,
    accountStatus: data?.status || 'unknown',
    currency: data?.currency || 'USD',
    buyingPower: Number(data?.buying_power || 0),
    cash: Number(data?.cash || 0),
    equity: Number(data?.equity || 0),
    paper: config.baseUrl.includes('paper-api.alpaca.markets'),
  };
}

export async function placeBrokerMarketOrder(env, broker, order) {
  const brokerName = String(broker || '').toLowerCase();
  const side = String(order?.side || '').toLowerCase();
  if (!['buy', 'sell'].includes(side)) {
    throw new Error('side must be BUY or SELL');
  }

  const normalizedSymbol = normalizeBrokerSymbol(order?.symbol);
  if (!normalizedSymbol) {
    throw new Error('symbol is required');
  }

  const quantityNum = Number(order?.quantity || 0);
  const sizeUsdNum = Number(order?.sizeUsd || 0);

  if (brokerName === 'paper') {
    const qty = Number.isFinite(quantityNum) && quantityNum > 0 ? quantityNum : null;
    const notional = Number.isFinite(sizeUsdNum) && sizeUsdNum > 0 ? sizeUsdNum : null;
    if (!qty && !notional) {
      throw new Error('Provide quantity (>0) or sizeUsd (>0 for BUY)');
    }
    return {
      broker: 'paper',
      orderId: `paper-${Date.now()}`,
      status: 'accepted',
      symbol: normalizedSymbol,
      side,
      qty,
      notional,
      simulated: true,
    };
  }

  if (brokerName === 'ibkr') {
    const config = getIbkrConfig(env);
    if (!config.bridgeUrl) {
      throw new Error('IBKR bridge is not configured');
    }

    const payload = {
      accountId: config.accountId || undefined,
      symbol: normalizedSymbol,
      side: side.toUpperCase(),
      orderType: 'MKT',
      quantity: Number.isFinite(quantityNum) && quantityNum > 0 ? quantityNum : undefined,
      notional: Number.isFinite(sizeUsdNum) && sizeUsdNum > 0 ? Number(sizeUsdNum.toFixed(2)) : undefined,
      timeInForce: 'DAY',
    };

    if (!payload.quantity && !payload.notional) {
      throw new Error('Provide quantity (>0) or sizeUsd (>0 for BUY)');
    }

    const data = await fetchIbkrBridge(config, '/order', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    return {
      broker: 'ibkr',
      orderId: data?.orderId || data?.id || null,
      status: data?.status || 'submitted',
      symbol: data?.symbol || normalizedSymbol,
      side: String(data?.side || side).toLowerCase(),
      qty: data?.quantity ?? payload.quantity ?? null,
      notional: data?.notional ?? payload.notional ?? null,
      raw: data,
    };
  }

  if (brokerName !== 'alpaca') {
    throw new Error(`Unsupported broker: ${brokerName}`);
  }

  const config = getAlpacaConfig(env);
  if (!config.key || !config.secret) {
    throw new Error('Alpaca credentials are not configured');
  }

  const payload = {
    symbol: normalizedSymbol,
    side,
    type: 'market',
    time_in_force: 'day',
  };

  if (side === 'buy' && Number.isFinite(sizeUsdNum) && sizeUsdNum > 0) {
    payload.notional = sizeUsdNum.toFixed(2);
  } else if (Number.isFinite(quantityNum) && quantityNum > 0) {
    payload.qty = quantityNum.toString();
  } else {
    throw new Error('Provide quantity (>0) or sizeUsd (>0 for BUY)');
  }

  const resp = await fetch(`${config.baseUrl}/v2/orders`, {
    method: 'POST',
    headers: buildAlpacaHeaders(config),
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => 'alpaca order request failed');
    throw new Error(`Alpaca order error HTTP ${resp.status}: ${detail.slice(0, 200)}`);
  }

  const data = await resp.json();
  return {
    broker: 'alpaca',
    orderId: data?.id || null,
    status: data?.status || 'accepted',
    symbol: data?.symbol || normalizedSymbol,
    side: data?.side || side,
    qty: data?.qty || payload.qty || null,
    notional: data?.notional || payload.notional || null,
    raw: data,
  };
}
