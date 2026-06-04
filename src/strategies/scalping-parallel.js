// nexus/src/strategies/scalping-parallel.js
// Parallel scalping: bundles the top two independent CEX spread legs for one symbol.

const DATA_ONLY_EXCHANGES = new Set(['bybit', 'gateio', 'kraken', 'coinbase']);
const DEFAULT_MIN_NET_PCT = 0.03;
const DEFAULT_MIN_SAFETY = 0.18;

function getOneWaySlippagePct(exchange) {
  const map = {
    binance: 0.02,
    mexc: 0.03,
    kucoin: 0.05,
    bitget: 0.06,
    bitmart: 0.08,
    htx: 0.06,
  };
  return map[String(exchange || '').toLowerCase()] ?? 0.07;
}

export function scanScalpingParallel(symbol, sources, options = {}) {
  if (!Array.isArray(sources) || sources.length < 3) return null;

  const minNetPct = Number.isFinite(options.minNetPct) ? options.minNetPct : DEFAULT_MIN_NET_PCT;
  const minSafety = Number.isFinite(options.minSafety) ? options.minSafety : DEFAULT_MIN_SAFETY;

  const candidates = [];
  for (let i = 0; i < sources.length; i++) {
    for (let j = 0; j < sources.length; j++) {
      if (i === j) continue;
      const buy = sources[i];
      const sell = sources[j];
      if (!buy || !sell || !Number.isFinite(buy.price) || !Number.isFinite(sell.price)) continue;
      if (sell.price <= buy.price) continue;
      if (DATA_ONLY_EXCHANGES.has(buy.exchange) || DATA_ONLY_EXCHANGES.has(sell.exchange)) continue;

      const grossPct = ((sell.price - buy.price) / buy.price) * 100;
      const feePct = (Number(buy.fee || 0) + Number(sell.fee || 0)) * 100;
      const slippagePct = getOneWaySlippagePct(buy.exchange) + getOneWaySlippagePct(sell.exchange);
      const netPct = grossPct - feePct - slippagePct;
      if (!Number.isFinite(netPct) || netPct < minNetPct) continue;

      const safetyFactor = netPct / grossPct;
      if (!Number.isFinite(safetyFactor) || safetyFactor < minSafety) continue;

      candidates.push({
        buyExchange: buy.exchange,
        sellExchange: sell.exchange,
        buyPrice: buy.price,
        sellPrice: sell.price,
        grossPct,
        netPct,
        safetyFactor,
        direction: `${String(buy.exchange || '').toUpperCase()}→${String(sell.exchange || '').toUpperCase()}`,
      });
    }
  }

  if (candidates.length < 2) return null;
  candidates.sort((a, b) => b.netPct - a.netPct);

  const legs = [];
  const usedExchanges = new Set();
  for (const c of candidates) {
    const buy = String(c.buyExchange || '').toLowerCase();
    const sell = String(c.sellExchange || '').toLowerCase();
    if (usedExchanges.has(buy) || usedExchanges.has(sell)) continue;
    legs.push(c);
    usedExchanges.add(buy);
    usedExchanges.add(sell);
    if (legs.length >= 2) break;
  }

  if (legs.length < 2) return null;

  const combinedNet = legs.reduce((s, x) => s + x.netPct, 0) / legs.length;
  const combinedGross = legs.reduce((s, x) => s + x.grossPct, 0) / legs.length;
  const combinedSafety = combinedGross > 0 ? (combinedNet / combinedGross) : 0;

  return {
    strategy: 'scalp_parallel',
    symbol,
    buyExchange: legs[0].buyExchange,
    sellExchange: legs[0].sellExchange,
    buyPrice: legs[0].buyPrice,
    sellPrice: legs[0].sellPrice,
    grossPct: combinedGross,
    netPct: combinedNet,
    safetyFactor: combinedSafety,
    confidence: Math.max(0.3, Math.min(0.95, combinedSafety + 0.12)),
    holdSeconds: 8,
    direction: `PAR:${legs.map((x) => x.direction).join(' + ')}`,
    parallelLegs: legs,
    isPerp: false,
  };
}
