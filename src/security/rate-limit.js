export function getClientIp(c) {
  return (
    c?.req?.header?.("cf-connecting-ip") ||
    c?.req?.header?.("x-forwarded-for")?.split(",")[0]?.trim() ||
    c?.req?.header?.("x-real-ip") ||
    "unknown"
  );
}

export function buildRateKey({ prefix = "rl", id = "anon", route = "global", bucket = 0 }) {
  return `${prefix}:${id}:${route}:${bucket}`;
}

/**
 * Fixed-window limiter on KV.
 * opts:
 * - windowSec: number (default 60)
 * - maxReq: number (default 120)
 * - route: string (default "global")
 * - keyId: string (default client IP)
 * - prefix: string (default "rl")
 * - failOpen: boolean (default true)
 */
export async function checkRateLimit(env, c, opts = {}) {
  const windowSec = Number(opts.windowSec ?? 60);
  const maxReq    = Number(opts.maxReq ?? 120);
  const route     = String(opts.route ?? "global");
  const prefix    = String(opts.prefix ?? "rl");
  const failOpen  = opts.failOpen !== false;

  const keyId = String(opts.keyId ?? getClientIp(c));
  const nowSec = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(nowSec / windowSec);
  const resetSec = (bucket + 1) * windowSec;

  const kv = env?.KV_STORAGE || env?.BOT_STATE;
  if (!kv) {
    if (failOpen) {
      return {
        allowed: true,
        remaining: Number.MAX_SAFE_INTEGER,
        reset: resetSec * 1000,
        used: 0,
        key: null,
        reason: "kv_missing_fail_open"
      };
    }
    return {
      allowed: false,
      remaining: 0,
      reset: resetSec * 1000,
      used: 0,
      key: null,
      reason: "kv_missing_fail_closed"
    };
  }

  const key = buildRateKey({ prefix, id: keyId, route, bucket });
  let used = 0;
  try {
    const raw = await kv.get(key);
    used = raw ? (Number(raw) || 0) : 0;
    used += 1;
    await kv.put(key, String(used), { expirationTtl: windowSec + 2 });
  } catch (e) {
    if (failOpen) {
      return {
        allowed: true,
        remaining: Number.MAX_SAFE_INTEGER,
        reset: resetSec * 1000,
        used: 0,
        key,
        reason: "kv_error_fail_open"
      };
    }
    return {
      allowed: false,
      remaining: 0,
      reset: resetSec * 1000,
      used: 0,
      key,
      reason: "kv_error_fail_closed"
    };
  }

  const allowed = used <= maxReq;
  const remaining = Math.max(0, maxReq - used);

  return {
    allowed,
    remaining,
    reset: resetSec * 1000,
    used,
    key,
    reason: "ok"
  };
}

export function applyRateLimitHeaders(c, info, maxReq) {
  try {
    c.header("X-RateLimit-Limit", String(maxReq));
    c.header("X-RateLimit-Remaining", String(info?.remaining ?? 0));
    c.header("X-RateLimit-Reset", String(Math.floor((info?.reset ?? Date.now()) / 1000)));
  } catch {}
}
