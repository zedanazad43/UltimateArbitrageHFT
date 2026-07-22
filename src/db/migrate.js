export async function runMigrations(env) {
  if (!env.DB) return;
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS exchange_health (
      exchange TEXT PRIMARY KEY,
      status TEXT DEFAULT 'unknown',
      latency_ms INTEGER,
      last_check TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run().catch(() => null);
}
