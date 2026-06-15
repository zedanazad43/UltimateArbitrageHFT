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
//    if the model returns an unparsable response, the function falls back to
//    selecting the highest net-profit opportunity unchanged.
//
// Required binding (wrangler.toml):
//   [ai]
//   binding = "AIWORKER"

const AI_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const AI_TIMEOUT_MS = 8000; // abort if Workers AI does not respond within 8 s
const MAX_CANDIDATES = 5;    // send at most this many opportunities to the model

// ── AI Backend Configuration ─────────────────────────────────────────────────
// Set to 'local' to use CodeGeeX server (http://localhost:8000)
// Set to 'cloudflare' to use Cloudflare Workers AI (default)
const AI_BACKEND = process.env.AI_BACKEND || 'cloudflare';
const LOCAL_AI_ENDPOINT = process.env.LOCAL_AI_ENDPOINT || 'http://localhost:8000';
const LOCAL_AI_TIMEOUT_MS = Number(process.env.LOCAL_AI_TIMEOUT_MS || 15000); // Local inference may be much slower on CPU

// ── Strategy reliability ranking (used in the AI prompt) ──────────────────────
// Higher = more reliable / faster execution. Informational only.
const STRATEGY_RANK = { cex: 1, perps: 2, statistical: 3, triangular: 4, funding: 5, dex: 6 };

// ── LLM input sanitization ────────────────────────────────────────────────────
// Strips control characters and prompt-injection markers from any text that
// enters an LLM prompt via exchange data (symbols, strategy names, etc.).
// This prevents attackers from injecting system-override instructions through
// maliciously crafted token names, order book data, or exchange responses.
function sanitizeForLLM(text) {
  if (typeof text !== 'string') return String(text ?? '');
  return text
    // eslint-disable-next-line no-control-regex -- intentionally matches control characters for sanitization
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // strip control chars (keep \t \n)
    .replace(/<\/?system[^>]*>/gi, '')                          // strip <system> tags
    .replace(/(?:ignore|forget|override|disregard)\s+(?:all\s+)?(?:previous|prior|above|your)\s+/gi, '[filtered] ')
    .replace(/(?:instructions?|rules?|prompts?|guidelines?|training)/gi, '[filtered]')
    .replace(/(?:you\s+are\s+(?:now|no\s+longer))/gi, '[filtered]')
    .replace(/(?:act\s+as|pretend\s+(?:you\s+are|to\s+be))/gi, '[filtered]')
    .replace(/from\s+now\s+on/gi, '[filtered]')
    .replace(/\[INST\]|\[SYS\]|<<SYS>>|<\/SYS>|\[\/INST\]/g, '') // strip instruction-tuned markers
    .replace(/DAN\s|developer\s*mode|jailbreak/gi, '[filtered]')
    .trim();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Calls local CodeGeeX server for AI evaluation
 */
async function filterWithLocalAI(opportunities) {
  const sorted = [...opportunities].sort((a, b) => b.netPct - a.netPct);
  const fallback = sorted[0];
  const candidates = sorted.slice(0, MAX_CANDIDATES);

  const summary = candidates
    .map((o, i) => {
      const liquid = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'].includes(o.symbol) ? 'high' : 'med';
      return (
        `${i + 1}. ${sanitizeForLLM(o.strategy.toUpperCase())} ${sanitizeForLLM(o.symbol)} ` +
        `net=${o.netPct.toFixed(3)} safety=${(o.safetyFactor * 100).toFixed(0)}% liq=${liquid}`
      );
    })
    .join('\n');

  const systemPrompt =
    'Pick one arbitrage option. Prefer higher safety, then higher net, then higher liquidity. ' +
    'Reply with ONLY one number between 1 and ' + candidates.length + '.';

  const userPrompt = `Opportunities:\n${summary}\n\nBest opportunity number:`;

  try {
    const response = await Promise.race([
      fetch(`${LOCAL_AI_ENDPOINT}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 2,
          temperature: 0.1,
        }),
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Local AI timeout')), LOCAL_AI_TIMEOUT_MS)
      ),
    ]);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const raw = (data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? '').trim();
    const idx = Number.parseInt(raw, 10);

    if (Number.isFinite(idx) && idx >= 1 && idx <= candidates.length) {
      const selected = candidates[idx - 1];
      console.log(
        `[Local AI] selected opportunity #${idx}: ` +
        `${selected.strategy} ${selected.symbol} net ${selected.netPct.toFixed(4)}%`
      );
      return selected;
    }

    console.warn('[Local AI] unexpected response from model, using fallback. raw=', raw);
  } catch (e) {
    console.warn('[Local AI] filterWithLocalAI failed, using fallback:', e.message);
  }

  return fallback;
}

/**
  * Routes to appropriate AI backend (local CodeGeeX or Cloudflare Workers AI)
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

  // Use local CodeGeeX if configured
  if (AI_BACKEND === 'local') {
    return filterWithLocalAI(opportunities);
  }

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
        `${i + 1}. ${sanitizeForLLM(o.strategy.toUpperCase())} ${sanitizeForLLM(o.symbol)} | ` +
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
        { role: 'user', content: userPrompt },
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
    const idx = Number.parseInt(raw, 10);

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
