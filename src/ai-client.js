// src/ai-client.js — AI-powered opportunity filtering using Workers AI
//
// Uses the AIWORKER binding (Cloudflare Workers AI, model: llama-3.1-8b-instruct)
// to evaluate and rank arbitrage opportunities before they reach the execution
// layer, filtering out signals that look suspicious or low-quality.
//
// Design:
//  - Presents up to 5 opportunities to the model in a compact text format.
//  - Asks the model to return ONLY the 1-based index of the best opportunity.
//  - Degrades gracefully: if AIWORKER is absent, if the AI call times out, or
//    if the model returns an unparseable response, the function falls back to
//    selecting the highest net-profit opportunity unchanged.
//
// Required binding (wrangler.toml):
//   [ai]
//   binding = "AIWORKER"

const AI_MODEL      = '@cf/meta/llama-3.1-8b-instruct';
const AI_TIMEOUT_MS = 8000; // abort if Workers AI does not respond within 8 s
const MAX_CANDIDATES = 5;    // send at most this many opportunities to the model

// ── Strategy reliability ranking (used in the AI prompt) ──────────────────────
// Higher = more reliable / faster execution. Informational only.
const STRATEGY_RANK = { cex: 1, perps: 2, statistical: 3, triangular: 4, funding: 5, dex: 6 };

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Uses Workers AI to select the single best opportunity from the provided list.
 *
 * The AI evaluates: safety factor (slippage guard), net profit %, strategy
 * reliability, and asset liquidity (BTC/ETH > altcoins).
 *
 * @param {object}   env           — Cloudflare Worker env bindings (AIWORKER needed)
 * @param {object[]} opportunities — Array of OpportunityObjects from the orchestrator
 * @returns {Promise<object|null>} The AI-selected opportunity, or null if list is empty
 */
export async function filterOpportunityWithAI(env, opportunities) {
  if (!opportunities || opportunities.length === 0) return null;

  // Sort by netPct descending so the top candidates are always the most profitable
  const sorted = [...opportunities].sort((a, b) => b.netPct - a.netPct);

  // Fallback: best by net profit (no AI involved)
  const fallback = sorted[0];

  // If only one opportunity, or AIWORKER is not configured, skip AI
  if (sorted.length === 1 || !env.AIWORKER) return fallback;

  const candidates = sorted.slice(0, MAX_CANDIDATES);

  // Build a compact, token-efficient summary for the model
  const summary = candidates
    .map((o, i) => {
      const rank = STRATEGY_RANK[o.strategy] ?? 9;
      const liquid = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'].includes(o.symbol) ? 'high' : 'medium';
      return (
        `${i + 1}. ${o.strategy.toUpperCase()} ${o.symbol} | ` +
        `net=${o.netPct.toFixed(4)}% gross=${o.grossPct.toFixed(4)}% ` +
        `safety=${(o.safetyFactor * 100).toFixed(1)}% ` +
        `stratRank=${rank} liquidity=${liquid}`
      );
    })
    .join('\n');

  const systemPrompt =
    'You are a risk analyst for a crypto arbitrage trading system. ' +
    'Given a ranked list of arbitrage opportunities (1=most profitable), ' +
    'select the SINGLE best one considering: ' +
    '(1) safety factor — higher is safer (less slippage/execution risk), ' +
    '(2) net profit percent — higher is better, ' +
    '(3) strategy reliability rank — lower is more reliable (1=CEX, 6=DEX), ' +
    '(4) liquidity — high liquidity assets are safer. ' +
    'Reply with ONLY the opportunity number (1-' + candidates.length + ') and nothing else.';

  const userPrompt = `Opportunities:\n${summary}\n\nBest opportunity number:`;

  try {
    const aiPromise = env.AIWORKER.run(AI_MODEL, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      max_tokens: 4,
    });

    const result = await Promise.race([
      aiPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('AI filter timeout')), AI_TIMEOUT_MS)
      ),
    ]);

    const raw = (result?.response ?? result?.text ?? '').trim();
    const idx = parseInt(raw, 10);

    if (Number.isFinite(idx) && idx >= 1 && idx <= candidates.length) {
      const selected = candidates[idx - 1];
      console.log(
        `[AI] selected opportunity #${idx}: ` +
        `${selected.strategy} ${selected.symbol} net ${selected.netPct.toFixed(4)}%`
      );
      return selected;
    }

    console.warn('[AI] unexpected response from model, using fallback. raw=', raw);
  } catch (e) {
    console.warn('[AI] filterOpportunityWithAI failed, using fallback:', e.message);
  }

  return fallback;
}
