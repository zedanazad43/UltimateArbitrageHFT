import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schemaSQL } from '../migrations/schema.js';

const dbModuleUrl = new URL('../src/db.js', import.meta.url).href;
let importNonce = 0;

async function loadDbModule() {
  importNonce += 1;
  return import(`${dbModuleUrl}?case=${importNonce}`);
}

test('ensureSchema executes the full schema via batch of prepared statements', async () => {
  const { ensureSchema } = await loadDbModule();
  const preparedSqls = [];
  let batchArgs = null;

  const env = {
    DB: {
      prepare(sql) {
        preparedSqls.push(sql);
        return { _sql: sql };
      },
      async batch(stmts) {
        batchArgs = stmts;
      }
    }
  };

  await ensureSchema(env);

  // batch() must have been called with an array of prepared statements
  assert.ok(Array.isArray(batchArgs), 'batch() should receive an array');
  assert.ok(batchArgs.length > 0, 'batch array must not be empty');
  // Every statement from schemaSQL (split on ;) must be present
  const expected = schemaSQL.split(';').map(s => s.trim()).filter(s => s.length > 0);
  assert.equal(batchArgs.length, expected.length);
  // The CREATE INDEX statement must be included
  assert.ok(
    preparedSqls.some(s =>    /CREATE INDEX IF NOT EXISTS idx_trades_created_at\s+ON trades\(created_at DESC\)/.test(s)),
    'idx_trades_created_at statement must be batched'
  );
});

test('ensureSchema memoizes initialization per isolate', async () => {
  const { ensureSchema } = await loadDbModule();
  let batchCalls = 0;
  let releaseBatch;
  const batchGate = new Promise(resolve => { releaseBatch = resolve; });

  const env = {
    DB: {
      prepare(sql) { return { _sql: sql }; },
      async batch() {
        batchCalls += 1;
        await batchGate;
      }
    }
  };

  const pending = Promise.all([ensureSchema(env), ensureSchema(env), ensureSchema(env)]);
  assert.equal(batchCalls, 1);
  releaseBatch();
  await pending;
  assert.equal(batchCalls, 1);
});

test('ensureSchema resets memoized promise after failure and allows retry', async (t) => {
  const { ensureSchema } = await loadDbModule();
  let batchCalls = 0;
  const errors = [];
  t.mock.method(console, 'error', (...args) => { errors.push(args.join(' ')); });

  const env = {
    DB: {
      prepare(sql) { return { _sql: sql }; },
      async batch() {
        batchCalls += 1;
        if (batchCalls === 1) throw new Error('schema failed');
      }
    }
  };

  await assert.rejects(async () => ensureSchema(env), /schema failed/);
  await ensureSchema(env);

  assert.equal(batchCalls, 2);
  assert.ok(errors.some(line => line.includes('[DB] ensureSchema error: schema failed')));
});
