// tests/notifier.test.js — Unit tests for src/bots/notifier.js.
// Run with: node --test tests/notifier.test.js
// Uses only Node.js built-in test runner (node:test) — no extra dependencies.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { notify } from '../src/bots/notifier.js';

// ── Mock fetch helpers ────────────────────────────────────────────────────────

let capturedRequests = [];

function installMockFetch(handler) {
  capturedRequests = [];
  globalThis.fetch = async (url, init) => {
    const req = { url, ...init };
    capturedRequests.push(req);
    return handler(req);
  };
}

function makeOkResponse() {
  return {
    ok: true,
    body: { cancel: async () => {} }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// notify
// ─────────────────────────────────────────────────────────────────────────────

describe('notify', () => {
  test('does nothing and makes no fetch call when TELEGRAM_BOT_TOKEN is missing', async () => {
    let fetchCalled = false;
    globalThis.fetch = async () => { fetchCalled = true; return makeOkResponse(); };

    await notify({ TELEGRAM_CHAT_ID: '123' }, {}, 'hello');
    assert.equal(fetchCalled, false, 'fetch should not be called without a token');
  });

  test('does nothing and makes no fetch call when TELEGRAM_CHAT_ID is missing', async () => {
    let fetchCalled = false;
    globalThis.fetch = async () => { fetchCalled = true; return makeOkResponse(); };

    await notify({ TELEGRAM_BOT_TOKEN: 'tok' }, {}, 'hello');
    assert.equal(fetchCalled, false, 'fetch should not be called without a chat ID');
  });

  test('sends a POST request to the correct Telegram sendMessage endpoint', async () => {
    installMockFetch(() => makeOkResponse());

    await notify(
      { TELEGRAM_BOT_TOKEN: 'mytoken', TELEGRAM_CHAT_ID: '99' },
      {},
      'Test message'
    );

    assert.equal(capturedRequests.length, 1);
    const req = capturedRequests[0];
    assert.equal(req.url, 'https://api.telegram.org/botmytoken/sendMessage');
    assert.equal(req.method, 'POST');
  });

  test('request body includes chat_id, text, and Markdown parse_mode', async () => {
    installMockFetch(() => makeOkResponse());

    await notify(
      { TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_CHAT_ID: 'chat42' },
      {},
      '**Alert** price gap detected'
    );

    const body = JSON.parse(capturedRequests[0].body);
    assert.equal(body.chat_id,    'chat42');
    assert.equal(body.text,       '**Alert** price gap detected');
    assert.equal(body.parse_mode, 'Markdown');
  });

  test('request Content-Type header is application/json', async () => {
    installMockFetch(() => makeOkResponse());

    await notify(
      { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: 'c' },
      {},
      'msg'
    );

    assert.equal(capturedRequests[0].headers['Content-Type'], 'application/json');
  });

  test('does not throw when fetch raises a network error', async () => {
    globalThis.fetch = async () => { throw new Error('network failure'); };

    // Should not propagate the error
    await assert.doesNotReject(
      () => notify(
        { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: 'c' },
        {},
        'msg'
      )
    );
  });

  test('config parameter is accepted but has no effect', async () => {
    installMockFetch(() => makeOkResponse());

    // Passing an arbitrary config object should not break anything
    await notify(
      { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: 'c' },
      { someConfigKey: 'value' },
      'message text'
    );

    assert.equal(capturedRequests.length, 1);
    const body = JSON.parse(capturedRequests[0].body);
    assert.equal(body.text, 'message text');
  });
});
