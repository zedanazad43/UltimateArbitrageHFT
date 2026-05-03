// nexus/src/risk.js — Risk management helpers

const BASE_CAPITAL_USD = 1000;
const BASE_POSITION_USD = 200;
const MAX_POSITION_USD = 2000;

// Hard cap on leverage: 20x prevents a single 5% adverse move from wiping the account.
const MAX_LEVERAGE = 20;

// Maximum fraction of equity to risk on a single trade.
const MAX_POSITION_EQUITY_FRACTION = 0.20;

// Maximum total open exposure as a fraction of equity (across all open positions).
const MAX_TOTAL_EXPOSURE_FRACTION = 0.60;

// High-volatility scaling: when spread volatility exceeds this pct, reduce size.
const HIGH_VOL_THRESHOLD_PCT = 2.5;

/**
 * Adaptive leverage: base 3x, grows logarithmically with capital, capped at 20x.
 * Also scales with the observed net profit margin.
 */
export function calculateAdaptiveLeverage(equity, netProfitPct, initialCapital = BASE_CAPITAL_USD) {
  const growthFactor = Math.max(1, equity / initialCapital);
  const baseLev = 3 + Math.floor(Math.log2(growthFactor) * 3);
  const marginScale = Math.min(2.0, netProfitPct / 0.05); // 0.05% as reference
  const leverage = Math.round(baseLev * Math.max(0.5, marginScale));
  return Math.max(2, Math.min(MAX_LEVERAGE, leverage));
}

/**
 * Kelly-adjusted position size.
 * Uses auto-compounding: logistic growth based on equity vs initial capital.
 * The result is additionally capped at MAX_POSITION_EQUITY_FRACTION of equity
 * to bound tail risk irrespective of the Kelly estimate.
 */
export function calculatePositionSize(equity, winRate = 0.55, riskRewardRatio = 2.0) {
  const gf = Math.log(1 + equity / BASE_CAPITAL_USD) / Math.log(2);
  const logSize = Math.min(MAX_POSITION_USD, BASE_POSITION_USD * (1 + gf));

  let kellyFraction = 0;
  if (winRate > 0.5 && riskRewardRatio > 1) {
    kellyFraction = winRate - (1 - winRate) / riskRewardRatio;
    kellyFraction = Math.max(0, Math.min(0.25, kellyFraction));
  }
  const kellySize = equity * kellyFraction * 0.2; // 20% Kelly fraction
  const raw = kellySize > 0 ? Math.min(logSize, kellySize) : logSize;
  // Hard cap: never risk more than MAX_POSITION_EQUITY_FRACTION of equity in one trade
  return Math.min(raw, equity * MAX_POSITION_EQUITY_FRACTION);
}

/**
 * Volatility-adjusted position size.
 *
 * When the observed spread across exchanges is high (> HIGH_VOL_THRESHOLD_PCT),
 * data quality is suspect and execution slippage is elevated.  Scale down the
 * base position size proportionally to the excess volatility to preserve edge.
 *
 * @param {number} baseSize       — result of calculatePositionSize()
 * @param {number} observedSpread — current max inter-exchange spread in %
 * @returns {number} adjusted position size in USD
 */
export function volatilityAdjustedSize(baseSize, observedSpread) {
  if (observedSpread <= HIGH_VOL_THRESHOLD_PCT) return baseSize;
  // Linear reduction: at 2× threshold, reduce by 50%; beyond 3×, min 20% of base
  const excessRatio = observedSpread / HIGH_VOL_THRESHOLD_PCT;
  const scaleFactor = Math.max(0.20, 1 / excessRatio);
  return baseSize * scaleFactor;
}

/**
 * Daily drawdown guard.
 *
 * Returns an object indicating whether trading should be halted and the reason.
 * Checks both absolute daily loss and daily loss as a percentage of equity.
 *
 * @param {object} state — trading_state from KV
 * @param {number} equity — current equity
 * @returns {{ halt: boolean, reason: string|null }}
 */
export function checkDrawdownGuard(state, equity) {
  const dailyLoss     = -(state.daily_pnl || 0);  // positive = loss
  const maxDailyLoss  = state.max_daily_loss_usd ?? 25;
  const initialCapital = state.initial_capital   ?? BASE_CAPITAL_USD;

  // Absolute daily loss check
  if (dailyLoss >= maxDailyLoss) {
    return {
      halt:   true,
      reason: `Daily loss $${dailyLoss.toFixed(2)} exceeds limit $${maxDailyLoss}`
    };
  }

  // Equity watermark check: if equity dropped >15% from initial, halt
  const equityDrawdownPct = ((initialCapital - equity) / initialCapital) * 100;
  if (equityDrawdownPct > 15) {
    return {
      halt:   true,
      reason: `Equity drawdown ${equityDrawdownPct.toFixed(1)}% exceeds 15% watermark`
    };
  }

  // Per-trade loss check: if last trade lost more than max_per_trade_loss_pct, pause
  const maxPerTrade = state.max_per_trade_loss_pct ?? 0.02;
  const lastPnl     = state.last_trade_pnl_usd ?? 0;
  if (lastPnl < 0 && Math.abs(lastPnl) / equity > maxPerTrade) {
    return {
      halt:   true,
      reason: `Single trade loss $${Math.abs(lastPnl).toFixed(2)} exceeds ${(maxPerTrade * 100).toFixed(1)}% per-trade limit`
    };
  }

  return { halt: false, reason: null };
}

/**
 * Checks whether adding a new position of `newSizeUsd` would breach the total
 * open exposure limit (MAX_TOTAL_EXPOSURE_FRACTION of equity).
 *
 * @param {number} equity          — current equity
 * @param {number} currentExposure — sum of all currently open position sizes in USD
 * @param {number} newSizeUsd      — proposed new position size
 * @returns {{ allowed: boolean, reason: string|null }}
 */
export function checkExposureLimit(equity, currentExposure, newSizeUsd) {
  const maxTotalExposure = equity * MAX_TOTAL_EXPOSURE_FRACTION;
  const projectedExposure = currentExposure + newSizeUsd;

  if (projectedExposure > maxTotalExposure) {
    return {
      allowed: false,
      reason:  `Total exposure $${projectedExposure.toFixed(2)} would exceed ${(MAX_TOTAL_EXPOSURE_FRACTION * 100).toFixed(0)}% equity limit ($${maxTotalExposure.toFixed(2)})`
    };
  }
  return { allowed: true, reason: null };
}

/**
 * Historical Value-at-Risk (VaR) at a given confidence level.
 *
 * Uses the parametric (variance-covariance) approximation on the provided
 * array of P&L values.
 *
 * @param {number[]} pnls       — historical trade P&L values in USD
 * @param {number}   confidence — e.g. 0.95 for 95% VaR
 * @returns {number} 1-day VaR in USD (positive number = potential loss)
 */
export function calculateVaR(pnls, confidence = 0.95) {
  if (!pnls || pnls.length < 5) return 0;

  // Sort ascending to use historical simulation method
  const sorted = [...pnls].sort((a, b) => a - b);
  const idx    = Math.floor((1 - confidence) * sorted.length);
  const var95  = -sorted[Math.max(0, idx)]; // convert to positive loss

  return Math.max(0, var95);
}

/**
 * Minimum time check: enforces a minimum number of seconds between trades
 * to avoid over-trading and to allow price movements to settle.
 *
 * @param {object} state — trading_state with last_trade_timestamp
 * @returns {{ allowed: boolean, waitSec: number }}
 */
export function checkMinTimeBetweenTrades(state) {
  const minSeconds = state.min_seconds_between_trades ?? 30;
  const lastTs     = state.last_trade_timestamp ?? 0;
  const elapsedSec = (Date.now() - lastTs) / 1000;

  if (elapsedSec < minSeconds) {
    return {
      allowed: false,
      waitSec: Math.ceil(minSeconds - elapsedSec)
    };
  }
  return { allowed: true, waitSec: 0 };
}

export {
  MAX_LEVERAGE,
  MAX_POSITION_EQUITY_FRACTION,
  MAX_TOTAL_EXPOSURE_FRACTION,
  HIGH_VOL_THRESHOLD_PCT
};

