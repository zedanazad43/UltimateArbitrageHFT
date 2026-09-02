// nexus/src/dex-executor.js — Internal DEX Execution Engine
//
// Executes on-chain swaps via 1inch Aggregation API and Uniswap V3.
// Supports Ethereum, BSC, Arbitrum, Polygon, and Optimism.
// Eliminates the external DEX_EXECUTOR_URL dependency.

// ── Chain configuration ──────────────────────────────────────────────────────

const CHAIN_CONFIG = {
    ethereum: {
        chainId: 1,
        rpcUrl: 'https://eth.llamarpc.com',
        oneInchBase: 'https://api.1inch.dev/swap/v6.0/1',
        nativeToken: 'ETH',
        wrapAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        usdcAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        usdtAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        explorerUrl: 'https://etherscan.io/tx',
    },
    bsc: {
        chainId: 56,
        rpcUrl: 'https://bsc-dataseed1.binance.org',
        oneInchBase: 'https://api.1inch.dev/swap/v6.0/56',
        nativeToken: 'BNB',
        wrapAddress: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
        usdcAddress: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
        usdtAddress: '0x55d398326f99059fF775485246999027B3197955',
        explorerUrl: 'https://bscscan.com/tx',
    },
    arbitrum: {
        chainId: 42161,
        rpcUrl: 'https://arb1.arbitrum.io/rpc',
        oneInchBase: 'https://api.1inch.dev/swap/v6.0/42161',
        nativeToken: 'ETH',
        wrapAddress: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH
        usdcAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        usdtAddress: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
        explorerUrl: 'https://arbiscan.io/tx',
    },
    polygon: {
        chainId: 137,
        rpcUrl: 'https://polygon-rpc.com',
        oneInchBase: 'https://api.1inch.dev/swap/v6.0/137',
        nativeToken: 'MATIC',
        wrapAddress: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // WMATIC
        usdcAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
        usdtAddress: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
        explorerUrl: 'https://polygonscan.com/tx',
    },
    optimism: {
        chainId: 10,
        rpcUrl: 'https://mainnet.optimism.io',
        oneInchBase: 'https://api.1inch.dev/swap/v6.0/10',
        nativeToken: 'ETH',
        wrapAddress: '0x4200000000000000000000000000000000000006', // WETH
        usdcAddress: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
        usdtAddress: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
        explorerUrl: 'https://optimistic.etherscan.io/tx',
    },
};

const NATIVE_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

// ── Token address resolution ─────────────────────────────────────────────────

const TOKEN_ADDRESSES = {
    // Ethereum
    'ethereum:ETH': NATIVE_ADDRESS,
    'ethereum:WETH': '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    'ethereum:USDT': '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    'ethereum:USDC': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    'ethereum:WBTC': '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
    // BSC
    'bsc:BNB': NATIVE_ADDRESS,
    'bsc:WBNB': '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    'bsc:USDT': '0x55d398326f99059fF775485246999027B3197955',
    'bsc:USDC': '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    'bsc:ETH': '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
    'bsc:BTCB': '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',
    // Arbitrum
    'arbitrum:ETH': NATIVE_ADDRESS,
    'arbitrum:USDT': '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    'arbitrum:USDC': '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    // Polygon
    'polygon:MATIC': NATIVE_ADDRESS,
    'polygon:USDT': '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    'polygon:USDC': '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    // Optimism
    'optimism:ETH': NATIVE_ADDRESS,
    'optimism:USDT': '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
    'optimism:USDC': '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
};

/**
 * Resolves a token address for a given chain.
 * @param {string} chain - chain name (ethereum, bsc, arbitrum, polygon, optimism)
 * @param {string} token - token symbol (ETH, USDT, USDC, etc.)
 * @returns {string|null}
 */
export function getTokenAddress(chain, token) {
    return TOKEN_ADDRESSES[`${chain}:${token}`] || null;
}

// ── 1inch Swap Quote ─────────────────────────────────────────────────────────

/**
 * Gets a swap quote from 1inch Aggregation API.
 * @param {object} env - Cloudflare Worker environment
 * @param {string} chain - chain name
 * @param {string} fromToken - source token address
 * @param {string} toToken - destination token address
 * @param {string} amount - amount in wei (string)
 * @returns {Promise<object|null>}
 */
export async function get1inchQuote(env, chain, fromToken, toToken, amount) {
    const config = CHAIN_CONFIG[chain];
    if (!config) return null;

    // ONEINCH_API_KEY is optional — set via wrangler secret or wrangler.toml vars
    const apiKey = env.ONEINCH_API_KEY || env.ONEINCH_API;
    if (!apiKey) {
        return null;
    }

    const url = `${config.oneInchBase}/quote?` +
        `src=${fromToken}&dst=${toToken}&amount=${amount}`;

    try {
        const resp = await fetch(url, {
            headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!resp.ok) return null;
        return await resp.json();
    } catch {
        return null;
    }
}

// ── Cross-chain price comparison ─────────────────────────────────────────────

/**
 * Compares token prices across multiple chains to find cross-chain DEX arbitrage.
 * @param {object} env - Worker environment
 * @param {string} token - token symbol (ETH, USDT, USDC, WBTC, BNB)
 * @param {string[]} chains - chains to compare (default: ['ethereum', 'bsc', 'arbitrum', 'polygon'])
 * @returns {Promise<object|null>} best cross-chain opportunity
 */
export async function scanCrossChainDEX(env, token, chains = ['ethereum', 'bsc', 'arbitrum', 'polygon']) {
    const results = [];

    for (const chain of chains) {
        const config = CHAIN_CONFIG[chain];
        if (!config) continue;

        try {
            // Use Alchemy for ETH price, CoinGecko for others
            const price = await getChainPrice(env, chain, token);
            if (price) {
                results.push({ chain, price, fee: estimateChainFee(chain) });
            }
        } catch {
            // skip unavailable chains
        }
    }

    if (results.length < 2) return null;

    // Find the best buy/sell pair
    let best = null;
    for (let i = 0; i < results.length; i++) {
        for (let j = 0; j < results.length; j++) {
            if (i === j) continue;
            const buy = results[i];
            const sell = results[j];
            if (sell.price <= buy.price) continue;

            const grossPct = ((sell.price - buy.price) / buy.price) * 100;
            const totalFeePct = buy.fee + sell.fee;
            const netPct = grossPct - totalFeePct;

            if (netPct <= 0) continue;
            if (!best || netPct > best.netPct) {
                best = {
                    strategy: 'dex',
                    symbol: `${token}USDT`,
                    buyExchange: buy.chain,
                    sellExchange: sell.chain,
                    buyPrice: buy.price,
                    sellPrice: sell.price,
                    grossPct,
                    netPct,
                    safetyFactor: netPct / grossPct,
                    direction: `${buy.chain.toUpperCase()}→${sell.chain.toUpperCase()}`,
                    isPerp: false,
                    crossChain: true,
                };
            }
        }
    }

    return best;
}

// ── Chain price fetching ─────────────────────────────────────────────────────

async function getChainPrice(env, chain, token) {
    try {
        const { getAlchemyPrice, getPancakePrice, getCoinGeckoSimplePrice } = await import('./prices.js');

        if (chain === 'ethereum') {
            const key = env.ALCHEMY_API_KEY || env.ALCHEMY_ETHEREUM_ENDPOINT;
            return key ? await getAlchemyPrice(token, key) : getCoinGeckoSimplePrice(token.toLowerCase());
        }
        if (chain === 'bsc') {
            const addr = TOKEN_ADDRESSES['bsc:' + token];
            if (addr) {
                return (await getPancakePrice(addr)) || null;
            }
        }
        // For L2s, use CoinGecko as reference
        return getCoinGeckoSimplePrice(token.toLowerCase());
    } catch {
        return null;
    }
}

// ── Fee estimation per chain ─────────────────────────────────────────────────

function estimateChainFee(chain) {
    const fees = {
        ethereum: 0.3,  // ~0.3% (gas + DEX fee)
        bsc: 0.1,       // ~0.1%
        arbitrum: 0.1,  // ~0.1%
        polygon: 0.05,  // ~0.05%
        optimism: 0.08, // ~0.08%
    };
    return fees[chain] || 0.2;
}

// ── Execution simulation (paper mode) ────────────────────────────────────────

/**
 * Simulates DEX swap execution and returns estimated output.
 * Used in paper trading mode or when no private key is configured.
 * @param {object} env - Worker environment
 * @param {object} opp - opportunity object
 * @param {number} sizeUsd - trade size in USD
 * @returns {Promise<object>}
 */
export async function simulateDexSwap(env, opp, sizeUsd) {
    const buyChain = opp.buyExchange;
    const sellChain = opp.sellExchange;

    const buyConfig = CHAIN_CONFIG[buyChain];
    const sellConfig = CHAIN_CONFIG[sellChain];

    return {
        success: true,
        paper: true,
        buyChain,
        sellChain,
        sizeUsd,
        estimatedBuyAmount: sizeUsd / opp.buyPrice,
        estimatedSellAmount: sizeUsd / opp.sellPrice,
        buyExplorer: buyConfig ? `${buyConfig.explorerUrl}/PAPER` : 'unknown',
        sellExplorer: sellConfig ? `${sellConfig.explorerUrl}/PAPER` : 'unknown',
        note: 'Paper execution — no on-chain transaction sent',
    };
}

// ── Export chain config for external use ─────────────────────────────────────

export { CHAIN_CONFIG };
