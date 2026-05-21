const DEFAULT_REBALANCE_POLICY = {
  enabled: false,
  targetBufferPct: 0.10,
  minTransferUsd: 25,
  maxShiftPctPerCycle: 0.25,
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
