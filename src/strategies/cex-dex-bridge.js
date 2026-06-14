// nexus/src/strategies/cex-dex-bridge.js — CEX ↔ DEX Bridged Arbitrage
//
// Compares CEX spot prices against DEX prices across multiple chains
// to identify cross-venue arbitrage opportunities with minimal latency.

import { scanCrossChainDEX } from '../dex-executor.js';

// ── CEX price resolution (using orchestrator's price infrastructure) ─────────

let _cachedPrices = null;
let _cachedExchanges = null;

/**
 * Bridge tokens to scan for CEX↔DEX arbitrage.
 * These tokens have deep liquidity on both CEX and DEX venues.
 */
const BRIDGE_TOKENS = ['ETH', 'BTC', 'BNB', 'MATIC', 'USDC'];

/**
 * Maps CEX symbols to DEX native token symbols for cross-referencing.
 */
const CEX_TO_DEX_TOKEN = {
    'ETHUSDT': 'ETH',
    'BTCUSDT': 'BTC',
    'BNBUSDT': 'BNB',
    'MATICUSDT': 'MATIC',
};

/** Minimum gross spread to consider a cross-venue opportunity. */
const MIN_BRIDGE_SPREAD_PCT = 0.15; // 15 bps

/** Estimated bridge/fast-transfer cost as percentage. */
const BRIDGE_COST_PCT = 0.08; // 8 bps for CEX→DEX bridge

// ── Main scan function ───────────────────────────────────────────────────────

/**
 * Scans for CEX↔DEX arbitrage opportunities.
 *
 * For each supported token, compares the lowest CEX ask price against
 * the lowest DEX buy price (and vice versa) across all configured chains.
 *
 * @param {object} cexPrices - Map of symbol → best bid/ask across CEX exchanges
 * @param {object} env - Worker environment
 * @returns {Promise<object|null>} best CEX↔DEX opportunity or null
 */
export async function scanCexDexBridge(cexPrices, env) {
    const opportunities = [];

    for (const token of BRIDGE_TOKENS) {
        const cexSymbol = Object.keys(CEX_TO_DEX_TOKEN).find(k => CEX_TO_DEX_TOKEN[k] === token);
        if (!cexSymbol) continue;

        const cexData = cexPrices[cexSymbol];
        const bid = cexData?.bestBid;
        const ask = cexData?.bestAsk;
        if (!bid || !ask) continue;

        // Get DEX price across all chains
        const dexOpp = await scanCrossChainDEX(env, token, BRIDGE_TOKENS[token] || ['ethereum', 'bsc', 'arbitrum']);
        if (!dexOpp) continue;

        // ── Direction 1: Buy on CEX (cheaper), sell on DEX (more expensive) ──
        if (dexOpp.sellPrice > cexData.bestBid) {
            const grossPct = ((dexOpp.sellPrice - cexData.bestBid) / cexData.bestBid) * 100;
            const netPct = grossPct - BRIDGE_COST_PCT;
            if (netPct > 0 && grossPct >= MIN_BRIDGE_SPREAD_PCT) {
                opportunities.push({
                    strategy: 'cex_dex_bridge',
                    symbol: cexSymbol,
                    direction: 'CEX→DEX',
                    buyExchange: getBestCexExchange(cexData, 'bid'),
                    sellExchange: dexOpp.sellExchange,
                    buyPrice: cexData.bestBid,
                    sellPrice: dexOpp.sellPrice,
                    grossPct,
                    netPct,
                    safetyFactor: netPct / grossPct,
                    isPerp: false,
                    bridgeType: 'cex_to_dex',
                });
            }
        }

        // ── Direction 2: Buy on DEX (cheaper), sell on CEX (more expensive) ──
        if (cexData.bestAsk > dexOpp.buyPrice) {
            const grossPct = ((cexData.bestAsk - dexOpp.buyPrice) / dexOpp.buyPrice) * 100;
            const netPct = grossPct - BRIDGE_COST_PCT;
            if (netPct > 0 && grossPct >= MIN_BRIDGE_SPREAD_PCT) {
                opportunities.push({
                    strategy: 'cex_dex_bridge',
                    symbol: cexSymbol,
                    direction: 'DEX→CEX',
                    buyExchange: dexOpp.buyExchange,
                    sellExchange: getBestCexExchange(cexData, 'ask'),
                    buyPrice: dexOpp.buyPrice,
                    sellPrice: cexData.bestAsk,
                    grossPct,
                    netPct,
                    safetyFactor: netPct / grossPct,
                    isPerp: false,
                    bridgeType: 'dex_to_cex',
                });
            }
        }
    }

    if (opportunities.length === 0) return null;

    // Return the highest net profit opportunity
    return opportunities.toSorted((a, b) => b.netPct - a.netPct)[0];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getBestCexExchange(cexData, side) {
    // Return the exchange with the best bid or ask price
    if (side === 'bid') {
        return cexData.bestBidExchange || 'mexc';
    }
    return cexData.bestAskExchange || 'mexc';
}

/**
 * Builds a normalized CEX price map from orchestrator's price sources.
 * Expected input format: { symbol: { bestBid, bestBidExchange, bestAsk, bestAskExchange } }
 */
export function buildCexPriceMap(spotSourcesBySymbol) {
    const map = {};
    for (const [symbol, sources] of Object.entries(spotSourcesBySymbol)) {
        if (!sources || sources.length === 0) continue;

        const bids = sources.filter(s => s.price > 0).sort((a, b) => b.price - a.price);
        const asks = sources.filter(s => s.price > 0).sort((a, b) => a.price - b.price);

        if (bids.length === 0 || asks.length === 0) continue;

        map[symbol] = {
            bestBid: bids[0].price,
            bestBidExchange: bids[0].exchange,
            bestAsk: asks[0].price,
            bestAskExchange: asks[0].exchange,
            allSources: sources,
        };
    }
    return map;
}
