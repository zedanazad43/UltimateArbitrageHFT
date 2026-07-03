// src/utils/liquidity.js — Liquidity Verification & Order Sizing
//
// Validates trade feasibility by checking order book depth, minimum order sizes,
// and estimating slippage for realistic execution.

/**
 * Order book liquidity snapshot
 * @typedef {object} LiquiditySnapshot
 * @property {number} bidDepthUSD    — USD value at best bid
 * @property {number} askDepthUSD    — USD value at best ask
 * @property {number} bidPrice       — best bid price
 * @property {number} askPrice       — best ask price
 * @property {number} spreadBps      — spread in basis points
 * @property {string} symbol         — trading pair
 * @property {string} exchange       — exchange source
 * @property {number} timestamp      — snapshot time
 */

// ── Exchange-specific liquidity thresholds ────────────────────────────────────

export const LIQUIDITY_THRESHOLDS = {
  mexc: {
    minOrderUSD: 10,        // minimum order size
    maxOrderUSD: 1000000,   // maximum order size
    typicalDepthUSD: 50000, // typical order book depth USD
    slippageMultiplier: 1.0, // 1x typical slippage
  },
  binance: {
    minOrderUSD: 5,
    maxOrderUSD: 5000000,
    typicalDepthUSD: 200000,
    slippageMultiplier: 0.5, // Binance has deepest books
  },
  bybit: {
    minOrderUSD: 10,
    maxOrderUSD: 500000,
    typicalDepthUSD: 80000,
    slippageMultiplier: 0.8,
  },
  okx: {
    minOrderUSD: 5,
    maxOrderUSD: 1000000,
    typicalDepthUSD: 100000,
    slippageMultiplier: 0.7,
  },
  kucoin: {
    minOrderUSD: 20,
    maxOrderUSD: 500000,
    typicalDepthUSD: 30000,
    slippageMultiplier: 1.2,
  },
  gateio: {
    minOrderUSD: 50,
    maxOrderUSD: 300000,
    typicalDepthUSD: 20000,
    slippageMultiplier: 1.5,
  },
};

/**
 * Get liquidity thresholds for an exchange.
 *
 * @param {string} exchange
 * @returns {object}
 */
export function getLiquidityThresholds(exchange) {
  return LIQUIDITY_THRESHOLDS[exchange.toLowerCase()] || LIQUIDITY_THRESHOLDS.mexc;
}

/**
 * Check if order size is within exchange limits.
 *
 * @param {string} exchange
 * @param {number} orderUSD
 * @returns {object} { valid: boolean, minOrder: number, maxOrder: number, reason?: string }
 */
export function validateOrderSize(exchange, orderUSD) {
  const thresh = getLiquidityThresholds(exchange);

  if (orderUSD < thresh.minOrderUSD) {
    return {
      valid: false,
      minOrder: thresh.minOrderUSD,
      maxOrder: thresh.maxOrderUSD,
      reason: `Order ${orderUSD}$ USD < minimum ${thresh.minOrderUSD}$ USD`,
    };
  }

  if (orderUSD > thresh.maxOrderUSD) {
    return {
      valid: false,
      minOrder: thresh.minOrderUSD,
      maxOrder: thresh.maxOrderUSD,
      reason: `Order ${orderUSD}$ USD > maximum ${thresh.maxOrderUSD}$ USD`,
    };
  }

  return { valid: true, minOrder: thresh.minOrderUSD, maxOrder: thresh.maxOrderUSD };
}

/**
 * Estimate slippage for a given order size and book depth.
 * Linear model: slippage % = (orderUSD / depthUSD) * slippageMultiplier * maxSlippage
 *
 * @param {string} exchange
 * @param {number} orderUSD
 * @param {number} bookDepthUSD — order book depth (optional, uses typical)
 * @param {number} maxSlippageBps — maximum slippage in basis points (default 50 bps)
 * @returns {object} { estimatedSlippageBps, estimatedSlippagePct, depthUsed }
 */
export function estimateSlippage(exchange, orderUSD, bookDepthUSD = null, maxSlippageBps = 50) {
  const thresh = getLiquidityThresholds(exchange);
  const depth = bookDepthUSD ?? thresh.typicalDepthUSD;
  const maxSlippagePct = maxSlippageBps / 10000; // bps to %

  if (depth <= 0) {
    return {
      estimatedSlippageBps: maxSlippageBps,
      estimatedSlippagePct: maxSlippagePct,
      depthUsed: depth,
      reason: 'insufficient-depth',
    };
  }

  // Linear slippage model
  const depthRatio = Math.min(orderUSD / depth, 1.0); // cap at 1.0
  const slippagePct = depthRatio * thresh.slippageMultiplier * maxSlippagePct;
  const slippageBps = slippagePct * 10000;

  return {
    estimatedSlippageBps: Math.round(slippageBps),
    estimatedSlippagePct: slippagePct,
    depthUsed: depth,
    depthRatio: depthRatio.toFixed(4),
  };
}

/**
 * Estimate total execution cost including slippage.
 *
 * @param {string} exchange
 * @param {number} orderUSD
 * @param {number} takerFeePct — exchange taker fee %
 * @param {number} bookDepthUSD
 * @returns {object}
 */
export function estimateExecutionCost(exchange, orderUSD, takerFeePct, bookDepthUSD = null) {
  const fee = (orderUSD * takerFeePct) / 100;
  const slippage = estimateSlippage(exchange, orderUSD, bookDepthUSD);
  const slippageUSD = (orderUSD * slippage.estimatedSlippagePct) / 100;
  const totalCostUSD = fee + slippageUSD;
  const totalCostPct = (totalCostUSD / orderUSD) * 100;

  return {
    feeUSD: fee.toFixed(2),
    slippageUSD: slippageUSD.toFixed(2),
    totalCostUSD: totalCostUSD.toFixed(2),
    totalCostPct: totalCostPct.toFixed(4),
    slippageBreakdown: slippage,
  };
}

/**
 * Check if a trade is feasible given liquidity constraints.
 *
 * @param {object} trade — { symbol, buyExchange, sellExchange, grossPct, netPct }
 * @param {number} tradeUSD — proposed trade size
 * @param {object} opts — { minLiquidityUSD, maxSlippageBps, minProfitUSD }
 * @returns {object} { feasible: boolean, issues: [], profitUSD }
 */
export function isTradeFeasible(trade, tradeUSD, opts = {}) {
  const {
   _minLiquidityUSD = 100000,
    maxSlippageBps = 100,
    minProfitUSD = 10,
  } = opts;

  const issues = [];
  const _buyThresh = getLiquidityThresholds(trade.buyExchange);
  const _sellThresh = getLiquidityThresholds(trade.sellExchange);

  // Check order sizes
  const buyValid = validateOrderSize(trade.buyExchange, tradeUSD);
  if (!buyValid.valid) issues.push(`BUY (${trade.buyExchange}): ${buyValid.reason}`);

  const sellValid = validateOrderSize(trade.sellExchange, tradeUSD);
  if (!sellValid.valid) issues.push(`SELL (${trade.sellExchange}): ${sellValid.reason}`);

  // Check slippage
  const buySlip = estimateSlippage(trade.buyExchange, tradeUSD, null, maxSlippageBps);
  const sellSlip = estimateSlippage(trade.sellExchange, tradeUSD, null, maxSlippageBps);

  if (buySlip.estimatedSlippageBps > maxSlippageBps) {
    issues.push(`BUY slippage ${buySlip.estimatedSlippageBps} bps exceeds ${maxSlippageBps} bps`);
  }
  if (sellSlip.estimatedSlippageBps > maxSlippageBps) {
    issues.push(`SELL slippage ${sellSlip.estimatedSlippageBps} bps exceeds ${maxSlippageBps} bps`);
  }

  // Estimate profit after slippage
  const totalSlippagePct = buySlip.estimatedSlippagePct + sellSlip.estimatedSlippagePct;
  const profitPct = trade.netPct - (totalSlippagePct * 100);
  const profitUSD = (tradeUSD * profitPct) / 100;

  if (profitUSD < minProfitUSD) {
    issues.push(`Estimated profit $${profitUSD.toFixed(2)} < minimum $${minProfitUSD}`);
  }

  return {
    feasible: issues.length === 0,
    issues,
    profitUSD: Math.max(0, profitUSD),
    profitPct: Math.max(0, profitPct),
    totalSlippagePct,
  };
}

/**
 * Calculate optimal order size given constraints.
 *
 * @param {string} exchange
 * @param {number} availableUSD — available capital
 * @param {object} opts — { minOrderUSD, maxOrderUSD, maxSlippageBps }
 * @returns {number} recommended order size in USD
 */
export function calculateOptimalOrderSize(exchange, availableUSD, opts = {}) {
  const thresh = getLiquidityThresholds(exchange);
  const {
    minOrderUSD = thresh.minOrderUSD,
    maxOrderUSD = Math.min(thresh.maxOrderUSD, availableUSD),
    maxSlippageBps = 50,
  } = opts;

  // Start with max available, but respect exchange limits
  let orderSize = Math.min(availableUSD, maxOrderUSD);

  // Reduce if slippage would be too high
  for (let attempt = 0; attempt < 10; attempt++) {
    const slip = estimateSlippage(exchange, orderSize, null, maxSlippageBps);
    if (slip.estimatedSlippageBps <= maxSlippageBps) break;

    // Reduce by 20% and try again
    orderSize *= 0.8;
    if (orderSize < minOrderUSD) break;
  }

  return Math.max(minOrderUSD, Math.min(orderSize, maxOrderUSD));
}

/**
 * Compare liquidity across exchanges for same symbol.
 *
 * @param {string} symbol
 * @param {Array} exchanges — array of exchange names
 * @returns {object} comparison with depth, spread, feasibility
 */
export function compareLiquidity(symbol, exchanges) {
  const comparison = {};

  for (const exch of exchanges) {
    const thresh = getLiquidityThresholds(exch);
    comparison[exch] = {
      minOrder: thresh.minOrderUSD,
      maxOrder: thresh.maxOrderUSD,
      typicalDepth: thresh.typicalDepthUSD,
      slippageMultiplier: thresh.slippageMultiplier,
      recommendedOrderSize: thresh.typicalDepthUSD * 0.05, // 5% of depth
    };
  }

  return comparison;
}
