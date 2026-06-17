// src/routes/ai-routes.js

const DEFAULT_LLM_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const VALID_EFFORTS = new Set(['none', 'low', 'medium', 'high']);
const EFFORT_MULTIPLIER = { none: 0.25, low: 0.5, medium: 1, high: 2 };

function getConfiguredLlmModel(env) {
  const model = typeof env.LLM_MODEL === 'string' ? env.LLM_MODEL.trim() : '';
  return model || DEFAULT_LLM_MODEL;
}

function trimTrailingSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function resolveAiGatewayChatUrl(env) {
  const explicit = typeof env.AI_GATEWAY_URL === 'string' ? env.AI_GATEWAY_URL.trim() : '';
  if (explicit) {
    const normalized = trimTrailingSlash(explicit);
    if (normalized.endsWith('/chat/completions')) return normalized;
    if (normalized.endsWith('/v1')) return `${normalized}/chat/completions`;
    return `${normalized}/v1/chat/completions`;
  }

  const gatewayId = typeof env.AI_GATEWAY_ID === 'string' ? env.AI_GATEWAY_ID.trim() : '';
  const accountId = typeof env.CLOUDFLARE_ACCOUNT_ID === 'string' ? env.CLOUDFLARE_ACCOUNT_ID.trim() : '';
  if (gatewayId && accountId) {
    return `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/workers-ai/v1/chat/completions`;
  }

  return '';
}

/**
 * Generate a UUID v4 compatible with Cloudflare Workers runtime.
 * Uses crypto.randomUUID() when available (compat date â‰¥ 2022-01-01),
 * otherwise falls back to crypto.getRandomValues().
 */
function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for older Workers compat dates â€“ RFC 4122 v4 using 16 random bytes
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    // Last resort: Math.random (not cryptographically secure, but better than nothing)
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  // Set version (4) and variant (RFC 4122)
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function runConfiguredLlm(env, aiParams) {
  const model = getConfiguredLlmModel(env);
  const gatewayUrl = resolveAiGatewayChatUrl(env);

  if (gatewayUrl) {
    const payload = {
      model,
      messages: aiParams.messages,
      max_tokens: aiParams.max_tokens,
    };
    if (typeof aiParams.temperature === 'number') payload.temperature = aiParams.temperature;
    if (typeof aiParams.top_p === 'number') payload.top_p = aiParams.top_p;

    const headers = { 'Content-Type': 'application/json' };
    if (typeof env.AI_GATEWAY_TOKEN === 'string' && env.AI_GATEWAY_TOKEN.trim()) {
      headers.Authorization = `Bearer ${env.AI_GATEWAY_TOKEN.trim()}`;
    }

    const response = await fetch(gatewayUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    let data = null;
    try {
      data = responseText ? JSON.parse(responseText) : null;
    } catch (_) { /* non-JSON response handled below */ }

    if (!response.ok) {
      const detail = data?.error?.message || data?.error || responseText || `Gateway HTTP ${response.status}`;
      throw new Error(`AI gateway request failed: ${detail}`);
    }

    const text = data?.choices?.[0]?.message?.content
      ?? data?.output_text
      ?? data?.response
      ?? (typeof data === 'string' ? data : JSON.stringify(data));

    const usage = {
      input_tokens: data?.usage?.prompt_tokens ?? 0,
      output_tokens: data?.usage?.completion_tokens ?? 0,
      total_tokens: data?.usage?.total_tokens ?? 0,
    };

    return { model, text, usage, provider: 'ai-gateway' };
  }

  if (!env.AIWORKER) {
    throw new Error('Workers AI binding not configured and AI gateway is not set');
  }

  const result = await env.AIWORKER.run(model, aiParams);
  const text = result?.response ?? result?.text ?? (typeof result === 'string' ? result : JSON.stringify(result));
  const usage = {
    input_tokens: result?.usage?.prompt_tokens ?? 0,
    output_tokens: result?.usage?.completion_tokens ?? 0,
    total_tokens: result?.usage?.total_tokens ?? 0,
  };
  return { model, text, usage, provider: 'workers-ai' };
}

export function registerAiRoutes(app, deps) {
  const { isAuthorized, authDenied } = deps;

  app.get('/api/ai/health', async (c) => {
    if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);

    const model = getConfiguredLlmModel(c.env);
    const gatewayUrl = resolveAiGatewayChatUrl(c.env);

    try {
      const result = await runConfiguredLlm(c.env, {
        messages: [{ role: 'user', content: 'healthcheck' }],
        max_tokens: 8,
        temperature: 0,
      });
      return c.json({
        ok: true,
        provider: result.provider,
        model: result.model,
        gatewayConfigured: !!gatewayUrl,
        preview: String(result.text || '').slice(0, 80),
        usage: result.usage,
      });
    } catch (e) {
      return c.json({
        ok: false,
        provider: gatewayUrl ? 'ai-gateway' : 'workers-ai',
        model,
        gatewayConfigured: !!gatewayUrl,
        gatewayUrl: gatewayUrl || null,
        error: e.message,
      }, 500);
    }
  });

  app.post('/api/ai', async (c) => {
    if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);

    let body;
    try { body = await c.req.json(); } catch (_) { return c.json({ error: 'Invalid JSON' }, 400); }

    if (body.input == null) {
      return c.json({ error: 'Missing required field: input' }, 400);
    }

    const messages = [];
    if (typeof body.instructions === 'string' && body.instructions.trim()) {
      messages.push({ role: 'system', content: body.instructions.trim() });
    }

    if (typeof body.input === 'string') {
      messages.push({ role: 'user', content: body.input });
    } else if (Array.isArray(body.input)) {
      for (const item of body.input) {
        if (item && typeof item === 'object' && typeof item.role === 'string' && item.role && item.content != null) {
          messages.push({ role: item.role, content: item.content });
        } else if (typeof item === 'string') {
          messages.push({ role: 'user', content: item });
        }
        // Silently skip malformed items; they are non-actionable at the API layer
      }
    }

    if (messages.length === 0) {
      return c.json({ error: 'input produced no messages' }, 400);
    }

    const effort = body.reasoning?.effort ?? 'medium';
    if (!VALID_EFFORTS.has(effort)) {
      return c.json({ error: `Invalid reasoning.effort value: "${effort}". Must be one of: none, low, medium, high` }, 400);
    }
    const baseMaxTokens = typeof body.max_output_tokens === 'number' && body.max_output_tokens > 0
      ? body.max_output_tokens
      : 512;
    const max_tokens = Math.round(baseMaxTokens * EFFORT_MULTIPLIER[effort]);

    const aiParams = { messages, max_tokens };
    if (typeof body.temperature === 'number') aiParams.temperature = body.temperature;
    if (typeof body.top_p === 'number') aiParams.top_p = body.top_p;

    const createdAt = Math.floor(Date.now() / 1000);
    const responseId = `resp_${generateUUID().replace(/-/g, '')}`;

    try {
      const ai = await runConfiguredLlm(c.env, aiParams);

      const outputItem = {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: ai.text }],
      };

      return c.json({
        id: responseId,
        object: 'response',
        created_at: createdAt,
        model: ai.model,
        provider: ai.provider,
        output: [outputItem],
        output_text: ai.text,
        status: 'completed',
        usage: ai.usage,
      });
    } catch (e) {
      console.error('[AI /api/ai] run error:', e.message);
      return c.json({
        id: responseId,
        object: 'response',
        created_at: createdAt,
        model: getConfiguredLlmModel(c.env),
        output: [],
        status: 'failed',
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        error: e.message,
      }, 500);
    }
  });

  app.post('/api/ai-analysis', async (c) => {
    if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);

    let body;
    try { body = await c.req.json(); } catch (_) { return c.json({ error: 'Invalid JSON' }, 400); }

    const opp = body.opportunity;
    if (!opp || typeof opp !== 'object') {
      return c.json({ error: 'Missing required field: opportunity' }, 400);
    }

    const MIN_VIABLE_SPREAD_PCT = 0.3;

    const prompt = [
      'You are an expert crypto arbitrage analyst. Analyze the following trading opportunity and provide a concise recommendation (2â€“4 sentences) covering: whether to execute, key risks, and any concerns about liquidity or timing.',
      '',
      'Opportunity:',
      `- Symbol: ${opp.symbol || 'â€”'}`,
      `- Strategy: ${opp.strategy || 'â€”'}`,
      `- Direction: ${opp.direction || 'â€”'}`,
      `- Buy Price: $${opp.buyPrice || 0}`,
      `- Sell Price: $${opp.sellPrice || 0}`,
      `- Net Profit %: ${opp.netPct || 0}%`,
    ].join('\n');

    if (!c.env.AIWORKER && !resolveAiGatewayChatUrl(c.env)) {
      const fallback = opp.netPct > MIN_VIABLE_SPREAD_PCT
        ? `✅ Potential opportunity: net spread of ${opp.netPct}% is above threshold. Verify liquidity and fee structure before executing. Monitor for slippage — position size should remain small (≤$5 for initial trades).`
        : `⚠️ Low spread: net spread of ${opp.netPct}% may not cover execution costs after slippage. Consider waiting for a higher-quality opportunity.`;
      return c.json({ analysis: fallback, provider: 'fallback' });
    }

    try {
      const ai = await runConfiguredLlm(c.env, {
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 256,
      });
      return c.json({ analysis: ai.text, provider: ai.provider, model: ai.model });
    } catch (e) {
      console.error('[AI /api/ai-analysis] error:', e.message);
      return c.json({ error: e.message }, 500);
    }
  });

  app.get('/api/trades', async (c) => {
    if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);

    try {
      const { getRecentTrades } = await import('../db.js');
      const limit = parseInt(c.req.query('limit') || '20', 10);
      const trades = await getRecentTrades(c.env, limit);

      return c.json({
        ok: true,
        data: trades || [],
        count: (trades || []).length,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[/api/trades] error:', err.message);
      return c.json({
        ok: true,
        note: 'Trade history unavailable',
        data: [],
        count: 0,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // ── AI Opportunity Filter — scores and filters opportunities via LLM ──────
  // POST /api/ai/filter — accepts array of opportunities, returns scored + filtered list.
  // Controlled by AI_FILTER_ENABLED env var (default: true). Falls back to
  // heuristic scoring when AI gateway is unavailable or disabled.
  app.post('/api/ai/filter', async (c) => {
    if (!isAuthorized(c.env, c)) return authDenied(c.env, c, true);

    const aiEnabled = String(c.env.AI_FILTER_ENABLED || 'true').toLowerCase() !== 'false';
    const minConfidence = Number(c.env.AI_FILTER_MIN_CONFIDENCE) || 0.7;

    let body;
    try { body = await c.req.json(); } catch (_) { return c.json({ error: 'Invalid JSON' }, 400); }

    const opportunities = Array.isArray(body.opportunities) ? body.opportunities : [];
    if (opportunities.length === 0) {
      return c.json({ success: true, filtered: [], total: 0, passed: 0, mode: 'heuristic' });
    }

    const aiAvailable = !!(c.env.AIWORKER || resolveAiGatewayChatUrl(c.env));

    // Heuristic scoring (always applied as baseline)
    function heuristicScore(opp) {
      let score = 0;
      const netPct = Number(opp.netPct || opp.net_profit_percent || 0);
      const safety = Number(opp.safetyFactor || opp.safety_factor || 0.5);
      const spread = Number(opp.spreadPct || opp.spread_pct || 0);

      if (netPct > 1.0) score += 40;
      else if (netPct > 0.5) score += 25;
      else if (netPct > 0.2) score += 10;

      if (safety > 0.8) score += 30;
      else if (safety > 0.5) score += 15;

      if (spread < 2) score += 20;
      else if (spread < 5) score += 10;

      // Penalize extreme spreads
      if (spread > 15) score -= 20;

      return Math.max(0, Math.min(100, score));
    }

    const scored = opportunities.map(opp => ({
      ...opp,
      heuristicScore: heuristicScore(opp),
      aiScore: null,
      aiRecommendation: null,
    }));

    // If AI is enabled and available, score top candidates via LLM
    if (aiEnabled && aiAvailable && scored.length > 0) {
      const top = scored.sort((a, b) => b.heuristicScore - a.heuristicScore).slice(0, 5);
      const prompt = [
        'You are a crypto arbitrage risk analyst. Score each opportunity below from 0-100 and give a one-word verdict (GO/NOGO).',
        'Consider: net profit %, safety factor, spread %, strategy type, and current market conditions.',
        '',
        ...top.map((o, i) =>
          `#${i + 1}: ${o.symbol || '?'} | ${o.strategy || '?'} | Net: ${o.netPct || 0}% | Safety: ${(o.safetyFactor || 0.5) * 100}% | Spread: ${o.spreadPct || 0}%`
        ),
        '',
        'Respond as JSON array: [{"index":1,"score":85,"verdict":"GO"},...]',
      ].join('\n');

      try {
        const ai = await runConfiguredLlm(c.env, { messages: [{ role: 'user', content: prompt }], max_tokens: 256 });
        const aiText = (ai.text || '').trim();
        // Try to extract JSON array from response
        const jsonMatch = aiText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const aiScores = JSON.parse(jsonMatch[0]);
          for (const item of aiScores) {
            if (item.index >= 1 && item.index <= top.length) {
              top[item.index - 1].aiScore = item.score;
              top[item.index - 1].aiRecommendation = item.verdict;
            }
          }
        }
      } catch (e) {
        console.error('[AI filter] LLM scoring failed:', e.message);
        // Fall through to heuristic-only mode
      }

      // Merge AI scores back into the full list
      for (const t of top) {
        const idx = scored.findIndex(s => s.symbol === t.symbol && s.strategy === t.strategy);
        if (idx >= 0) {
          scored[idx].aiScore = t.aiScore;
          scored[idx].aiRecommendation = t.aiRecommendation;
        }
      }
    }

    const mode = aiEnabled && aiAvailable ? 'ai+heuristic' : 'heuristic';
    const threshold = aiEnabled && aiAvailable ? minConfidence * 100 : 40;
    const finalScore = (opp) => opp.aiScore ?? opp.heuristicScore;
    const filtered = scored
      .filter(opp => finalScore(opp) >= threshold)
      .sort((a, b) => finalScore(b) - finalScore(a));

    return c.json({
      success: true,
      mode,
      aiEnabled,
      aiAvailable,
      threshold,
      total: scored.length,
      passed: filtered.length,
      filtered,
      all: scored,
      generatedAt: new Date().toISOString(),
    });
  });
}

