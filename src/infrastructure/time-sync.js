#!/usr/bin/env node
// Infrastructure: Frankfurt/DE-CIX Time Sync + Cloudflare Edge Time Hint
// - Provides best-practice network headers for Worker/server requests.
// - Adds HMAC request signing with local timestamp to detect timejacking.

import { createRequire } from 'node:module';
const nodeRequire = createRequire(import.meta.url);
const crypto = nodeRequire('node:crypto');

const DEFAULT_SHARED_SECRET = process.env.HMAC_SHARED_SECRET || '';

function frankfurtEdgeHeaders(extra = {}) {
  return {
    'CF-Worker': 'nexus-trader',
    'X-Strategy-Location': 'fra',
    'X-Edge-Timestamp': String(Date.now()),
    ...extra
  };
}

function signRequest({ method, url, body, secret = DEFAULT_SHARED_SECRET }) {
  if (!secret) return {};
  const payload = `${method.toUpperCase()} ${url}\n${body ?? ''}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return { 'X-Request-Signature': sig, 'X-Request-Timestamp': String(Date.now()) };
}

function verifyRequestSignature({ method, url, body, signature, timestamp, secret = DEFAULT_SHARED_SECRET, maxAgeMs = 50 }) {
  if (!secret || !signature || !timestamp) return false;
  const age = Date.now() - Number(timestamp);
  if (age < -5000 || age > maxAgeMs) return false; // reject old or future timestamps
  const payload = `${method.toUpperCase()} ${url}\n${body ?? ''}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return signature === expected;
}

export { frankfurtEdgeHeaders, signRequest, verifyRequestSignature };
