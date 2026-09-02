// src/sdk-bridge.js
// Unified SDK bridge over Cloudflare runtime + GitHub Copilot SDK
import { createRequire } from 'node:module';
const nodeRequire = createRequire(import.meta.url);
export default class SDKBridge {
  constructor(bindings = {}) {
    this.bindings = bindings;
    let imported;
    try {
      imported = nodeRequire('@github/copilot-sdk');
      if (imported) this.copilot = imported;
    } catch {
      imported = null;
    }
    this.copilot = imported;
    this._session = null;
  }

  static instance(bindings = {}) {
    return new SDKBridge(bindings);
  }

  _kv(_key) {
    return this.bindings?.BOT_STATE || this.bindings?.KV_STORAGE;
  }

  _d1() {
    return this.bindings?.DB || this.bindings?.MY_D1;
  }

  async copilotSession({ command = 'gh copilot', env = {}, toolSets } = {}) {
    if (!this.copilot) throw new Error('Copilot SDK is not available');
    const { createSession, toolSet } = this.copilot;
    if (this._session) return this._session;
    const create = toolSets?.length
      ? createSession({ command, env, toolSets: [toolSet(toolSets)] })
      : createSession({ command, env });
    this._session = await create;
    return this._session;
  }

  async askCopilot(prompt, options = {}) {
    const session = await this.copilotSession(options);
    const response = await session.handlePrompt({ prompt });
    const text = response?.response?.text ?? response?.content ?? null;
    return { text, finishReason: response?.finishReason ?? null };
  }

  async sendTelegram(text) {
    const token = this.bindings?.TELEGRAM_BOT_TOKEN;
    const chatId = this.bindings?.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return { ok: false, error: 'Missing TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID' };
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    });
    if (!res.ok) return { ok: false, status: res.status, error: await res.text().catch(() => 'telegram_failed') };
    return { ok: true };
  }

  async kvGet(key) {
    const store = this._kv(key);
    if (!store) return undefined;
    return store.get(key, 'text');
  }

  async kvPut(key, value, { expirationTtl, metadata } = {}) {
    const store = this._kv(key);
    if (!store) throw new Error('KV binding BOT_STATE/KV_STORAGE missing');
    if (metadata || expirationTtl) {
      return store.put(key, value, { expirationTtl, metadata });
    }
    return store.put(key, value);
  }

  async d1Run(sql, params = [], { binding } = {}) {
    const db = binding || this._d1();
    if (!db) throw new Error('D1 binding DB/MY_D1 missing');
    const stmt = db.prepare(sql);
    if (Array.isArray(params) && params.length) stmt.bind(...params);
    return stmt.all();
  }

  async aiChat(prompt, { model } = {}) {
    const modelId = model || this.bindings?.CF_AI_MODEL || 'llama-3.1-8b-instruct';
    try {
      const result = await this.bindings?.AIWORKER?.chat(modelId, [
        { role: 'user', content: prompt },
      ]);
      return { ok: true, text: JSON.stringify(result) };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }
}
