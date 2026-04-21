// dex-executor - Cross-Chain & DEX Arbitrage Executor

async function fetchWithRetry(url, options = {}, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, ...options });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.json();
    } catch (e) {
      if (i === retries) throw e;
    }
  }
}

async function getAlchemyPrice(symbol, apiKey) {
  if (!apiKey) throw new Error('ALCHEMY_API_KEY environment variable is required');
  const url = `https://api.g.alchemy.com/prices/v1/${apiKey}/tokens/by-symbol?symbols[]=${symbol}`;
  const data = await fetchWithRetry(url);
  const price = data?.data?.[0]?.prices?.[0]?.value;
  if (!price) throw new Error('Alchemy price response missing value');
  return parseFloat(price);
}

async function getPancakePrice(tokenAddress) {
  const data = await fetchWithRetry(`https://api.pancakeswap.info/api/v2/tokens/${tokenAddress}`);
  const price = data?.data?.price;
  if (price === undefined || price === null) throw new Error('PancakeSwap missing price');
  return parseFloat(price);
}

async function scanCrossChain(env) {
  const WETH_BSC = '0x2170ed0880ac9a755fd29b2688956bd959f933f8';

  const ethPrice = await getAlchemyPrice('ETH', env.ALCHEMY_API_KEY);
  const bscPrice = await getPancakePrice(WETH_BSC);
  const spread = ((bscPrice - ethPrice) / ethPrice) * 100;

  console.log(`🌐 Cross-Chain ETH: Ethereum $${ethPrice.toFixed(2)} | BSC $${bscPrice.toFixed(2)} | Spread ${spread.toFixed(4)}%`);

  return { ethPrice, bscPrice, spread, threshold: 0.5 };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/execute' && request.method === 'POST') {
      const opp = await request.json();
      console.log(`📋 DEX task received: ${opp.type || 'unknown'}`, JSON.stringify(opp));

      if (opp.type === 'cross_chain') {
        try {
          const result = await scanCrossChain(env);
          if (Math.abs(result.spread) > result.threshold) {
            const direction = result.spread > 0 ? 'BUY_ETH_SELL_BSC' : 'BUY_BSC_SELL_ETH';
            console.log(`🎯 Cross-chain opportunity confirmed: ${direction} | Spread ${result.spread.toFixed(4)}%`);
            return new Response(JSON.stringify({ status: 'opportunity_found', direction, spread: result.spread }), {
              headers: { 'Content-Type': 'application/json' }
            });
          }
          return new Response(JSON.stringify({ status: 'no_opportunity', spread: result.spread }), {
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (e) {
          console.error('❌ Cross-chain scan error:', e.message);
          return new Response(JSON.stringify({ status: 'error', message: e.message }), {
            status: 500, headers: { 'Content-Type': 'application/json' }
          });
        }
      }

      return new Response(JSON.stringify({ status: 'unknown_type' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.pathname === '/cross-chain-scan') {
      try {
        const result = await scanCrossChain(env);
        return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response('DEX Executor - Cross-Chain Arbitrage');
  }
};
