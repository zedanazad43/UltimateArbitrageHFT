// Auto-generated JS wrapper — re-exports the canonical D1 schema as a string.
// Import this module wherever you need to apply the schema programmatically.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const schemaSQL = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
