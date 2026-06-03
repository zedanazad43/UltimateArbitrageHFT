// nexus/src/strategies/scalping-reverse.js
// Reverse scalping: favors mean-reversion-ready spreads with stricter safety.

const DATA_ONLY_EXCHANGES = new Set(['bybit', 'gateio', 'kraken', 'coinbase']);

const DEFAULT_MIN_NET_PCT = 0.08;
const DEFAULT_MIN_SAFETY = 0.42;
const DEFAULT_MIN_GROSS_PCT = 0.20;
const DEFAULT_MAX_GROSS_PCT = 1.80;

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

export function scanScalpingReverse(symbol, sources, options = {}) {
  if (!Array.isArray(sources) || sources.length < 2) return null;

  const minNetPct = Number.isFinite(options.minNetPct) ? options.minNetPct : DEFAULT_MIN_NET_PCT;
  const minSafety = Number.isFinite(options.minSafety) ? options.minSafety : DEFAULT_MIN_SAFETY;
  const minGrossPct = Number.isFinite(options.minGrossPct) ? options.minGrossPct : DEFAULT_MIN_GROSS_PCT;
  const maxGrossPct = Number.isFinite(options.maxGrossPct) ? options.maxGrossPct : DEFAULT_MAX_GROSS_PCT;

  let best = null;

  for (let i = 0; i < sources.length; i++) {
    for (let j = 0; j < sources.length; j++) {
      if (i === j) continue;

      const buy = sources[i];
      const sell = sources[j];
      if (!buy || !sell || !Number.isFinite(buy.price) || !Number.isFinite(sell.price)) continue;
      if (sell.price <= buy.price) continue;
      if (DATA_ONLY_EXCHANGES.has(buy.exchange) || DATA_ONLY_EXCHANGES.has(sell.exchange)) continue;

      const grossPct = ((sell.price - buy.price) / buy.price) * 100;
      if (!Number.isFinite(grossPct) || grossPct < minGrossPct || grossPct > maxGrossPct) continue;

      const feePct = (Number(buy.fee || 0) + Number(sell.fee || 0)) * 100;
      const slippagePct = getOneWaySlippagePct(buy.exchange) + getOneWaySlippagePct(sell.exchange);
      const netPct = grossPct - feePct - slippagePct;
      if (!Number.isFinite(netPct) || netPct < minNetPct) continue;

      const safetyFactor = netPct / grossPct;
      if (!Number.isFinite(safetyFactor) || safetyFactor < minSafety) continue;

      const normalizedWindow = 1 - Math.min(1, Math.abs(grossPct - ((minGrossPct + maxGrossPct) / 2)) / maxGrossPct);
      const confidence = Math.max(0.25, Math.min(0.95, (safetyFactor * 0.75) + (normalizedWindow * 0.25)));

      const candidate = {
        strategy: 'scalp_reverse',
        symbol,
        buyExchange: buy.exchange,
        sellExchange: sell.exchange,
        buyPrice: buy.price,
        sellPrice: sell.price,
        grossPct,
        netPct,
        safetyFactor,
        confidence,
        holdSeconds: 10,
        direction: `REV:${String(buy.exchange || '').toUpperCase()}→${String(sell.exchange || '').toUpperCase()}`,
        isPerp: false,
      };

      if (!best || candidate.netPct > best.netPct) best = candidate;
    }
  }

  return best;
}
