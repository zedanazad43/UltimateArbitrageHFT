// nexus/src/strategies/scalping-forward.js
// Front scalping: favors fast spread-expansion opportunities with high safety.

const DATA_ONLY_EXCHANGES = new Set(['kraken', 'coinbase']);
const LIQUIDITY_BONUS = new Set(['binance', 'mexc', 'bitget']);

const DEFAULT_MIN_NET_PCT = 0.01;
const DEFAULT_MIN_SAFETY = 0.12;
const DEFAULT_MAX_GROSS_PCT = 8.0;

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
    options.rejections[reason] = Number(options.rejections[reason] || 0) + Number(count || 0);
  } catch (_) {
    // never throw
  }
}

export function scanScalpingForward(symbol, sources, options = {}) {
  const executionSources = (Array.isArray(sources) ? sources : []).filter(
    (s) => s && !DATA_ONLY_EXCHANGES.has(String(s.exchange || '').toLowerCase())
  );

  if (executionSources.length < 2) {
    addRejection(options, 'insufficient_sources');
    addRejection(options, 'insufficient_execution_sources');
    return null;
  }

  const minNetPct = Number.isFinite(options.minNetPct) ? options.minNetPct : DEFAULT_MIN_NET_PCT;
  const minSafety = Number.isFinite(options.minSafety) ? options.minSafety : DEFAULT_MIN_SAFETY;
  const maxGrossPct = Number.isFinite(options.maxGrossPct) ? options.maxGrossPct : DEFAULT_MAX_GROSS_PCT;

  let best = null;
  let rejectedInvalidInput = 0;
  let rejectedNonPositiveSpread = 0;
  let rejectedDataOnlyVenue = 0;
  let rejectedGrossWindow = 0;
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
      if (!Number.isFinite(grossPct) || grossPct <= 0 || grossPct > maxGrossPct) {
        rejectedGrossWindow++;
        continue;
      }

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

      const liquidityBoost = (LIQUIDITY_BONUS.has(String(buy.exchange || '').toLowerCase()) ? 0.05 : 0) +
        (LIQUIDITY_BONUS.has(String(sell.exchange || '').toLowerCase()) ? 0.05 : 0);
      const confidence = Math.max(0.2, Math.min(0.95, safetyFactor + liquidityBoost));

      const candidate = {
        strategy: 'scalp_forward',
        symbol,
        buyExchange: buy.exchange,
        sellExchange: sell.exchange,
        buyPrice: buy.price,
        sellPrice: sell.price,
        grossPct,
        netPct,
        safetyFactor,
        confidence,
        holdSeconds: 6,
        direction: `FWD:${String(buy.exchange || '').toUpperCase()}→${String(sell.exchange || '').toUpperCase()}`,
        isPerp: false,
      };

      if (!best || candidate.netPct > best.netPct) best = candidate;
    }
  }

  if (!best) {
    addRejection(options, 'invalid_input_prices', rejectedInvalidInput);
    addRejection(options, 'non_positive_spread', rejectedNonPositiveSpread);
    addRejection(options, 'data_only_execution_venue', rejectedDataOnlyVenue);
    addRejection(options, 'gross_outside_window', rejectedGrossWindow);
    addRejection(options, 'net_below_min', rejectedNetBelowMin);
    addRejection(options, 'safety_below_threshold', rejectedLowSafety);
  }

  return best;
}
