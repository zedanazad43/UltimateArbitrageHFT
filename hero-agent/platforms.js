/**
 * hero-agent/platforms.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Connectivity checks for all six Hero platforms.
 * Each function returns { connected: boolean, detail: string }.
 * All checks are designed to be short-circuited (no token → false immediately).
 */

const TIMEOUT_MS = parseInt(process.env.PLATFORM_CHECK_TIMEOUT_MS ?? '7000', 10);

/**
 * Wraps fetch with a timeout and never throws — returns null on network error.
 */
async function safeFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── GitHub ─────────────────────────────────────────────────────────────────────
export async function checkGitHub(env = process.env) {
  const token = env.GITHUB_TOKEN;
  if (!token) return { connected: false, detail: 'GITHUB_TOKEN not set' };

  const res = await safeFetch('https://api.github.com/user', {
    headers: {
      Authorization: 'Bearer ' + token,
      'User-Agent': 'HeroSuperAgent/2.2.0',
      Accept: 'application/vnd.github+json',
    },
  });

  if (!res) return { connected: false, detail: 'Network error or timeout' };
  if (res.status === 401) return { connected: false, detail: 'Invalid or expired GITHUB_TOKEN' };
  if (!res.ok) return { connected: false, detail: `HTTP ${res.status}` };

  const data = await res.json().catch(() => ({}));
  return { connected: true, detail: `Authenticated as ${data.login ?? 'unknown'}` };
}

// ── Cloudflare ────────────────────────────────────────────────────────────────
export async function checkCloudflare(env = process.env) {
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!token) return { connected: false, detail: 'CLOUDFLARE_API_TOKEN not set' };

  const res = await safeFetch('https://api.cloudflare.com/client/v4/user', {
    headers: { Authorization: 'Bearer ' + token },
  });

  if (!res) return { connected: false, detail: 'Network error or timeout' };
  const data = await res.json().catch(() => ({}));
  if (!data.success) {
    const msg = data.errors?.[0]?.message ?? `HTTP ${res.status}`;
    return { connected: false, detail: msg };
  }
  return { connected: true, detail: `Cloudflare user: ${data.result?.email ?? 'ok'}` };
}

// ── Railway ───────────────────────────────────────────────────────────────────
export async function checkRailway(env = process.env) {
  const token = env.RAILWAY_API_TOKEN;
  if (!token) return { connected: false, detail: 'RAILWAY_API_TOKEN not set' };

  const query = `{ me { name email } }`;
  const res = await safeFetch('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });

  if (!res) return { connected: false, detail: 'Network error or timeout' };
  if (res.status === 401) return { connected: false, detail: 'Invalid RAILWAY_API_TOKEN' };
  const data = await res.json().catch(() => ({}));
  if (data.errors?.length) {
    return { connected: false, detail: data.errors[0].message };
  }
  const name = data.data?.me?.name ?? data.data?.me?.email ?? 'ok';
  return { connected: true, detail: `Railway user: ${name}` };
}

// ── Stripe ────────────────────────────────────────────────────────────────────
export async function checkStripe(env = process.env) {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) return { connected: false, detail: 'STRIPE_SECRET_KEY not set' };

  const res = await safeFetch('https://api.stripe.com/v1/account', {
    headers: { Authorization: 'Bearer ' + key },
  });

  if (!res) return { connected: false, detail: 'Network error or timeout' };
  if (res.status === 401) return { connected: false, detail: 'Invalid STRIPE_SECRET_KEY' };
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { connected: false, detail: body.error?.message ?? `HTTP ${res.status}` };
  }
  const data = await res.json().catch(() => ({}));
  return { connected: true, detail: `Stripe account: ${data.id ?? 'ok'}` };
}

// ── Wallet ────────────────────────────────────────────────────────────────────
export async function checkWallet(env = process.env) {
  const address = env.METAMASK_ADDRESS;
  const privateKey = env.METAMASK_PRIVATE_KEY;
  const alchemyEndpoint = env.ALCHEMY_ETHEREUM_ENDPOINT;

  if (!address) return { connected: false, detail: 'METAMASK_ADDRESS not set' };

  // Validate Ethereum address format (0x + 40 hex chars)
  const isValidAddress = /^0x[0-9a-fA-F]{40}$/.test(address);
  if (!isValidAddress) return { connected: false, detail: `Invalid address format: ${address.slice(0, 10)}…` };

  // Validate private key format if present
  if (privateKey && !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    return { connected: false, detail: 'METAMASK_PRIVATE_KEY format invalid (expected 0x + 64 hex chars)' };
  }

  // Optional: probe Alchemy endpoint for liveness
  if (alchemyEndpoint) {
    const res = await safeFetch(alchemyEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
    });
    if (res && res.ok) {
      const data = await res.json().catch(() => ({}));
      const block = data.result ? parseInt(data.result, 16) : null;
      return {
        connected: true,
        detail: `Address ${address.slice(0, 8)}… | block ${block ?? 'n/a'}`,
      };
    }
    return { connected: true, detail: `Address ${address.slice(0, 8)}… (Alchemy unreachable)` };
  }

  return { connected: true, detail: `Address ${address.slice(0, 8)}… (local validation only)` };
}

// ── Manus ─────────────────────────────────────────────────────────────────────
export async function checkManus(env = process.env) {
  const key = env.MANUS_API_KEY;
  if (!key) return { connected: false, detail: 'MANUS_API_KEY not set' };

  const endpoint = (env.MANUS_ENDPOINT ?? 'https://api.manus.ai').replace(/\/$/, '');
  const res = await safeFetch(`${endpoint}/v1/health`, {
    headers: { Authorization: 'Bearer ' + key },
  });

  if (!res) return { connected: false, detail: 'Network error or timeout' };
  if (res.status === 401) return { connected: false, detail: 'Invalid MANUS_API_KEY' };
  if (res.status === 404) {
    // Endpoint path may vary — treat any non-auth response as reachable
    return { connected: true, detail: 'Manus endpoint reachable (no /health route)' };
  }
  if (!res.ok) return { connected: false, detail: `HTTP ${res.status}` };

  return { connected: true, detail: 'Manus API reachable' };
}

// ── All platforms ─────────────────────────────────────────────────────────────
export async function checkAllPlatforms(env = process.env) {
  const [github, cloudflare, railway, stripe, wallet, manus] = await Promise.all([
    checkGitHub(env),
    checkCloudflare(env),
    checkRailway(env),
    checkStripe(env),
    checkWallet(env),
    checkManus(env),
  ]);

  return { github, cloudflare, railway, stripe, wallet, manus };
}
