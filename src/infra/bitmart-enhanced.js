/**
 * Enhanced BitMart Exchange Handler
 * Provides resilient order placement, balance fetching, and rate limit management
 * with external proxy support, circuit breaker, and adaptive backoff.
 */

import { hmacBase64, parseJsonResponse } from '../exchange.js';
import { getGlobalProxyPool } from './proxy-pool.js';
import { getExternalProxyManager } from './external-proxy.js';

const BITMART_API_BASE = 'https://api-cloud.bitmart.com';

// Circuit breaker for BitMart
let _circuitBreakerOpen = false;
let _circuitBreakerTripsAttemptCount = 0;
const CIRCUIT_BREAKER_THRESHOLD = 5; // Open after 5 consecutive failures
const CIRCUIT_BREAKER_RESET_MS = 60000; // 1 minute

// Enhanced rate limit tracking
const _bitmartRateLimitState = {
  requests: [],
  currentWindow: Date.now(),
  windowDurationMs: 1000,
  maxRequestsPerWindow: 10, // BitMart: 10 req/sec
};

/**
 * Records a request timestamp for rate limiting.
 */
function recordBitmartRequest() {
  const now = Date.now();
  const windowStart = _bitmartRateLimitState.currentWindow;

  if (now - windowStart > _bitmartRateLimitState.windowDurationMs) {
    _bitmartRateLimitState.requests = [];
    _bitmartRateLimitState.currentWindow = now;
  }

  _bitmartRateLimitState.requests.push(now);

  if (_bitmartRateLimitState.requests.length > _bitmartRateLimitState.maxRequestsPerWindow) {
    const oldestRequest = _bitmartRateLimitState.requests[0];
    const timeSinceOldest = now - oldestRequest;
    const waitMs = _bitmartRateLimitState.windowDurationMs - timeSinceOldest + 10;
    return { throttled: true, waitMs };
  }

  return { throttled: false };
}

/**
 * Calculates adaptive backoff with exponential growth + jitter.
 */
function calculateAdaptiveBackoff(attempt, baseMs = 500) {
  const exponential = baseMs * Math.pow(2, attempt);
  const jitter = Math.random() * 0.3 * exponential; // ±15%
  return Math.min(exponential + jitter, 30000); // Cap at 30s
}

/**
 * Checks and manages circuit breaker state.
 */
function checkCircuitBreaker() {
  if (!_circuitBreakerOpen) return true; // OK to proceed

  // Check if circuit should reset
  if (Date.now() - _circuitBreakerTripsAttemptCount > CIRCUIT_BREAKER_RESET_MS) {
    console.warn('[bitmart-enhanced] Circuit breaker reset');
    _circuitBreakerOpen = false;
    _circuitBreakerTripsAttemptCount = 0;
    return true;
  }

  throw new Error(`[BitMart] Circuit breaker OPEN. Service temporarily unavailable. Retry in ${CIRCUIT_BREAKER_RESET_MS}ms`);
}

/**
 * Records circuit breaker trip.
 */
function tripCircuitBreaker() {
  _circuitBreakerTripsAttemptCount++;
  if (_circuitBreakerTripsAttemptCount >= CIRCUIT_BREAKER_THRESHOLD) {
    _circuitBreakerOpen = true;
    console.error(`[bitmart-enhanced] Circuit breaker OPENED after ${_circuitBreakerTripsAttemptCount} consecutive failures`);
  }
}

/**
 * Resets circuit breaker on successful request.
 */
function resetCircuitBreaker() {
  _circuitBreakerTripsAttemptCount = 0;
}

export class BitmartEnhanced {
  constructor(env) {
    this.env = env;
    this.apiKey = env.BITMART_API_KEY;
    this.apiSecret = env.BITMART_API_SECRET || env.BITMART_SECRET_KEY;
    this.memo = env.BITMART_MEMO;
    this.localProxyPool = getGlobalProxyPool(env);
    this.externalProxyManager = getExternalProxyManager(env);
    this.useExternalProxy = (env.BITMART_USE_EXTERNAL_PROXY || 'false').toLowerCase() === 'true';
  }

  /**
   * Validates credentials.
   */
  validateCredentials() {
    if (!this.apiKey) throw new Error('BITMART_API_KEY is not configured');
    if (!this.apiSecret) throw new Error('BITMART_API_SECRET is not configured');
    if (!this.memo) throw new Error('BITMART_MEMO is not configured');
  }

  /**
   * Fetches balance with enhanced resilience.
   */
  async getBalance(asset = 'USDT') {
    this.validateCredentials();
    checkCircuitBreaker();

    const maxRetries = 5;
    let lastError = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Rate limiting
        const rateLimitCheck = recordBitmartRequest();
        if (rateLimitCheck.throttled) {
          await new Promise(r => setTimeout(r, rateLimitCheck.waitMs));
        }

        const timestamp = Date.now().toString();
        const strToSign = `${timestamp}#${this.memo}#`;
        const signature = await hmacBase64(this.apiSecret, strToSign);

        const url = `${BITMART_API_BASE}/spot/v1/wallet`;
        const headers = {
          'X-BM-KEY': this.apiKey,
          'X-BM-SIGN': signature,
          'X-BM-TIMESTAMP': timestamp,
          'Content-Type': 'application/json',
        };

        let response;
        if (this.useExternalProxy) {
          response = await this.externalProxyManager.fetchWithFallback(url, { headers }, 10000);
        } else {
          response = await this.localProxyPool.fetchWithProxy(url, { headers }, 10000);
        }

        const data = await parseJsonResponse(response, 'BitMart balance');

        // Rate limit codes
        if (data.code === 429 || data.code === 50006) {
          const backoff = calculateAdaptiveBackoff(attempt, 800);
          console.warn(`[bitmart-enhanced] Rate limited (${data.code}), retry in ${backoff.toFixed(0)}ms`);
          await new Promise(r => setTimeout(r, backoff));
          continue;
        }

        // Success
        if (data.code === 1000) {
          const wallet = (data.data?.wallet || []).find(w => w.currency === asset);
          resetCircuitBreaker();
          return {
            free: parseFloat(wallet?.available || '0'),
            locked: parseFloat(wallet?.frozen || '0'),
          };
        }

        throw new Error(`BitMart error ${data.code}: ${data.message || 'Unknown'}`);
      } catch (err) {
        lastError = err;
        tripCircuitBreaker();

        if (attempt < maxRetries - 1) {
          const backoff = calculateAdaptiveBackoff(attempt, 1000);
          console.warn(`[bitmart-enhanced] Balance query attempt ${attempt + 1}/${maxRetries} failed: ${err.message}. Retry in ${backoff.toFixed(0)}ms`);
          await new Promise(r => setTimeout(r, backoff));
        }
      }
    }

    throw lastError || new Error('BitMart balance query failed after all retries');
  }

  /**
   * Places market order with enhanced resilience.
   */
  async placeMarketOrder(symbol, side, quantity, sizeUsd) {
    this.validateCredentials();
    checkCircuitBreaker();

    const bmSymbol = symbol.includes('_') ? symbol : symbol.replace(/USDT$/, '_USDT');
    const maxRetries = 5;
    let lastError = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Rate limiting
        const rateLimitCheck = recordBitmartRequest();
        if (rateLimitCheck.throttled) {
          await new Promise(r => setTimeout(r, rateLimitCheck.waitMs));
        }

        const timestamp = Date.now().toString();

        const orderObj = {
          symbol: bmSymbol,
          side: side.toLowerCase(),
          type: 'market',
        };

        if (side.toUpperCase() === 'BUY') {
          orderObj.notional = sizeUsd.toFixed(8);
        } else {
          orderObj.size = quantity;
        }

        const bodyStr = JSON.stringify(orderObj);
        const strToSign = `${timestamp}#${this.memo}#${bodyStr}`;
        const signature = await hmacBase64(this.apiSecret, strToSign);

        const url = `${BITMART_API_BASE}/spot/v2/submit_order`;
        const headers = {
          'X-BM-KEY': this.apiKey,
          'X-BM-SIGN': signature,
          'X-BM-TIMESTAMP': timestamp,
          'Content-Type': 'application/json',
        };

        let response;
        if (this.useExternalProxy) {
          response = await this.externalProxyManager.fetchWithFallback(url, {
            method: 'POST',
            headers,
            body: bodyStr,
          }, 15000);
        } else {
          response = await this.localProxyPool.fetchWithProxy(url, {
            method: 'POST',
            headers,
            body: bodyStr,
          }, 15000);
        }

        const data = await parseJsonResponse(response, 'BitMart order');

        // Rate limit
        if (data.code === 429 || data.code === 50006) {
          const backoff = calculateAdaptiveBackoff(attempt, 1200);
          console.warn(`[bitmart-enhanced] Rate limited on order (${data.code}), retry in ${backoff.toFixed(0)}ms`);
          await new Promise(r => setTimeout(r, backoff));
          continue;
        }

        // Insufficient balance
        if (data.code === 40001 || data.code === 50011) {
          throw new Error(`BitMart insufficient balance: ${data.message || data.code}`);
        }

        // Trading restricted
        if (data.code === 40005 || data.code === 40006) {
          throw new Error(`BitMart trading restricted: ${data.message || data.code}`);
        }

        // Success
        if (data.code === 1000) {
          resetCircuitBreaker();
          return {
            orderId: data.data?.order_id,
            symbol: bmSymbol,
            side,
            size: quantity || sizeUsd,
            timestamp: new Date().toISOString(),
          };
        }

        throw new Error(`BitMart error ${data.code}: ${data.message || 'Unknown'}`);
      } catch (err) {
        lastError = err;
        tripCircuitBreaker();

        if (attempt < maxRetries - 1) {
          const backoff = calculateAdaptiveBackoff(attempt, 1500);
          console.warn(`[bitmart-enhanced] Order attempt ${attempt + 1}/${maxRetries} failed: ${err.message}. Retry in ${backoff.toFixed(0)}ms`);
          await new Promise(r => setTimeout(r, backoff));
        }
      }
    }

    throw lastError || new Error('BitMart order placement failed after all retries');
  }

  /**
   * Returns circuit breaker and rate limit stats.
   */
  getStats() {
    return {
      circuitBreakerOpen: _circuitBreakerOpen,
      circuitBreakerFailures: _circuitBreakerTripsAttemptCount,
      rateLimitRequests: _bitmartRateLimitState.requests.length,
      rateLimitMaxPerWindow: _bitmartRateLimitState.maxRequestsPerWindow,
      externalProxyEnabled: this.useExternalProxy,
      externalProxyStats: this.externalProxyManager?.getStats?.(),
    };
  }
}

/**
 * Global singleton for BitMart enhanced.
 */
let _bitmartEnhanced = null;
export function getBitmartEnhanced(env) {
  if (!_bitmartEnhanced) {
    _bitmartEnhanced = new BitmartEnhanced(env);
  }
  return _bitmartEnhanced;
}

export function resetBitmartEnhanced() {
  _bitmartEnhanced = null;
}

export function resetBitmartCircuitBreaker() {
  _circuitBreakerOpen = false;
  _circuitBreakerTripsAttemptCount = 0;
}
