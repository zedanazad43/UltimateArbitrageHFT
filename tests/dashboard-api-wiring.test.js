import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDashboard } from '../src/dashboard.js';

function createDbMock() {
  return {
    prepare() {
      return {
        bind() {
          return {
            async all() { return { results: [] }; },
            async run() { return {}; },
          };
        },
        async all() { return { results: [] }; },
      };
    },
  };
}

describe('dashboard frontend API wiring', () => {
  test('dashboard HTML wires frontend to protected API endpoints', async () => {
    const env = {
      ADMIN_TOKEN: 'secret-token',
      BOT_STATE: { async get() { return null; } },
      DB: createDbMock(),
    };

    const response = await renderDashboard(env);
    const html = await response.text();

    assert.match(html, /callAdminApi\('\/api\/status'\)/);
    assert.match(html, /callAdminApi\('\/api\/trades\?limit=20'\)/);
    assert.match(html, /callAdminApi\('\/api\/pnl'\)/);
    assert.match(html, /callAdminApi\('\/api\/report'\)/);
    assert.match(html, /href="\/api\/export"/);
    assert.match(html, /callAdminApi\('\/api\/logs'\)/);
  });

  test('dashboard wires AI analysis button to /api/ai-analysis', async () => {
    const env = {
      ADMIN_TOKEN: 'secret-token',
      BOT_STATE: { async get() { return null; } },
      DB: createDbMock(),
    };
    const response = await renderDashboard(env);
    const html = await response.text();
    assert.match(html, /\/api\/ai-analysis/);
  });

  test('dashboard wires bot memory buttons to /api/memory and /api/strategies/self-evaluate', async () => {
    const env = {
      ADMIN_TOKEN: 'secret-token',
      BOT_STATE: { async get() { return null; } },
      DB: createDbMock(),
    };
    const response = await renderDashboard(env);
    const html = await response.text();
    assert.match(html, /\/api\/memory/);
    assert.match(html, /\/api\/strategies\/self-evaluate/);
  });

  test('dashboard includes position_size_usd input field', async () => {
    const env = {
      ADMIN_TOKEN: 'secret-token',
      BOT_STATE: { async get() { return null; } },
      DB: createDbMock(),
    };
    const response = await renderDashboard(env);
    const html = await response.text();
    assert.match(html, /positionSizeUsd/);
    assert.match(html, /position_size_usd/);
  });
});
