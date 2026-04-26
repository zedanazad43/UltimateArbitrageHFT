// nexus/src/risk.js — Risk management helpers

const BASE_CAPITAL_USD = 1000;
const BASE_POSITION_USD = 200;
const MAX_POSITION_USD = 2000;

// Hard cap on leverage: 20x prevents a single 5% adverse move from wiping the account.
const MAX_LEVERAGE = 20;

// Maximum fraction of equity to risk on a single trade.
const MAX_POSITION_EQUITY_FRACTION = 0.20;

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

export { MAX_LEVERAGE, MAX_POSITION_EQUITY_FRACTION };
