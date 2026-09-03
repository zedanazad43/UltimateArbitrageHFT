#!/usr/bin/env node
// scripts/sync-schema.mjs
// Regenerates migrations/schema.js from migrations/schema.sql (single source of truth).
// Run `npm run db:schema:sync` after editing schema.sql. A CI test
// (tests/db-schema-sync.test.js) fails if the two ever drift again.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sqlPath = path.join(workerRoot, 'migrations', 'schema.sql');
const jsPath = path.join(workerRoot, 'migrations', 'schema.js');

const sql = readFileSync(sqlPath, 'utf8');

// Keep the generated JS compact: drop comment/blank lines and collapse
// column-alignment whitespace. Statement boundaries (semicolons) are preserved,
// which is what src/db.js splits on at runtime.
const body = sql
  .split('\n')
  .filter((line) => {
    const t = line.trim();
    return t !== '' && !t.startsWith('--');
  })
  .map((line) => line.trim().replace(/\s{2,}/g, ' '))
  .join('\n')
  .trim();

const generated = `// migrations/schema.js — AUTO-GENERATED from migrations/schema.sql by scripts/sync-schema.mjs.
// Do not edit by hand. Edit migrations/schema.sql and run \`npm run db:schema:sync\`.
export const schemaSQL = \`
${body}
\`;
`;

writeFileSync(jsPath, generated);
console.log('✅ migrations/schema.js regenerated from migrations/schema.sql');