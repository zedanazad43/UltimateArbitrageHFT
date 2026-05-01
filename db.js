// Root-level db.js — lightweight helper that applies the canonical D1 schema.
// For full DB helpers (logTrade, getRecentTrades, etc.) see src/db.js.

import { schemaSQL } from './migrations/schema.js';

export async function ensureSchema(db) {
  await db.exec(schemaSQL);
}
