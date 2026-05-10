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
});
