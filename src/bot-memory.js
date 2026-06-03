/**
 * Bot Memory — Persistent long-term learning and strategy memory
 *
 * Stores strategy outcomes, evaluation history, and auto-tuning
 * recommendations in Cloudflare KV under key 'bot_memory'.  All
 * modifications are bounded by safety limits and are reviewable via the
 * dashboard.
 */

const KV_KEY = 'bot_memory';
const MAX_STRATEGY_OUTCOMES = 500; // per strategy, circular buffer
const MAX_EVALUATIONS = 50;        // last N evaluation snapshots kept

// ── Safety bounds for auto-tuning weight adjustments ─────────────────────────
const WEIGHT_MIN = 0.2;
const WEIGHT_MAX = 2.0;
const WEIGHT_STEP = 0.1; // max change per evaluation cycle

/**
 * Loads the bot memory from KV storage.
 * Returns an empty memory structure if not found or on error.
 *
 * @param {object} env — Cloudflare Worker env bindings (must have BOT_STATE KV)
 * @returns {Promise<object>}
 */
export async function loadBotMemory(env) {
  const raw = await env.BOT_STATE?.get(KV_KEY, 'json').catch(() => null);
  return raw || _emptyMemory();
}

/**
 * Saves the bot memory to KV storage.
 *
 * @param {object} env
 * @param {object} memory
 */
export async function saveBotMemory(env, memory) {
  if (!env.BOT_STATE) return;
  memory.updatedAt = Date.now();
  await env.BOT_STATE.put(KV_KEY, JSON.stringify(memory));
}

/**
 * Records a single trade outcome for a given strategy.
 *
 * @param {object} env
 * @param {string} strategy — strategy name: 'cex' | 'dex' | 'perps' | 'triangular' | 'statistical' | 'funding' | 'scalp_forward' | 'scalp_reverse' | 'scalp_parallel'
 * @param {{ success: boolean, pnlUsd: number, symbol?: string, exchange?: string }} outcome
 */
export async function recordStrategyOutcome(env, strategy, outcome) {
  const memory = await loadBotMemory(env);
  if (!memory.strategyOutcomes[strategy]) {
    memory.strategyOutcomes[strategy] = { outcomes: [], wins: 0, losses: 0, totalPnlUsd: 0 };
  }
  const bucket = memory.strategyOutcomes[strategy];
  bucket.outcomes.push({
    ts: Date.now(),
    success: !!outcome.success,
    pnlUsd: Number(outcome.pnlUsd || 0),
    symbol: outcome.symbol || '',
    exchange: outcome.exchange || '',
  });
  if (bucket.outcomes.length > MAX_STRATEGY_OUTCOMES) {
    bucket.outcomes = bucket.outcomes.slice(-MAX_STRATEGY_OUTCOMES);
  }
  if (outcome.success) bucket.wins = (bucket.wins || 0) + 1;
  else bucket.losses = (bucket.losses || 0) + 1;
  bucket.totalPnlUsd = (bucket.totalPnlUsd || 0) + Number(outcome.pnlUsd || 0);
  await saveBotMemory(env, memory);
}

/**
 * Records a self-evaluation snapshot and applies bounded auto-tuning.
 *
 * @param {object} env
 * @param {object} evaluationData — result from evaluateStrategyBreakdown()
 * @param {{ period_days?: number, trade_count?: number, return_pct?: number }} meta
 * @returns {Promise<object>} updated memory
 */
export async function recordEvaluation(env, evaluationData, meta = {}) {
  const memory = await loadBotMemory(env);

  const snapshot = {
    ts: Date.now(),
    period_days: meta.period_days || 7,
    trade_count: meta.trade_count || 0,
    return_pct: meta.return_pct || 0,
    rankings: (evaluationData.rankings || []).map(r => ({
      strategy: r.strategy,
      score: r.score,
      trades: r.trades,
      winRate: r.winRate,
      sharpe: r.sharpe,
      totalPnlUsd: r.totalPnlUsd,
    })),
    recommendations: evaluationData.recommendations || [],
    leader: evaluationData.leader
      ? { strategy: evaluationData.leader.strategy, score: evaluationData.leader.score }
      : null,
    laggard: evaluationData.laggard
      ? { strategy: evaluationData.laggard.strategy, score: evaluationData.laggard.score }
      : null,
  };

  memory.evaluations.push(snapshot);
  if (memory.evaluations.length > MAX_EVALUATIONS) {
    memory.evaluations = memory.evaluations.slice(-MAX_EVALUATIONS);
  }
  memory.recommendations = snapshot.recommendations;

  // Apply bounded auto-tuning based on recommendations
  const adjustments = [];
  for (const rec of snapshot.recommendations) {
    const parts = rec.split(' ');
    const action = parts[0];
    const strategyName = parts[1];
    if (!strategyName) continue;

    if (action === 'scale') {
      const current = memory.strategyWeights[strategyName] ?? 1.0;
      const next = Math.min(WEIGHT_MAX, +(current + WEIGHT_STEP).toFixed(2));
      if (next !== current) {
        memory.strategyWeights[strategyName] = next;
        adjustments.push({ action: 'weight_up', strategy: strategyName, from: current, to: next, reason: rec });
      }
    } else if (action === 'de-risk') {
      const current = memory.strategyWeights[strategyName] ?? 1.0;
      const next = Math.max(WEIGHT_MIN, +(current - WEIGHT_STEP).toFixed(2));
      if (next !== current) {
        memory.strategyWeights[strategyName] = next;
        adjustments.push({ action: 'weight_down', strategy: strategyName, from: current, to: next, reason: rec });
      }
    }
  }

  if (adjustments.length > 0) {
    memory.autoTuning = { appliedAt: Date.now(), adjustments };
  }

  await saveBotMemory(env, memory);
  return memory;
}

/**
 * Returns a summary of the latest memory state for dashboard display.
 *
 * @param {object} memory
 * @returns {object}
 */
export function summarizeMemory(memory) {
  if (!memory || !memory.evaluations?.length) {
    return {
      hasData: false,
      message: 'لا توجد بيانات ذاكرة مراكمة بعد. قم بتشغيل التقييم الذاتي لبدء التعلم.',
    };
  }

  const latest = memory.evaluations[memory.evaluations.length - 1];

  const strategyStats = Object.entries(memory.strategyOutcomes || {}).map(([strat, bucket]) => {
    const total = (bucket.wins || 0) + (bucket.losses || 0);
    const winRate = total > 0 ? +((bucket.wins / total) * 100).toFixed(1) : null;
    return {
      strategy: strat,
      wins: bucket.wins || 0,
      losses: bucket.losses || 0,
      winRate,
      totalPnlUsd: +(bucket.totalPnlUsd || 0).toFixed(2),
      weight: memory.strategyWeights[strat] ?? 1.0,
    };
  });

  return {
    hasData: true,
    lastEvalAt: latest.ts,
    evaluationCount: memory.evaluations.length,
    recommendations: memory.recommendations || [],
    autoTuning: memory.autoTuning || null,
    strategyWeights: { ...memory.strategyWeights },
    strategyStats,
    leader: latest.leader,
    laggard: latest.laggard,
    lastReturnPct: latest.return_pct,
    lastTradePeriodDays: latest.period_days,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function _emptyMemory() {
  return {
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    evaluations: [],
    strategyOutcomes: {},
    strategyWeights: {
      cex: 1.0, dex: 1.0, perps: 1.0,
      triangular: 1.0, statistical: 1.0, funding: 1.0,
      scalp_forward: 1.0, scalp_reverse: 1.0, scalp_parallel: 1.0,
    },
    autoTuning: { appliedAt: null, adjustments: [] },
    recommendations: [],
  };
}
