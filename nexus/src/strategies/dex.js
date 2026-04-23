// nexus/src/strategies/dex.js — DEX Cross-Chain Arbitrage Strategy

import { getAlchemyPrice, getPancakePrice } from '../prices.js';

const WETH_BSC_ADDRESS  = '0x2170ed0880ac9a755fd29b2688956bd959f933f8';
const MIN_SPREAD_PCT    = 0.5;  // minimum gross spread to consider
const BRIDGE_COST_PCT   = 0.2;  // estimated bridge/gas cost deducted from profit

/**
 * Scans ETH price difference between Ethereum (Alchemy) and BSC (PancakeSwap).
 * Returns an OpportunityObject or null when no actionable opportunity exists.
 */
export async function scanDEX(env) {
  if (!env.ALCHEMY_API_KEY) return null;

  try {
    const [ethPrice, bscPrice] = await Promise.all([
      getAlchemyPrice('ETH', env.ALCHEMY_API_KEY),
      getPancakePrice(WETH_BSC_ADDRESS)
    ]);

    const spreadPct = ((bscPrice - ethPrice) / ethPrice) * 100;
    const absSpread = Math.abs(spreadPct);

    if (absSpread < MIN_SPREAD_PCT) return null;

    const netPct = absSpread - BRIDGE_COST_PCT;
    if (netPct <= 0) return null;

    // spreadPct > 0 means BSC is more expensive → buy on Ethereum, sell on BSC
    const buyOnEth = spreadPct > 0;
    return {
      strategy:     'dex',
      symbol:       'ETHUSDT',
      buyExchange:  buyOnEth ? 'ethereum' : 'bsc',
      sellExchange: buyOnEth ? 'bsc'      : 'ethereum',
      buyPrice:     buyOnEth ? ethPrice   : bscPrice,
      sellPrice:    buyOnEth ? bscPrice   : ethPrice,
      grossPct:     absSpread,
      netPct,
      safetyFactor: netPct / absSpread,
      direction:    buyOnEth ? 'ETH→BSC'  : 'BSC→ETH',
      isPerp:       false
    };
  } catch (e) {
    console.error('DEX scan error:', e.message);
    return null;
  }
}
