// src/ai-client.js — AI-powered opportunity filtering using OpenRouter or Workers AI
//
// Preferred path: OpenRouter via OPENROUTER_API_KEY.
// Fallback path: Cloudflare Workers AI via AIWORKER binding.

const AI_TIMEOUT_MS = 8000; // abort if the model backend does not respond within 8 s
const MAX_CANDIDATES = 5;    // send at most this many opportunities to the model
const DEFAULT_OPENROUTER_MODEL = 'openrouter/auto';

// ── Strategy reliability ranking (used in the AI prompt) ──────────────────────
// Higher = more reliable / faster execution. Informational only.
const STRATEGY_RANK = { cex: 1, perps: 2, statistical: 3, triangular: 4, funding: 5, dex: 6 };

// ── LLM input sanitization ────────────────────────────────────────────────────
// Strips control characters and prompt-injection markers from any text that
// enters an LLM prompt via exchange data (symbols, strategy names, etc.).
function sanitizeForLLM(text) {
  if (typeof text !== 'string') return String(text ?? '');
  return text
    // eslint-disable-next-line no-control-regex -- intentionally matches control characters for sanitization
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/<\/?system[^>]*>/gi, '')
    .replace(/(?:ignore|forget|override|disregard)\s+(?:all\s+)?(?:previous|prior|above|your)\s+/gi, '[filtered] ')
    .replace(/(?:instructions?|rules?|prompts?|guidelines?|training)/gi, '[filtered]')
    .replace(/(?:you\s+are\s+(?:now|no\s+longer))/gi, '[filtered]')
    .replace(/(?:act\s+as|pretend\s+(?:you\s+are|to\s+be))/gi, '[filtered]')
    .replace(/from\s+now\s+on/gi, '[filtered]')
    .replace(/\[INST\]|\[SYS\]|<<SYS>><\/SYS>|\[\/INST\]/g, '')
    .replace(/DAN\s|developer\s*mode|jailbreak/gi, '[filtered]')
    .trim();
}

// ── Prompt builders ───────────────────────────────────────────────────────────
function buildSystemPrompt(candidateCount) {
  return (
    'You are a risk analyst for a crypto arbitrage trading system. ' +
    'Given a ranked list of arbitrage opportunities (1=most profitable), ' +
    'select the SINGLE best one considering: ' +
    '(1) safety factor — higher is safer (less slippage/execution risk), ' +
    '(2) net profit percent — higher is better, ' +
    '(3) strategy reliability rank — lower is more reliable (1=CEX, 6=DEX), ' +
    '(4) liquidity — high liquidity assets are safer. ' +
    'Reply with ONLY the opportunity number (1-' + candidateCount + ') and nothing else.'
  );
}

function buildUserPrompt(candidates) {
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
  return `Opportunities:\n${summary}\n\nBest opportunity number:`;
}

function parseChoice(raw, candidateCount) {
  const idx = Number.parseInt(raw, 10);
  if (Number.isFinite(idx) && idx >= 1 && idx <= candidateCount) return idx;
  return null;
}

// ── Backends ──────────────────────────────────────────────────────────────────
async function callOpenRouter(opts, payload) {
  const base = String(opts.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
  const apiKey = String(opts.apiKey || '');
  const model = String(opts.model || DEFAULT_OPENROUTER_MODEL);
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured');

  const resp = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://ecostamp.net',
      'X-Title': 'UltimateArbitrageHFT',
    },
    body: JSON.stringify({
      model,
      messages: payload.messages,
      max_tokens: payload.maxTokens || 4,
      temperature: 0.1,
      top_p: 0.9,
    }),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => 'OpenRouter request failed');
    throw new Error(`OpenRouter HTTP ${resp.status}: ${detail}`);
  }

  const data = await resp.json();
  const raw = (data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? '').trim();
  return raw;
}

async function callWorkersAI(aiWorker, model, payload) {
  if (!aiWorker) throw new Error('AIWORKER binding is not configured');
  const aiPromise = aiWorker.run(model, payload);

  const result = await Promise.race([
    aiPromise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('AI filter timeout')), AI_TIMEOUT_MS)
    ),
  ]);

  const raw = (result?.response ?? result?.text ?? '').trim();
  return raw;
}

// ── Public API ────────────────────────────────────────────────────────────────
export async function filterOpportunityWithAI(env, opportunities) {
  if (!opportunities || opportunities.length === 0) return null;

  const sorted = [...opportunities].sort((a, b) => b.netPct - a.netPct);
  const fallback = sorted[0];
  if (sorted.length === 1) return fallback;

  const candidates = sorted.slice(0, MAX_CANDIDATES);
  const payload = {
    messages: [
      { role: 'system', content: buildSystemPrompt(candidates.length) },
      { role: 'user', content: buildUserPrompt(candidates) },
    ],
    maxTokens: 4,
  };

  const openRouterKey = String(env.OPENROUTER_API_KEY || '').trim();
  const openRouterModel = String(env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL).trim();
  const openRouterBase = String(env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').trim();

  let raw = '';
  let backend = 'none';

  try {
    if (openRouterKey) {
      raw = await callOpenRouter(
        { apiKey: openRouterKey, model: openRouterModel, baseUrl: openRouterBase },
        payload
      );
      backend = 'openrouter';
    } else if (env.AIWORKER) {
      raw = await callWorkersAI(env.AIWORKER, '@cf/meta/llama-3.1-8b-instruct', payload);
      backend = 'cloudflare-workers-ai';
    }
  } catch (e) {
    console.warn(`[AI] ${backend} filterOpportunityWithAI failed, using fallback:`, e.message);
  }

  if (raw) {
    const idx = parseChoice(raw, candidates.length);
    if (idx) {
      const selected = candidates[idx - 1];
      console.log(
        `[AI:${backend}] selected opportunity #${idx}: ` +
        `${selected.strategy} ${selected.symbol} net ${selected.netPct.toFixed(4)}%`
      );
      return selected;
    }

    console.warn(`[AI:${backend}] unexpected response from model, using fallback. raw=`, raw);
  }

  return fallback;
}
