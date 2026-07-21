// Hermes Control Brain — full Cloudflare control surface for UltimateArbitrageHFT
const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';

async function cfFetch(env, pathInit, init = {}) {
  const token = String(env.CLOUDFLARE_API_TOKEN || '').trim();
  if (!token) {
    return { ok: false, status: 503, error: 'CLOUDFLARE_API_TOKEN missing' };
  }
  const url = typeof pathInit === 'string' ? `${CLOUDFLARE_API}${pathInit}` : pathInit;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...(init.headers || {}),
  };
  try {
    const resp = await fetch(url, { ...init, headers });
    const text = await resp.text().catch(() => '');
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!resp.ok) {
      const detail = Array.isArray(data.errors) ? data.errors.map((e) => e.message).join(', ') : (data.message || text || 'Cloudflare API error');
      return { ok: false, status: resp.status, error: detail };
    }
    return { ok: true, status: resp.status, data };
  } catch (err) {
    return { ok: false, status: 0, error: err?.message || 'fetch_failed' };
  }
}

async function persist(env, partial) {
  const key = 'hermes_brain_state';
  const current = (await env.BOT_STATE.get(key, 'json').catch(() => null)) || {};
  const next = { ...current, ...partial, updatedAt: new Date().toISOString() };
  await env.BOT_STATE.put(key, JSON.stringify(next));
  return next;
}

async function _isAuthorized(env, c) {
  const expected = String(env.AUTH_SHARED_SECRET || env.HERMES_SHARED_SECRET || '').trim();
  if (!expected) return true;
  const provided = String(c.req.header('x-agent-secret') || '').trim();
  return provided.length > 0 && provided === expected;
}

function _okJson(c, body) {
  return c.json({ ok: true, ...body });
}
function _bad(c, code, msg) {
  return c.json({ ok: false, error: msg }, code !== undefined && code !== null ? code : 400);
}

export async function listZones(env) {
  const r = await cfFetch(env, '/zones?per_page=50');
  const zones = r.ok ? (r.data.result || []).map(z => ({ id: z.id, name: z.name, status: z.status, plan: z.plan?.name })) : [];
  await persist(env, { lastAction: 'listZones', zones });
  return r.ok ? { zones } : r;
}

export async function createDNSRecord(env, zoneId, type, name, content, ttl = 1, proxied = false) {
  const r = await cfFetch(env, `/zones/${zoneId}/dns_records`, {
    method: 'POST',
    body: JSON.stringify({ type, name, content, ttl, proxied }),
  });
  await persist(env, { lastAction: 'createDNSRecord' });
  return r.ok ? { result: r.data.result } : r;
}

export async function updateDNSRecord(env, zoneId, recordId, newContent) {
  const r = await cfFetch(env, `/zones/${zoneId}/dns_records/${recordId}`, {
    method: 'PUT',
    body: JSON.stringify({ content: newContent }),
  });
  await persist(env, { lastAction: 'updateDNSRecord' });
  return r.ok ? { result: r.data.result } : r;
}

export async function deleteDNSRecord(env, zoneId, recordId) {
  const r = await cfFetch(env, `/zones/${zoneId}/dns_records/${recordId}`, { method: 'DELETE' });
  await persist(env, { lastAction: 'deleteDNSRecord' });
  return r.ok ? { result: r.data.result } : r;
}

export async function listDNSRecords(env, zoneId, type, name) {
  const q = new URLSearchParams({ per_page: '100' });
  if (type) q.set('type', type);
  if (name) q.set('name', name);
  const r = await cfFetch(env, `/zones/${zoneId}/dns_records?${q.toString()}`);
  const records = r.ok ? (r.data.result || []) : [];
  await persist(env, { lastAction: 'listDNSRecords' });
  return r.ok ? { records } : r;
}

export async function listWorkers(env) {
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const r = accountId ? await cfFetch(env, `/accounts/${accountId}/workers/scripts`) : { ok: false, error: 'CLOUDFLARE_ACCOUNT_ID missing' };
  const scripts = r.ok ? (r.data.result || []).map(s => s.name) : [];
  await persist(env, { lastAction: 'listWorkers', scripts });
  return r.ok ? { scripts } : r;
}

export async function updateWorker(env, scriptName, source) {
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  if (!accountId) return { ok: false, error: 'CLOUDFLARE_ACCOUNT_ID missing' };
  const r = await cfFetch(env, `/accounts/${accountId}/workers/scripts/${encodeURIComponent(scriptName)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/javascript' },
    body: source,
  });
  await persist(env, { lastAction: 'updateWorker' });
  return r.ok ? { ok: true } : r;
}

export async function listVersions(env, scriptName) {
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  if (!accountId) return { ok: false, error: 'CLOUDFLARE_ACCOUNT_ID missing' };
  const r = await cfFetch(env, `/accounts/${accountId}/workers/scripts/${encodeURIComponent(scriptName)}/versions`);
  const versions = r.ok ? (r.data.result || []) : [];
  return r.ok ? { versions } : r;
}

export async function rollbackWorker(env, scriptName, versionId) {
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  if (!accountId) return { ok: false, error: 'CLOUDFLARE_ACCOUNT_ID missing' };
  const r = await cfFetch(env, `/accounts/${accountId}/workers/scripts/${encodeURIComponent(scriptName)}/versions/${versionId}/rollback`, {
    method: 'POST',
  });
  await persist(env, { lastAction: 'rollbackWorker' });
  return r.ok ? { ok: true } : r;
}

export async function getAnalytics(env, zoneId) {
  const r = await cfFetch(env, `/zones/${zoneId}/analytics/dashboard?since=-6h`);
  await persist(env, { lastAction: 'getAnalytics' });
  return r.ok ? { analytics: r.data.result ?? r.data } : r;
}

export async function listKVNamespaces(env, accountId) {
  const r = await cfFetch(env, `/accounts/${accountId}/storage/kv/namespaces`);
  const namespaces = r.ok ? (r.data.result || []) : [];
  return r.ok ? { namespaces } : r;
}

export async function getKVKeys(env, accountId, namespaceId, prefix) {
  const q = new URLSearchParams({ limit: '100' });
  if (prefix) q.set('prefix', prefix);
  const r = await cfFetch(env, `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/keys/${q.toString()}`);
  const keys = r.ok ? (r.data.result || []) : [];
  return r.ok ? { keys } : r;
}

export async function putKV(env, accountId, namespaceId, key, value, ttl) {
  const r = await cfFetch(env, `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: value,
    headers: { 'Content-Type': 'text/plain' },
    ...(typeof ttl === 'number' && Number.isFinite(ttl) && ttl > 0 ? { 'metadata-TTL': String(Math.floor(ttl)) } : {}),
  });
  await persist(env, { lastAction: 'putKV' });
  return r.ok ? { ok: true } : r;
}

export async function listR2Buckets(env, accountId) {
  const r = await cfFetch(env, `/accounts/${accountId}/r2/buckets`);
  const buckets = r.ok ? (r.data.result || []) : [];
  return r.ok ? { buckets } : r;
}

export async function listR2Objects(env, accountId, bucket, prefix) {
  const q = new URLSearchParams({ limit: '100', delimiter: '/' });
  if (prefix) q.set('prefix', prefix);
  const r = await cfFetch(env, `/accounts/${accountId}/r2/buckets/${bucket}/objects?${q.toString()}`);
  const objects = r.ok ? (r.data.result || []) : [];
  return r.ok ? { objects } : r;
}

export async function listD1Databases(env, accountId) {
  const r = await cfFetch(env, `/accounts/${accountId}/d1/database`);
  const databases = r.ok ? (r.data.result || []) : [];
  return r.ok ? { databases } : r;
}

export async function queryD1(env, accountId, dbId, sql, params = []) {
  const r = await cfFetch(env, `/accounts/${accountId}/d1/database/${dbId}/query`, {
    method: 'POST',
    body: JSON.stringify({ sql, params }),
  });
  const results = r.ok ? (r.data.result || []) : [];
  await persist(env, { lastAction: 'queryD1' });
  return r.ok ? { results } : r;
}

export async function getHermesState(env) {
  return await env.BOT_STATE.get('hermes_brain_state', 'json').catch(() => null) || {};
}

export async function accountInfo(env) {
  const r = await cfFetch(env, '/accounts');
  const accounts = r.ok ? (r.data.result || []) : [];
  return r.ok ? { accounts } : r;
}
