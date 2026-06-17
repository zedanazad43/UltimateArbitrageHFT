// src/monitor-live.js — 24/7 continuous health monitor
import { CircuitBreaker } from './circuit-breaker.js';

const CHECKS = [
  { name: 'd1', fn: checkD1 }, { name: 'kv', fn: checkKV },
  { name: 'r2', fn: checkR2 }, { name: 'exchanges', fn: checkExchanges },
  { name: 'hft_engine', fn: checkHFTEngine },
];

export async function runLiveMonitor(env) {
  const cb = new CircuitBreaker(env.BOT_STATE);
  const results = [];
  let allOk = true;
  for (const check of CHECKS) {
    try {
      const ok = await check.fn(env);
      results.push({ component: check.name, status: ok ? 'ok' : 'fail' });
      if (!ok) allOk = false;
    } catch (e) {
      results.push({ component: check.name, status: 'error', error: e.message });
      allOk = false;
    }
  }
  if (allOk) { await cb.recordSuccess(); }
  else {
    const failedComponents = results.filter(r => r.status !== 'ok').map(r => r.component);
    const tripped = await cb.recordFailure('Failed: ' + failedComponents.join(', '));
    if (tripped && env.TELEGRAM_BOT_TOKEN) {
      await sendUrgentAlert(env, 'CIRCUIT BREAKER TRIPPED! Failed: ' + failedComponents.join(', ') + ' Trading suspended.');
    }
  }
  const breakerStatus = await cb.getStatus();
  return { timestamp: Date.now(), all_ok: allOk, breaker: breakerStatus, checks: results };
}

async function checkD1(env) {
  if (!env.DB) return false;
  const r = await env.DB.prepare('SELECT 1 AS ok').all();
  return r.results?.[0]?.ok === 1;
}
async function checkKV(env) {
  if (!env.BOT_STATE) return false;
  await env.BOT_STATE.put('__health_check', JSON.stringify({ ts: Date.now() }));
  const val = await env.BOT_STATE.get('__health_check', 'json');
  return val && val.ts > 0;
}
async function checkR2(env) {
  if (!env.TRADE_LOGS) return true;
  try { const objects = await env.TRADE_LOGS.list({ limit: 1 }); return objects !== undefined; }
  catch { return false; }
}
async function checkExchanges(env) {
  try { const mod = await import('./exchange.js'); return mod.getConfiguredExchanges(env).length > 0; }
  catch { return false; }
}
async function checkHFTEngine(env) {
  try { const mod = await import('./hft-client.js'); return await mod.checkHFTEngineHealth(env, 1); }
  catch { return false; }
}
async function sendUrgentAlert(env, message) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try { await fetch('https://api.telegram.org/bot' + token + '/sendMessage', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({chat_id:chatId,text:message}) }); }
  catch (e) { console.error('[Monitor] Alert failed:', e.message); }
}
