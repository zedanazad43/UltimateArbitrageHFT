// src/utils/fees.js — Comprehensive Fee Calculation Engine
//
// Unified fee model supporting multiple fee structures, gas costs, and liquidity impact.
// Enables accurate profit calculation across all arbitrage strategies.

/**
 * Fee structure for an exchange/trading pair
 * @typedef {object} FeeStructure
 * @property {number} takerFee       — taker fee rate (decimal, e.g., 0.001 = 0.1%)
 * @property {number} makerFee       — maker fee rate (decimal)
 * @property {number} depositFee     — deposit fee (decimal)
 * @property {number} withdrawalFee  — withdrawal fee (decimal, in USD)
 * @property {number} gasEstimate    — estimated gas cost in USD
 * @property {string} gasTokenUnit   — gas unit name (e.g., "gwei", "wei")
 */

// ── Exchange-specific fee configurations ──────────────────────────────────────

export const EXCHANGE_FEES = {
  mexc: {
    takerFee: 0.001,       // 0.1%
    makerFee: 0.0002,      // 0.02%
    depositFee: 0,
    withdrawalFee: 0.0001, // ~$1-5 depending on token
    gasEstimate: 2.0,      // USD (MEXC uses cheaper gas)
  },
  binance: {
    takerFee: 0.001,       // 0.1%
    makerFee: 0.0001,      // 0.01%
    depositFee: 0,
    withdrawalFee: 0.0001,
    gasEstimate: 3.0,      // USD
  },
  bybit: {
    takerFee: 0.001,
    makerFee: 0.0001,
    depositFee: 0,
    withdrawalFee: 0.00015,
    gasEstimate: 2.5,
  },
  okx: {
    takerFee: 0.0008,      // 0.08% (OKX has competitive rates)
    makerFee: 0.0002,
    depositFee: 0,
    withdrawalFee: 0.0001,
    gasEstimate: 2.5,
  },
  kucoin: {
    takerFee: 0.001,
    makerFee: 0.0001,
    depositFee: 0,
    withdrawalFee: 0.0002,
    gasEstimate: 3.0,
  },
  gateio: {
    takerFee: 0.002,       // 0.2% (higher fees)
    makerFee: 0.0002,
    depositFee: 0,
    withdrawalFee: 0.0002,
    gasEstimate: 3.5,
  },
  ethereum: {
    takerFee: 0,
    makerFee: 0,
    depositFee: 0,
    withdrawalFee: 0.001,  // Bridge cost
    gasEstimate: 5.0,      // Mainnet is expensive
  },
  bsc: {
    takerFee: 0,
    makerFee: 0,
    depositFee: 0,
    withdrawalFee: 0.0001,
    gasEstimate: 0.15,     // BSC is very cheap
  },
};

// ── Liquidity impact model ────────────────────────────────────────────────────

/**
 * Estimates slippage as a function of order size relative to order book depth.
 * Linear model: slippage ≈ (orderSize / bookDepth) × maxSlippage
 * Derived from empirical order-book analysis at major exchanges.
 *
 * @param {number} orderSizeUSD   — order size in USD
 * @param {number} bookDepthUSD   — order book depth in USD at bid/ask
 * @param {number} maxSlippage    — maximum slippage % (e.g., 0.05 for 5%)
 * @returns {number}              — estimated slippage in %
 */
export function estimateLiquidityImpact(orderSizeUSD, bookDepthUSD, maxSlippage = 0.1) {
  if (bookDepthUSD <= 0 || orderSizeUSD <= 0) return maxSlippage; // assume worst case
  const ratio = orderSizeUSD / bookDepthUSD;
  return Math.min(ratio * maxSlippage, maxSlippage);
}

// ── Fee calculation helpers ───────────────────────────────────────────────────

/**
 * Get fee structure for an exchange, with fallback to MEXC defaults.
 * @param {string} exchange
 * @returns {FeeStructure}
 */
export function getFeeStructure(exchange) {
  return EXCHANGE_FEES[exchange.toLowerCase()] || EXCHANGE_FEES.mexc;
}

/**
 * Calculate round-trip fee for a given exchange and trade type.
 * Assumes both legs use taker fees (conservative) unless specified.
 *
 * @param {string} exchange
 * @param {number} legs           — number of trades (default 2)
 * @param {boolean} useMaker      — use maker fee (conservative: false = taker)
 * @returns {number}              — total fee in % (e.g., 0.002 = 0.2%)
 */
export function calculateRoundTripFee(exchange, legs = 2, useMaker = false) {
  const fees = getFeeStructure(exchange);
  const feePerLeg = useMaker ? fees.makerFee : fees.takerFee;
  return feePerLeg * legs;
}

/**
 * Calculate total cost for a multi-leg trade including fees and gas.
 *
 * @param {Array} legs  — array of { exchange, orderSizeUSD?, isWithdrawal? }
 * @param {object} opts — { includeGas: bool, includeWithdrawal: bool, slippagePct: number }
 * @returns {object}    — { totalFeePct, gasUSD, withdrawalUSD, slippageUSD, totalUSD }
 */
export function calculateTotalTradeCost(legs, opts = {}) {
  const {
    includeGas = true,
    includeWithdrawal = true,
    slippagePct = 0,
    orderSizeUSD = 1000,
  } = opts;

  let totalFeePct = 0;
  let totalGasUSD = 0;
  let totalWithdrawalUSD = 0;

  for (const leg of legs) {
    const fees = getFeeStructure(leg.exchange);
    totalFeePct += fees.takerFee;
    if (includeGas) totalGasUSD += fees.gasEstimate;
    if (includeWithdrawal && leg.isWithdrawal) totalWithdrawalUSD += fees.withdrawalFee * orderSizeUSD;
  }

  const totalSlippageUSD = (orderSizeUSD * slippagePct) / 100;

  return {
    totalFeePct,
    gasUSD: totalGasUSD,
    withdrawalUSD: totalWithdrawalUSD,
    slippageUSD: totalSlippageUSD,
    totalUSD: totalGasUSD + totalWithdrawalUSD + totalSlippageUSD,
  };
}

/**
 * Calculate net profit % after all costs.
 *
 * @param {number} grossProfitPct  — gross profit % (e.g., 2.5 = 2.5%)
 * @param {number} totalCostPct    — total cost in % (e.g., 0.5 = 0.5%)
 * @returns {number}               — net profit % (negative = loss)
 */
export function calculateNetProfit(grossProfitPct, totalCostPct) {
  return grossProfitPct - totalCostPct;
}

/**
 * Break-even analysis: minimum gross profit needed to achieve target net profit.
 *
 * @param {number} targetNetProfitPct — target net profit %
 * @param {number} totalCostPct       — total cost %
 * @returns {number}                  — required gross profit %
 */
export function getBreakEvenGross(targetNetProfitPct, totalCostPct) {
  return targetNetProfitPct + totalCostPct;
}

/**
 * Evaluate whether a trade clears minimum profitability thresholds.
 *
 * @param {object} trade — { grossPct, netPct, strategy }
 * @param {object} config — { minNetPct, minSafetyFactor }
 * @returns {boolean}
 */
export function meetsMinimumProfitability(trade, config = {}) {
  const {
    minNetPct = 0.01,        // 0.01% minimum net profit
    minSafetyFactor = 0.35,  // net/gross ≥ 35%
  } = config;

  if ((trade.netPct ?? 0) < minNetPct) return false;
  if ((trade.safetyFactor ?? 1) < minSafetyFactor) return false;
  return true;
}

/**
 * Generate detailed fee breakdown for transparency.
 *
 * @param {Array} exchanges
 * @param {number} tradeSize
 * @returns {object}
 */
export function getFeeBreakdown(exchanges, tradeSize = 1000) {
  const breakdown = {};
  let totalCostUSD = 0;

  for (const exch of exchanges) {
    const fees = getFeeStructure(exch);
    const tradeFeeUSD = (fees.takerFee * tradeSize);
    const totalUSD = tradeFeeUSD + fees.gasEstimate;
    breakdown[exch] = {
      tradeFeeUSD,
      gasEstimateUSD: fees.gasEstimate,
      totalUSD,
      percentageOfTrade: (totalUSD / tradeSize) * 100,
    };
    totalCostUSD += totalUSD;
  }

  return {
    breakdown,
    totalCostUSD,
    averageCostPct: (totalCostUSD / (tradeSize * exchanges.length)) * 100,
  };
}
