// nexus/src/strategies/dex.js — DEX Cross-Chain Arbitrage Strategy
// Multi-chain support: ETH, BSC, Arbitrum, Polygon, Optimism

import { getAlchemyPrice, getPancakePrice, getCoinGeckoSimplePrice, getDEXScreenerPrice } from '../prices.js';

// ── Chain configuration ──────────────────────────────────────────────────────

const CHAINS = {
  ethereum:  { chainId: 'ethereum',  label: 'Ethereum',  gasUsd: 5.0,
    tokens: {
      ETH: { geckoId: 'ethereum',     address: null, dexQuery: 'ethereum' },
      BTC: { geckoId: 'bitcoin',      address: null, dexQuery: 'ethereum' },
      BNB: { geckoId: 'binancecoin',  address: null, dexQuery: 'ethereum' },
    }
  },
  bsc:       { chainId: 'bsc',       label: 'BSC',       gasUsd: 0.15,
    tokens: {
      ETH: { geckoId: 'ethereum',     address: '0x2170ed0880ac9a755fd29b2688956bd959f933f8', dexQuery: 'bsc' },
      BTC: { geckoId: 'bitcoin',      address: '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c', dexQuery: 'bsc' },
      BNB: { geckoId: 'binancecoin',  address: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', dexQuery: 'bsc' },
    }
  },
  arbitrum:  { chainId: 'arbitrum',  label: 'Arbitrum',  gasUsd: 0.10,
    tokens: {
      ETH: { geckoId: 'ethereum',     address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', dexQuery: 'arbitrum' },
      BTC: { geckoId: 'bitcoin',      address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', dexQuery: 'arbitrum' },
      ARB: { geckoId: 'arbitrum',     address: '0x912CE59144191C1204E64559FE8253a0e49E6548', dexQuery: 'arbitrum' },
    }
  },
  polygon:   { chainId: 'polygon',   label: 'Polygon',   gasUsd: 0.02,
    tokens: {
      ETH: { geckoId: 'ethereum',     address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', dexQuery: 'polygon' },
      BTC: { geckoId: 'bitcoin',      address: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', dexQuery: 'polygon' },
      MATIC: { geckoId: 'matic-network', address: '0x0000000000000000000000000000000000001010', dexQuery: 'polygon' },
    }
  },
  optimism:  { chainId: 'optimism',  label: 'Optimism',  gasUsd: 0.05,
    tokens: {
      ETH: { geckoId: 'ethereum',     address: '0x4200000000000000000000000000000000000006', dexQuery: 'optimism' },
      BTC: { geckoId: 'bitcoin',      address: '0x68f180fcCe6836688e9084f035309E29Bf0A2095', dexQuery: 'optimism' },
      OP: { geckoId: 'optimism',      address: '0x4200000000000000000000000000000000000042', dexQuery: 'optimism' },
    }
  },
};

// ── Token config for cross-chain ETH ↔ BSC arbitrage (legacy + multi-chain) ─

export const DEX_TOKENS = [
  { symbol: 'ETHUSDT', alchemySymbol: 'ETH', coinGeckoId: 'ethereum', bscAddress: '0x2170ed0880ac9a755fd29b2688956bd959f933f8' },
  { symbol: 'BTCUSDT', alchemySymbol: 'BTC', coinGeckoId: 'bitcoin', bscAddress: '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c' },
  { symbol: 'BNBUSDT', alchemySymbol: 'BNB', coinGeckoId: 'binancecoin', bscAddress: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c' },
];

const MIN_SPREAD_PCT  = 0.3;  // minimum gross spread to consider
const BRIDGE_COST_PCT = 0.2;  // estimated bridge/gas cost deducted from profit

// Estimated swap gas cost in USD per leg (ETH mainnet at ~20 Gwei, BNB Chain at ~3 Gwei).
// Used to populate the informational `gasEstimateUSD` field on each opportunity.
// The actual deduction is BRIDGE_COST_PCT above; this estimate is surfaced so that
// dashboards can display it.
const ETH_SWAP_GAS_USD = 5.0;  // ≈ 100k gas × 20 Gwei × $2 500/ETH
const BSC_SWAP_GAS_USD = 0.15; // ≈ 100k gas × 3 Gwei × $500/BNB
const GAS_ESTIMATE_USD = ETH_SWAP_GAS_USD + BSC_SWAP_GAS_USD;

// ─── Multi-chain DEX pair scanner ────────────────────────────────────────────

/**
 * Scans a cross-chain token pair between any two chains using DEXScreener prices.
 * Does NOT require Alchemy — uses public DEXScreener API with chain IDs.
 *
 * @param {string} chainA  — source chain (ethereum, bsc, arbitrum, polygon, optimism)
 * @param {string} chainB  — destination chain
 * @param {object} tokenA  — { geckoId, address, dexQuery } for chain A
 * @param {object} tokenB  — { geckoId, address, dexQuery } for chain B
 * @param {string} symbol  — ticker symbol (ETHUSDT, BTCUSDT, etc.)
 * @returns {object|null}
 */
async function scanMultiChainDEXPair(chainA, chainB, tokenA, tokenB, symbol) {
  let priceA, priceB;

  if (tokenA.address) {
    const resultA = await getDEXScreenerPrice(tokenA.dexQuery, tokenA.address);
    if (!resultA?.price) return null;
    priceA = resultA.price;
  } else {
    priceA = await getCoinGeckoSimplePrice(tokenA.geckoId);
    if (!priceA) return null;
  }

  if (tokenB.address) {
    const resultB = await getDEXScreenerPrice(tokenB.dexQuery, tokenB.address);
    if (!resultB?.price) return null;
    priceB = resultB.price;
  } else {
    priceB = await getCoinGeckoSimplePrice(tokenB.geckoId);
    if (!priceB) return null;
  }

  const spreadPct = ((priceB - priceA) / priceA) * 100;
  const absSpread = Math.abs(spreadPct);
  if (absSpread < MIN_SPREAD_PCT) return null;

  const bridgeCost = BRIDGE_COST_PCT + ((CHAINS[chainA]?.gasUsd || 5) + (CHAINS[chainB]?.gasUsd || 0.15)) / 100;
  const netPct = absSpread - bridgeCost;
  if (netPct <= 0) return null;

  const buyOnA = spreadPct > 0;
  return {
    strategy: 'dex',
    symbol,
    buyExchange: buyOnA ? chainA : chainB,
    sellExchange: buyOnA ? chainB : chainA,
    buyPrice: buyOnA ? priceA : priceB,
    sellPrice: buyOnA ? priceB : priceA,
    grossPct: absSpread,
    netPct,
    safetyFactor: netPct / absSpread,
    direction: buyOnA ? `${chainA.toUpperCase()}→${chainB.toUpperCase()}` : `${chainB.toUpperCase()}→${chainA.toUpperCase()}`,
    gasEstimateUSD: (CHAINS[chainA]?.gasUsd || 5) + (CHAINS[chainB]?.gasUsd || 0.15),
    isPerp: false,
  };
}

/**
 * Generates all viable cross-chain DEX pairs across supported chains.
 * Returns array of { chainA, chainB, tokenA, tokenB, symbol } for scanning.
 */
function generateCrossChainPairs() {
  const chainKeys = Object.keys(CHAINS);
  const pairs = [];
  const baseTokens = ['ETH', 'BTC']; // universal cross-chain tokens

  for (let i = 0; i < chainKeys.length; i++) {
    for (let j = i + 1; j < chainKeys.length; j++) {
      const chainA = chainKeys[i];
      const chainB = chainKeys[j];
      for (const base of baseTokens) {
        const tokenA = CHAINS[chainA].tokens[base];
        const tokenB = CHAINS[chainB].tokens[base];
        if (tokenA && tokenB) {
          const suffix = base === 'BTC' ? 'USDT' : 'USDT';
          pairs.push({ chainA, chainB, tokenA, tokenB, symbol: `${base}${suffix}` });
        }
      }
    }
  }
  return pairs;
}

const CROSS_CHAIN_PAIRS = generateCrossChainPairs();

/**
 * Scans a single ETH↔BSC token pair for a cross-chain DEX arbitrage opportunity.
 *
 * @param {string|null} alchemyKey — Alchemy API key or full endpoint URL
 * @param {{ symbol, alchemySymbol, bscAddress }} token
 * @returns {object|null}  opportunity or null
 */
async function scanDEXPair(alchemyKey, token) {
  let ethPrice;
  let bscPrice;

  if (alchemyKey) {
    [ethPrice, bscPrice] = await Promise.all([
      getAlchemyPrice(token.alchemySymbol, alchemyKey),
      getPancakePrice(token.bscAddress),
    ]);
  } else {
    // Keyless fallback: CoinGecko (ETH-side reference) + DEXScreener (BSC-side).
    const [ethUsd, bscQuote] = await Promise.all([
      getCoinGeckoSimplePrice(token.coinGeckoId),
      getDEXScreenerPrice('bsc', token.bscAddress),
    ]);
    if (!ethUsd || !bscQuote?.price) return null;
    ethPrice = ethUsd;
    bscPrice = bscQuote.price;
  }

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
 * Scans all supported cross-chain token pairs for DEX arbitrage.
 * Covers ETH↔BSC (legacy + Alchemy) and multi-chain (Arbitrum/Polygon/Optimism via DEXScreener).
 * All pairs are fetched in parallel; the opportunity with the highest netPct is returned.
 */
export async function scanDEX(env) {
  const alchemyKey = env.ALCHEMY_API_KEY || env.ALCHEMY_ETHEREUM_ENDPOINT;
  try {
    // Legacy ETH↔BSC pairs (Alchemy + PancakeSwap)
    const legacyResults = alchemyKey
      ? await Promise.allSettled(DEX_TOKENS.map(token => scanDEXPair(alchemyKey, token)))
      : [];

    // Multi-chain pairs (DEXScreener — no API key needed)
    const multiResults = await Promise.allSettled(
      CROSS_CHAIN_PAIRS.map(({ chainA, chainB, tokenA, tokenB, symbol }) =>
        scanMultiChainDEXPair(chainA, chainB, tokenA, tokenB, symbol)
      )
    );

    let best = null;
    for (const r of [...legacyResults, ...multiResults]) {
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

// ─── Internal DEX Execution via 1inch / Uniswap ─────────────────────────────
//
// Removes the external DEX_EXECUTOR_URL dependency by calling 1inch Aggregation
// API directly (primary) with Uniswap Universal Router as fallback.
// Supports Ethereum, BSC, Arbitrum, Polygon, Optimism.

const CHAIN_IDS = { ethereum: 1, bsc: 56, polygon: 137, arbitrum: 42161, optimism: 10 };

const TOKEN_ADDRESSES = {
  USDT: {
    ethereum: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    bsc: '0x55d398326f99059fF775485246999027B3197955',
    polygon: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    arbitrum: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    optimism: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
  },
  WETH: {
    ethereum: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    bsc: '0x2170Ed0880ac9A755fd29B2688956bD959F933f8',
    polygon: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
    arbitrum: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    optimism: '0x4200000000000000000000000000000000000006',
  },
  WBTC: {
    ethereum: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
    bsc: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',
    polygon: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6',
    arbitrum: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
    optimism: '0x68f180fcCe6836688e9084f035309E29Bf0A2095',
  },
};

/**
 * Executes a DEX swap via 1inch Aggregation API (primary) or Uniswap (fallback).
 * This replaces the external DEX_EXECUTOR_URL dependency.
 *
 * @param {object} opts
 * @param {string} opts.chain — ethereum, bsc, arbitrum, polygon, optimism
 * @param {string} opts.tokenIn — e.g. USDT, WETH, WBTC
 * @param {string} opts.tokenOut — e.g. WETH, USDT, WBTC
 * @param {number} opts.amount — amount in tokenIn units
 * @param {number} opts.slippage — max slippage % (default 1)
 * @param {string} opts.fromAddress — user wallet address (for quote only)
 * @returns {Promise<object>} { tx: { to, data, value }, price, estimatedGas }
 */
export async function getDEXSwapQuote(opts = {}) {
  const { chain = 'ethereum', tokenIn = 'USDT', tokenOut = 'WETH', amount, slippage = 1, fromAddress } = opts;
  if (!amount || amount <= 0) throw new Error('Invalid swap amount');

  const chainId = CHAIN_IDS[chain];
  if (!chainId) throw new Error(`Unsupported chain: ${chain}`);

  const tokenInAddr = TOKEN_ADDRESSES[tokenIn]?.[chain];
  const tokenOutAddr = TOKEN_ADDRESSES[tokenOut]?.[chain];
  if (!tokenInAddr || !tokenOutAddr) throw new Error(`Token address not found for ${tokenIn}/${tokenOut} on ${chain}`);

  // Primary: 1inch Aggregation API (no API key needed for free tier)
  try {
    const params = new URLSearchParams({
      chainId: String(chainId),
      src: tokenInAddr,
      dst: tokenOutAddr,
      amount: String(amount),
      slippage: String(slippage),
      ...(fromAddress ? { from: fromAddress } : {}),
    });

    const resp = await fetch(`https://api.1inch.dev/swap/v6.0/${chainId}/quote?${params}`, {
      headers: { 'Accept': 'application/json' },
    });

    if (resp.ok) {
      const quote = await resp.json();
      if (quote?.dstAmount) {
        const swapParams = new URLSearchParams({
          chainId: String(chainId),
          src: tokenInAddr,
          dst: tokenOutAddr,
          amount: String(amount),
          slippage: String(slippage),
          ...(fromAddress ? { from: fromAddress } : {}),
        });
        const swapResp = await fetch(`https://api.1inch.dev/swap/v6.0/${chainId}/swap?${swapParams}`, {
          headers: { 'Accept': 'application/json' },
        });
        const swapData = await swapResp.json();
        if (swapData?.tx) {
          return {
            provider: '1inch',
            tx: swapData.tx,
            price: Number(quote.dstAmount) / Number(amount),
            estimatedGas: Number(quote.estimatedGas || 0),
            dstAmount: quote.dstAmount,
          };
        }
        // If swap endpoint fails, return quote-only (read-only, no tx)
        return {
          provider: '1inch',
          tx: null,
          price: Number(quote.dstAmount) / Number(amount),
          estimatedGas: Number(quote.estimatedGas || 0),
          dstAmount: quote.dstAmount,
        };
      }
    }
  } catch (e) {
    console.warn('[dex-swap] 1inch quote failed:', e.message);
  }

  // Fallback: Uniswap Universal Router (read-only quote via subgraph)
  try {
    const query = `{
      tokens(where:{id:"${tokenInAddr.toLowerCase()}"}) {
        derivedETH
      }
      bundle(id:"1") {
        ethPriceUSD
      }
    }`;
    const resp = await fetch('https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const data = await resp.json();
    if (data?.data?.tokens?.[0]?.derivedETH && data?.data?.bundle?.ethPriceUSD) {
      const tokenPrice = Number(data.data.tokens[0].derivedETH) * Number(data.data.bundle.ethPriceUSD);
      return {
        provider: 'uniswap-v3',
        tx: null,
        price: tokenPrice,
        estimatedGas: 0,
        dstAmount: String(Math.floor(amount * tokenPrice * 1e6)),
      };
    }
  } catch (e) {
    console.warn('[dex-swap] Uniswap quote failed:', e.message);
  }

  throw new Error(`No DEX quote available for ${tokenIn}→${tokenOut} on ${chain}`);
}

/**
 * Quick price-only quote for DEX scanning (lightweight, no swap tx generation).
 */
export async function getDEXPriceOnly(chain, tokenIn, tokenOut, amount = '1000000000000000000') {
  try {
    const quote = await getDEXSwapQuote({ chain, tokenIn, tokenOut, amount: Number(amount), slippage: 5 });
    return { price: quote.price, exchange: chain, fee: 0.002, provider: quote.provider };
  } catch {
    return null;
  }
}
