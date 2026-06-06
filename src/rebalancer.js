const DEFAULT_REBALANCE_POLICY = {
  enabled: false,
  targetBufferPct: 0.10,
  minTransferUsd: 25,
  maxShiftPctPerCycle: 0.25,
};

const DEFAULT_VENUE_ROUTING_POLICY = {
  balanceWeight: 0.15,
  successWeight: 0.40,
  latencyWeight: 0.30,
  pnlWeight: 0.15,
  latencyTargetMs: 1000,
  pnlScaleUsd: 60,
  minSamplesForTrust: 6,
  coldStartPenalty: 0.92,
  lossPenaltyFloor: 0.75,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function normalizeRebalancePolicy(input = {}) {
  return {
    enabled: input.enabled === true,
    targetBufferPct: clamp(Number(input.targetBufferPct ?? DEFAULT_REBALANCE_POLICY.targetBufferPct), 0, 0.5),
    minTransferUsd: clamp(Number(input.minTransferUsd ?? DEFAULT_REBALANCE_POLICY.minTransferUsd), 1, 100000),
    maxShiftPctPerCycle: clamp(Number(input.maxShiftPctPerCycle ?? DEFAULT_REBALANCE_POLICY.maxShiftPctPerCycle), 0.01, 1),
  };
}

export function buildRebalanceWeights(balances = [], policyInput = {}) {
  const policy = normalizeRebalancePolicy(policyInput);
  const valid = balances
    .filter((b) => b && b.configured && !b.error && !b.dataOnly && Number.isFinite(Number(b.balance)))
    .map((b) => ({ exchange: b.exchange, balance: Number(b.balance) }))
    .filter((b) => b.balance >= 0);

  if (valid.length < 2) {
    return {
      policy,
      targetBalance: 0,
      totalBalance: valid.reduce((s, b) => s + b.balance, 0),
      weights: Object.fromEntries(valid.map((b) => [b.exchange, 1])),
    };
  }

  const totalBalance = valid.reduce((s, b) => s + b.balance, 0);
  const targetBalance = totalBalance / valid.length;
  const weights = {};

  for (const item of valid) {
    if (targetBalance <= 0) {
      weights[item.exchange] = 1;
      continue;
    }

    const diffRatio = (targetBalance - item.balance) / targetBalance;
    // Deficit exchange (>0) gets weight >1 to favor buy-side replenishment.
    // Surplus exchange (<0) gets weight <1 to favor sell-side draining.
    weights[item.exchange] = clamp(1 + diffRatio, 0.5, 1.5);
  }

  return { policy, targetBalance, totalBalance, weights };
}

export function buildVenueRoutingWeights(balances = [], venueOutcomes = {}, policyInput = {}) {
  const policy = {
    ...DEFAULT_VENUE_ROUTING_POLICY,
    ...normalizeRebalancePolicy(policyInput),
    ...policyInput,
  };

  const validBalances = balances
    .filter((b) => b && b.configured && !b.error && !b.dataOnly && Number.isFinite(Number(b.balance)))
    .map((b) => ({ exchange: String(b.exchange || '').toLowerCase(), balance: Number(b.balance) }))
    .filter((b) => b.exchange && b.balance >= 0);

  const totalBalance = validBalances.reduce((s, b) => s + b.balance, 0);
  const targetBalance = validBalances.length > 0 ? totalBalance / validBalances.length : 0;
  const balanceMap = Object.fromEntries(validBalances.map((b) => [b.exchange, b.balance]));

  const exchanges = new Set([
    ...Object.keys(balanceMap),
    ...Object.keys(venueOutcomes || {}).map((k) => String(k || '').toLowerCase()),
  ]);

  const weights = {};
  for (const exchange of exchanges) {
    const balance = Number(balanceMap[exchange] ?? 0);
    const bucket = venueOutcomes?.[exchange] || venueOutcomes?.[String(exchange).toLowerCase()] || {};
    const wins = Number(bucket.wins || 0);
    const losses = Number(bucket.losses || 0);
    const total = wins + losses;
    const winRate = total > 0 ? wins / total : 0.5;
    const sampleConfidence = clamp(total / Math.max(1, Number(policy.minSamplesForTrust || 1)), 0, 1);
    const avgLatencyMs = Number(bucket.latencySamples || 0) > 0
      ? Number(bucket.latencyMsTotal || 0) / Number(bucket.latencySamples || 1)
      : policy.latencyTargetMs;
    const totalPnlUsd = Number(bucket.totalPnlUsd || 0);

    const balanceScore = targetBalance > 0
      ? clamp(0.75 + (balance / targetBalance) * 0.5, 0.75, 1.25)
      : 1;
    const rawSuccessScore = clamp(0.7 + (winRate * 0.6), 0.7, 1.3);
    const rawLatencyScore = clamp(1.35 - (avgLatencyMs / Math.max(1, policy.latencyTargetMs * 3)), 0.6, 1.35);
    const rawPnlScore = clamp(1 + (totalPnlUsd / Math.max(1, policy.pnlScaleUsd)), 0.8, 1.25);

    // Prevent over-favoring new venues until enough observations are collected.
    const successScore = (rawSuccessScore * sampleConfidence) + (1 * (1 - sampleConfidence));
    const latencyScore = (rawLatencyScore * sampleConfidence) + (1 * (1 - sampleConfidence));
    const pnlScore = (rawPnlScore * sampleConfidence) + (1 * (1 - sampleConfidence));

    let confidencePenalty = 1;
    if (total < Number(policy.minSamplesForTrust || 0)) {
      confidencePenalty *= clamp(Number(policy.coldStartPenalty || 0.92), 0.7, 1);
    }
    if (total >= Number(policy.minSamplesForTrust || 0) && losses > wins) {
      const lossDeltaRatio = clamp((losses - wins) / Math.max(1, total), 0, 1);
      confidencePenalty *= clamp(1 - (lossDeltaRatio * 0.35), Number(policy.lossPenaltyFloor || 0.75), 1);
    }

    const weight = (
      (balanceScore * policy.balanceWeight) +
      (successScore * policy.successWeight) +
      (latencyScore * policy.latencyWeight) +
      (pnlScore * policy.pnlWeight)
    ) * confidencePenalty;

    weights[exchange] = clamp(weight, 0.45, 1.75);
  }

  return {
    policy,
    totalBalance: Number(totalBalance.toFixed(2)),
    targetBalance: Number(targetBalance.toFixed(2)),
    weights,
  };
}

export function computeRebalancePlan(balances = [], policyInput = {}) {
  const policy = normalizeRebalancePolicy(policyInput);
  const valid = balances
    .filter((b) => b && b.configured && !b.error && !b.dataOnly && Number.isFinite(Number(b.balance)))
    .map((b) => ({ exchange: b.exchange, balance: Number(b.balance) }))
    .filter((b) => b.balance >= 0);

  const totalBalance = valid.reduce((sum, b) => sum + b.balance, 0);
  const targetBalance = valid.length > 0 ? totalBalance / valid.length : 0;

  if (valid.length < 2 || targetBalance <= 0) {
    return {
      policy,
      balances: valid,
      totalBalance,
      targetBalance,
      estimatedTransfers: [],
      summary: {
        exchanges: valid.length,
        rebalancingNeeded: false,
        estimatedShiftUsd: 0,
        cycleShiftCapUsd: 0,
      },
    };
  }

  const lower = targetBalance * (1 - policy.targetBufferPct);
  const upper = targetBalance * (1 + policy.targetBufferPct);
  const deficits = [];
  const surpluses = [];

  for (const b of valid) {
    if (b.balance < lower) {
      deficits.push({ exchange: b.exchange, amount: lower - b.balance });
    } else if (b.balance > upper) {
      surpluses.push({ exchange: b.exchange, amount: b.balance - upper });
    }
  }

  deficits.sort((a, b) => b.amount - a.amount);
  surpluses.sort((a, b) => b.amount - a.amount);

  const cycleShiftCapUsd = totalBalance * policy.maxShiftPctPerCycle;
  let shifted = 0;
  const estimatedTransfers = [];

  let i = 0;
  let j = 0;

  while (i < surpluses.length && j < deficits.length && shifted < cycleShiftCapUsd) {
    const from = surpluses[i];
    const to = deficits[j];

    const remainingCap = cycleShiftCapUsd - shifted;
    const amount = Math.min(from.amount, to.amount, remainingCap);

    if (amount >= policy.minTransferUsd) {
      estimatedTransfers.push({
        from: from.exchange,
        to: to.exchange,
        amountUsd: Number(amount.toFixed(2)),
      });
      shifted += amount;
    }

    from.amount -= amount;
    to.amount -= amount;

    if (from.amount < policy.minTransferUsd) i++;
    if (to.amount < policy.minTransferUsd) j++;
  }

  return {
    policy,
    balances: valid,
    totalBalance: Number(totalBalance.toFixed(2)),
    targetBalance: Number(targetBalance.toFixed(2)),
    estimatedTransfers,
    summary: {
      exchanges: valid.length,
      rebalancingNeeded: estimatedTransfers.length > 0,
      estimatedShiftUsd: Number(shifted.toFixed(2)),
      cycleShiftCapUsd: Number(cycleShiftCapUsd.toFixed(2)),
    },
  };
}
