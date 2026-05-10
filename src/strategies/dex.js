// nexus/src/strategies/dex.js — DEX Cross-Chain Arbitrage Strategy

import { getAlchemyPrice, getPancakePrice } from '../prices.js';

// ── Token config for cross-chain ETH ↔ BSC arbitrage ─────────────────────────
//
// Each token is priced on the Ethereum side via Alchemy and on the BSC side via
// PancakeSwap.  The token addresses are the Binance-pegged equivalents on BSC,
// which track the Ethereum-native asset with a small peg deviation — this
// deviation is the source of the arbitrage opportunity.
//
// Source references:
//   BSC WETH:  https://bscscan.com/token/0x2170ed0880ac9a755fd29b2688956bd959f933f8
//   BSC BTC:   https://bscscan.com/token/0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c
//   BSC WBNB:  https://bscscan.com/token/0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c

export const DEX_TOKENS = [
  {
    symbol:        'ETHUSDT',
    alchemySymbol: 'ETH',
    bscAddress:    '0x2170ed0880ac9a755fd29b2688956bd959f933f8', // Binance-Peg ETH on BSC
  },
  {
    symbol:        'BTCUSDT',
    alchemySymbol: 'BTC',
    bscAddress:    '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c', // Binance-Peg BTC on BSC
  },
  {
    symbol:        'BNBUSDT',
    alchemySymbol: 'BNB',
    bscAddress:    '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', // WBNB on BSC
  },
];

const MIN_SPREAD_PCT  = 0.5;  // minimum gross spread to consider
const BRIDGE_COST_PCT = 0.2;  // estimated bridge/gas cost deducted from profit

// Estimated swap gas cost in USD per leg (ETH mainnet at ~20 Gwei, BNB Chain at ~3 Gwei).
// Used to populate the informational `gasEstimateUSD` field on each opportunity.
// The actual deduction is BRIDGE_COST_PCT above; this estimate is surfaced so that
// dashboards can display it.
const ETH_SWAP_GAS_USD = 5.0;  // ≈ 100k gas × 20 Gwei × $2 500/ETH
const BSC_SWAP_GAS_USD = 0.15; // ≈ 100k gas × 3 Gwei × $500/BNB
const GAS_ESTIMATE_USD = ETH_SWAP_GAS_USD + BSC_SWAP_GAS_USD;

/**
 * Scans a single ETH↔BSC token pair for a cross-chain DEX arbitrage opportunity.
 *
 * @param {string} alchemyKey — Alchemy API key or full endpoint URL
 * @param {{ symbol, alchemySymbol, bscAddress }} token
 * @returns {object|null}  opportunity or null
 */
async function scanDEXPair(alchemyKey, token) {
  const [ethPrice, bscPrice] = await Promise.all([
    getAlchemyPrice(token.alchemySymbol, alchemyKey),
    getPancakePrice(token.bscAddress),
  ]);

  const spreadPct = ((bscPrice - ethPrice) / ethPrice) * 100;
  const absSpread = Math.abs(spreadPct);

  if (absSpread < MIN_SPREAD_PCT) return null;

  const netPct = absSpread - BRIDGE_COST_PCT;
  if (netPct <= 0) return null;

  const buyOnEth = spreadPct > 0; // BSC more expensive → buy on Ethereum, sell on BSC
  return {
    strategy:       'dex',
    symbol:         token.symbol,
    buyExchange:    buyOnEth ? 'ethereum' : 'bsc',
    sellExchange:   buyOnEth ? 'bsc'      : 'ethereum',
    buyPrice:       buyOnEth ? ethPrice   : bscPrice,
    sellPrice:      buyOnEth ? bscPrice   : ethPrice,
    grossPct:       absSpread,
    netPct,
    safetyFactor:   netPct / absSpread,
    direction:      buyOnEth ? 'ETH→BSC'  : 'BSC→ETH',
    gasEstimateUSD: GAS_ESTIMATE_USD,
    isPerp:         false,
  };
}

/**
 * Scans all supported ETH↔BSC token pairs for cross-chain DEX arbitrage.
 * All pairs are fetched in parallel; the opportunity with the highest netPct
 * is returned.  Returns null when no actionable opportunity exists.
 */
export async function scanDEX(env) {
  // Accept either a bare API key or a full Alchemy endpoint URL as the secret.
  // ALCHEMY_ETHEREUM_ENDPOINT (full RPC URL) was the documented secret name in deploy.ps1,
  // but the prices layer only needs the API key embedded in it.
  const alchemyKey = env.ALCHEMY_API_KEY || env.ALCHEMY_ETHEREUM_ENDPOINT;
  if (!alchemyKey) return null;

  try {
    const results = await Promise.allSettled(
      DEX_TOKENS.map(token => scanDEXPair(alchemyKey, token))
    );

    // Collect successful non-null results and pick the highest net profit.
    let best = null;
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        if (!best || r.value.netPct > best.netPct) best = r.value;
      }
    }
    return best;
  } catch (e) {
    console.error('DEX scan error:', e.message);
    return null;
  }
}
