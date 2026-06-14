// nexus/src/strategies/scalping-parallel.js
// Parallel scalping: bundles the top two independent CEX spread legs for one symbol.

const DATA_ONLY_EXCHANGES = new Set(['kraken', 'coinbase']);
const DEFAULT_MIN_NET_PCT = 0.01;
const DEFAULT_MIN_SAFETY = 0.12;

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

function addRejection(options, reason, count = 1) {
  try {
    if (!options || !options.rejections || !reason || count <= 0) return;
    const symbol = options?.symbol ?? 'unknown';
    const exchange = options?.buyExchange || options?.sellExchange || 'unknown';
    const netPct = options?.netPct ?? 0;
    options.rejections[reason] = Number(options.rejections[reason] || 0) + Number(count || 0);
  } catch (_) {
    // never throw
  }
}

export function scanScalpingParallel(symbol, sources, options = {}) {
  const executionSources = (Array.isArray(sources) ? sources : []).filter(
    (s) => s && !DATA_ONLY_EXCHANGES.has(String(s.exchange || '').toLowerCase())
  );

  if (executionSources.length < 3) {
    addRejection(options, 'insufficient_sources');
    addRejection(options, 'insufficient_execution_sources');
    return null;
  }

  const minNetPct = Number.isFinite(options.minNetPct) ? options.minNetPct : DEFAULT_MIN_NET_PCT;
  const minSafety = Number.isFinite(options.minSafety) ? options.minSafety : DEFAULT_MIN_SAFETY;

  const candidates = [];
  let rejectedInvalidInput = 0;
  let rejectedNonPositiveSpread = 0;
  let rejectedDataOnlyVenue = 0;
  let rejectedNetBelowMin = 0;
  let rejectedLowSafety = 0;
  for (let i = 0; i < executionSources.length; i++) {
    for (let j = 0; j < executionSources.length; j++) {
      if (i === j) continue;
      const buy = executionSources[i];
      const sell = executionSources[j];
      if (!buy || !sell || !Number.isFinite(buy.price) || !Number.isFinite(sell.price)) {
        rejectedInvalidInput++;
        continue;
      }
      if (sell.price <= buy.price) {
        rejectedNonPositiveSpread++;
        continue;
      }
      if (DATA_ONLY_EXCHANGES.has(buy.exchange) || DATA_ONLY_EXCHANGES.has(sell.exchange)) {
        rejectedDataOnlyVenue++;
        continue;
      }

      const grossPct = ((sell.price - buy.price) / buy.price) * 100;
      const feePct = (Number(buy.fee || 0) + Number(sell.fee || 0)) * 100;
      const slippagePct = getOneWaySlippagePct(buy.exchange) + getOneWaySlippagePct(sell.exchange);
      const netPct = grossPct - feePct - slippagePct;
      if (!Number.isFinite(netPct) || netPct < minNetPct) {
        rejectedNetBelowMin++;
        continue;
      }

      const safetyFactor = netPct / grossPct;
      if (!Number.isFinite(safetyFactor) || safetyFactor < minSafety) {
        rejectedLowSafety++;
        continue;
      }

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

  if (candidates.length < 2) {
    addRejection(options, 'invalid_input_prices', rejectedInvalidInput);
    addRejection(options, 'non_positive_spread', rejectedNonPositiveSpread);
    addRejection(options, 'data_only_execution_venue', rejectedDataOnlyVenue);
    addRejection(options, 'net_below_min', rejectedNetBelowMin);
    addRejection(options, 'safety_below_threshold', rejectedLowSafety);
    addRejection(options, 'insufficient_parallel_candidates');
    return null;
  }
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

  if (legs.length < 2) {
    addRejection(options, 'parallel_leg_overlap_conflict');
    return null;
  }

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
