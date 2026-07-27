/**
 * hero-super-agent — Cloudflare Worker AI Gateway
 *
 * Exposes an OpenAI-compatible /v1/chat/completions endpoint backed by
 * Cloudflare Workers AI, so Hermes / Merlin / Omni / Manus can use it
 * as a free-tier inference backend via:
 *   base_url = https://hero-super-agent.<account>.workers.dev/v1
 *   api_key  = (WORKER_AUTH_TOKEN secret)
 *
 * Bindings required in wrangler.toml:
 *   [ai]  binding = "AI"
 *
 * Optional env vars (wrangler secret put):
 *   WORKER_AUTH_TOKEN   — bearer token to gate access (optional)
 *   DEFAULT_CF_MODEL    — override default model (optional)
 */

/* global WORKER_BACKEND */
const API_BASE = (typeof WORKER_BACKEND !== "undefined" && WORKER_BACKEND) || "http://localhost:3001";
const DEFAULT_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Authenticate (if token configured)
    if (env.WORKER_AUTH_TOKEN) {
      const auth = request.headers.get("Authorization") ?? "";
      const token = auth.replace(/^Bearer\s+/i, "");
      if (token !== env.WORKER_AUTH_TOKEN) {
        return json({ error: "unauthorized" }, 401);
      }
    }

    // ── OpenAI-compatible chat completions ────────────────────────────
    if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
      return handleChatCompletions(request, env);
    }

    // ── Models list ───────────────────────────────────────────────────
    if (request.method === "GET" && url.pathname === "/v1/models") {
      return handleModelsList();
    }

    // ── Health / metadata ─────────────────────────────────────────────
    if (url.pathname === "/" || url.pathname === "/api/agent") {
      return json({
        name: "Hero Super Agent (Cloudflare Workers AI)",
        version: "2.0.0",
        endpoints: ["/v1/chat/completions", "/v1/models"],
        free_models: [
          "@cf/meta/llama-3.1-8b-instruct",
          "@cf/mistral/mistral-7b-instruct-v0.2",
          "@cf/google/gemma-2b-it-lora",
        ],
      });
    }

    // ── Proxy fallback ────────────────────────────────────────────────
    const proxied = new Request(API_BASE + url.pathname + url.search, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
    const resp = await fetch(proxied);
    return resp;
  },
};

// ─── Handlers ────────────────────────────────────────────────────────────────

async function handleChatCompletions(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const model = body.model || env.DEFAULT_CF_MODEL || DEFAULT_MODEL;
  const messages = body.messages;

  if (!Array.isArray(messages) || messages.length === 0) {
    return json({ error: "messages array is required" }, 400);
  }

  // Build prompt from messages (system + user turns)
  const prompt = messages
    .map((m) => {
      if (m.role === "system") return `[System]: ${m.content}`;
      if (m.role === "assistant") return `[Assistant]: ${m.content}`;
      return `[User]: ${m.content}`;
    })
    .join("\n");

  let cfResponse;
  try {
    cfResponse = await env.AI.run(model, {
      messages,
      max_tokens: body.max_tokens ?? 2048,
      temperature: body.temperature ?? 0.7,
    });
  } catch (err) {
    // Fallback: try with simple prompt format
    try {
      cfResponse = await env.AI.run(model, { prompt, max_tokens: body.max_tokens ?? 2048 });
    } catch (err2) {
      return json({ error: `Workers AI error: ${err2.message}` }, 502);
    }
  }

  // Normalize to OpenAI response shape
  const content =
    cfResponse?.response ?? cfResponse?.result?.response ?? cfResponse?.generated_text ?? "";

  return json({
    id: `chatcmpl-cf-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
}

function handleModelsList() {
  const models = [
    "@cf/meta/llama-3.1-8b-instruct",
    "@cf/mistral/mistral-7b-instruct-v0.2",
    "@cf/google/gemma-2b-it-lora",
    "@cf/qwen/qwen1.5-7b-chat-awq",
    "@cf/deepseek-ai/deepseek-math-7b-base",
  ];
  return json({
    object: "list",
    data: models.map((id) => ({ id, object: "model", owned_by: "cloudflare" })),
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
