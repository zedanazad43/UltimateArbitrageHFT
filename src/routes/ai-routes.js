// src/routes/ai-routes.js


const DEFAULT_LLM_MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8-fast';
const FREE_FALLBACK_MODELS = [
  '@cf/meta/llama-3.1-8b-instruct-fp8-fast',
  '@cf/meta/llama-3.1-8b-instruct-fp8-fast',
  '@cf/meta/llama-3.1-8b-instruct-fp8-fast',
  '@cf/meta/llama-4-scout-17b-16e-instruct',
];

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
    } catch (_) {}

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
        gatewayUrl: gatewayUrl || null,
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
        if (item && typeof item === 'object' && typeof item.role === 'string' && item.role && item.content !== undefined) {
          messages.push({ role: item.role, content: item.content });
        } else if (typeof item === 'string') {
          messages.push({ role: 'user', content: item });
        }
      }
    }

    if (messages.length === 0) {
      return c.json({ error: 'input produced no messages' }, 400);
    }

    const _baseMaxTokens = typeof body.max_output_tokens === 'number' && body.max_output_tokens > 0
      ? body.max_output_tokens
      : 512;

    const createdAt = Math.floor(Date.now() / 1000);
    const responseId = `resp_${crypto.randomUUID().replace(/-/g, '')}`;

    const attempts = [
      { model: getConfiguredLlmModel(c.env), label: 'configured' },
    ];
    let ai = { text: '' };
    let lastError = null;
    for (const attempt of attempts) {
      try {
        const result = await runConfiguredLlm(c.env, {
          model: attempt.model,
          messages: typeof body.input === 'string' ? [{ role: 'user', content: body.input }] : [{ role: 'user', content: JSON.stringify(body.input) }],
          max_tokens: typeof body.max_output_tokens === 'number' ? body.max_output_tokens : 256,
        });
        if (result && result.text) { ai = result; lastError = null; break; }
        lastError = new Error(`empty response from ${attempt.label}`);
      } catch (e) {
        lastError = e;
        console.error(`[AI /api/ai] provider=${attempt.label} failed:`, e.message);
      }
    }

    if (!ai.text && lastError && /model .* does not exist|No such model|not found/i.test(lastError.message || '')) {
      ai = {
        text: `[free-provider-failover] Workers AI model unavailable; using fallback for: ${String(body.input || '').slice(0, 64)}`,
        provider: 'free-fallback',
        model: 'free-fallback',
        source: 'free-provider-failover',
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      };
      lastError = null;
    }

    const outputItem = {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: ai.text || '' }],
    };

    const responsePayload = {
      id: responseId,
      object: 'response',
      created_at: createdAt,
      model: ai.model || getConfiguredLlmModel(c.env),
      provider: ai.provider || 'free-fallback',
      routedVia: ai.source || 'free-fallback',
      output: outputItem,
      output_text: ai.text || '',
      status: ai.text ? 'completed' : 'failed',
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    };

    if (lastError) {
      responsePayload.error = lastError.message;
    }

    return c.json(responsePayload);
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
      'You are an expert crypto arbitrage analyst. Analyze the following trading opportunity and provide a concise recommendation (2–4 sentences) covering: whether to execute, key risks, and any concerns about liquidity or timing.',
      '',
      'Opportunity:',
      `- Symbol: ${opp.symbol || '—'}`,
      `- Strategy: ${opp.strategy || '—'}`,
      `- Direction: ${opp.direction || '—'}`,
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
      const { getFailover } = await import('../free-provider-failover.js');
      const failover = getFailover(c.env);
      const ai = await failover.callFreeLLM(prompt, { model: FREE_FALLBACK_MODELS[0] }).catch(() => null);
      const text = ai?.text || '';
      if (!text) {
        const fallback = opp.netPct > MIN_VIABLE_SPREAD_PCT
          ? `✅ Potential opportunity: net spread of ${opp.netPct}% is above threshold. Verify liquidity and fee structure before executing. Monitor for slippage — position size should remain small (≤$5 for initial trades).`
          : `⚠️ Low spread: net spread of ${opp.netPct}% may not cover execution costs after slippage. Consider waiting for a higher-quality opportunity.`;
        return c.json({ analysis: fallback, provider: 'free-fallback', routedVia: ai?.source || 'local-rules' });
      }
      return c.json({ analysis: text, provider: ai.provider || 'free-fallback', model: ai.model, routedVia: ai.source || 'free-fallback' });
    } catch (e) {
      console.error('[AI /api/ai-analysis] free fallback error:', e.message);
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
        data: [],
        count: 0,
        timestamp: new Date().toISOString(),
        note: 'Trade history not available',
      });
    }
  });
}
