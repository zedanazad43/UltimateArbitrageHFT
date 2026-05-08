import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { schemaSQL } from '../migrations/schema.js';

const dbModuleUrl = pathToFileURL('/home/runner/work/UltimateArbitrageHFT/UltimateArbitrageHFT/src/db.js').href;
let importNonce = 0;

async function loadDbModule() {
  importNonce += 1;
  return import(`${dbModuleUrl}?case=${importNonce}`);
}

test('ensureSchema executes the full schema through DB.exec', async () => {
  const { ensureSchema } = await loadDbModule();
  let execInput = null;
  let prepareCalls = 0;

  const env = {
    DB: {
      async exec(sql) {
        execInput = sql;
      },
      prepare() {
        prepareCalls += 1;
        return { run: async () => ({}) };
      }
    }
  };

  await ensureSchema(env);

  assert.equal(execInput, schemaSQL);
  assert.equal(prepareCalls, 0);
  assert.match(execInput, /CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades\(created_at DESC\);/);
});

test('ensureSchema memoizes initialization per isolate', async () => {
  const { ensureSchema } = await loadDbModule();
  let execCalls = 0;
  let releaseExec;
  const execGate = new Promise(resolve => { releaseExec = resolve; });

  const env = {
    DB: {
      async exec() {
        execCalls += 1;
        await execGate;
      }
    }
  };

  const pending = Promise.all([ensureSchema(env), ensureSchema(env), ensureSchema(env)]);
  assert.equal(execCalls, 1);
  releaseExec();
  await pending;
  assert.equal(execCalls, 1);
});

test('ensureSchema resets memoized promise after failure and allows retry', async () => {
  const { ensureSchema } = await loadDbModule();
  let execCalls = 0;
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => { errors.push(args.join(' ')); };

  const env = {
    DB: {
      async exec() {
        execCalls += 1;
        if (execCalls === 1) throw new Error('schema failed');
      }
    }
  };

  try {
    await assert.rejects(() => ensureSchema(env), /schema failed/);
    await ensureSchema(env);
  } finally {
    console.error = originalError;
  }

  assert.equal(execCalls, 2);
  assert.ok(errors.some(line => line.includes('[DB] ensureSchema error: schema failed')));
});
