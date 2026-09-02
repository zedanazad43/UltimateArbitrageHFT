function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function scoreStrategyMetrics(metrics = {}) {
  const trades = Number(metrics.total_trades || 0);
  const winRate = Number(metrics.win_rate || 0);
  const sharpe = Number(metrics.sharpe || 0);
  const profitFactor = Number(metrics.profit_factor || 0);
  const drawdownPct = Number(metrics.max_drawdown_pct || 0);
  const totalPnlUsd = Number(metrics.total_pnl_usd || 0);

  if (trades <= 0) return 0;

  let score = 50;
  score += clamp((winRate - 0.5) * 100, -20, 20);
  score += clamp(sharpe * 8, -16, 24);
  score += clamp((profitFactor - 1) * 12, -12, 24);
  score += clamp(trades * 0.3, 0, 12);
  score += clamp(totalPnlUsd / 25, -10, 12);
  score -= clamp(drawdownPct * 1.2, 0, 30);

  return Math.round(clamp(score, 0, 100));
}

function recommendationFor(entry, topScore) {
  if (entry.trades <= 0) return `hold ${entry.strategy}: no trade sample yet`;
  if (entry.score >= 75 && entry.score >= topScore - 5) {
    return `scale ${entry.strategy}: strong risk-adjusted performance`;
  }
  if (entry.score <= 35 || entry.maxDrawdownPct >= 20) {
    return `de-risk ${entry.strategy}: weak score or excessive drawdown`;
  }
  return `observe ${entry.strategy}: keep running and gather more data`;
}

export function evaluateStrategyBreakdown(breakdown = {}) {
  const rankings = Object.entries(breakdown).map(([strategy, metrics]) => ({
    strategy,
    score: scoreStrategyMetrics(metrics),
    trades: Number(metrics.total_trades || 0),
    winRate: Number(metrics.win_rate || 0),
    sharpe: Number(metrics.sharpe || 0),
    profitFactor: Number(metrics.profit_factor || 0),
    maxDrawdownPct: Number(metrics.max_drawdown_pct || 0),
    totalPnlUsd: Number(metrics.total_pnl_usd || 0),
    metrics,
  })).sort((left, right) => right.score - left.score || right.totalPnlUsd - left.totalPnlUsd);

  const topScore = rankings[0]?.score ?? 0;
  const recommendations = rankings.length > 0
    ? rankings.map((entry) => recommendationFor(entry, topScore))
    : ['hold: no strategy data available yet'];

  return {
    rankings,
    recommendations,
    leader: rankings[0] || null,
    laggard: rankings.at(-1) || null,
    generatedAt: Date.now(),
  };
}

export function summarizeEvaluation(evaluation) {
  const leader = evaluation?.leader;
  const laggard = evaluation?.laggard;
  const recommendations = evaluation?.recommendations || [];

  if (!leader) {
    return 'Strategy self-evaluation: no trade history available yet.';
  }

  const lines = [
    'Strategy self-evaluation',
    `Leader: ${leader.strategy} (score ${leader.score}, trades ${leader.trades}, pnl $${leader.totalPnlUsd.toFixed(2)})`,
  ];

  if (laggard && laggard.strategy !== leader.strategy) {
    lines.push(`Laggard: ${laggard.strategy} (score ${laggard.score}, drawdown ${laggard.maxDrawdownPct.toFixed(2)}%)`);
  }

  for (const recommendation of recommendations.slice(0, 3)) {
    lines.push(`- ${recommendation}`);
  }

  return lines.join('\n');
}

export function formatEvaluationTelegramReport(artifact = {}) {
  const periodDays = Number(artifact.period_days || 0);
  const tradeCount = Number(artifact.trade_count || 0);
  const returnPct = Number(artifact.return_pct || 0);
  const evaluation = artifact.evaluation || {};
  const leader = evaluation.leader;
  const laggard = evaluation.laggard;
  const recommendations = evaluation.recommendations || [];

  const lines = [
    '*UltimateArbitrageHFT weekly self-evaluation*',
    `Period: ${periodDays}d`,
    `Trades: ${tradeCount}`,
    `Return: ${returnPct.toFixed(2)}%`,
  ];

  if (leader) {
    lines.push(`Leader: ${leader.strategy} (score ${leader.score}, trades ${leader.trades}, pnl $${leader.totalPnlUsd.toFixed(2)})`);
  }

  if (laggard && laggard.strategy !== leader?.strategy) {
    lines.push(`Laggard: ${laggard.strategy} (score ${laggard.score}, drawdown ${laggard.maxDrawdownPct.toFixed(2)}%)`);
  }

  if (recommendations.length > 0) {
    lines.push('Recommendations:');
    for (const recommendation of recommendations.slice(0, 3)) {
      lines.push(`- ${recommendation}`);
    }
  }

  return lines.join('\n');
}