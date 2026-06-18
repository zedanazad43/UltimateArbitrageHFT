#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const args = new Set(process.argv.slice(2));
const stagedOnly = args.has('--staged');

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.node_modules',
  '.wrangler',
  '.qodo',
  'logs',
  'oracleJdk-26',
  'archive',
  'proxy-gateway',
]);

const SKIP_FILES = new Set([
  'package-lock.json',
  '.dev.vars',
]);

const TEXT_EXTS = new Set([
  '.js', '.mjs', '.cjs', '.json', '.toml', '.yaml', '.yml', '.env', '.txt', '.md', '.ps1', '.sql', '.html'
]);

const PATTERNS = [
  {
    name: 'Cloudflare API token',
    regex: /cfat_[A-Za-z0-9_-]{20,}/g
  },
  {
    name: 'Generic secret assignment',
    regex: /^\s*(?:API_KEY|API_SECRET|SECRET_KEY|TOKEN|PASSPHRASE|PRIVATE_KEY|ADMIN_TOKEN)\s*=\s*([^\s#]+)/g
  },
  {
    name: 'Private key block',
    regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g
  },
  {
    name: 'GitHub token',
    regex: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g
  }
];

function isPlaceholder(value) {
  if (!value) return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed === '""' || trimmed === "''") return true;
  if (trimmed.toUpperCase().startsWith('YOUR_')) return true;
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) return true;
  if (trimmed.includes('example') || trimmed.includes('EXAMPLE')) return true;
  if (trimmed.startsWith('${') || trimmed.startsWith('$(')) return true;
  if (trimmed === 'null' || trimmed === 'undefined') return true;
  return false;
}

function shouldScanFile(filePath) {
  const rel = path.relative(ROOT, filePath);
  if (!rel || rel.startsWith('..')) return false;
  const parts = rel.split(path.sep);
  if (parts.some((p) => SKIP_DIRS.has(p) || /^backup_/.test(p))) return false;
  if (SKIP_FILES.has(path.basename(rel))) return false;
  const ext = path.extname(rel).toLowerCase();
  if (TEXT_EXTS.has(ext)) return true;
  if (path.basename(rel).startsWith('.env')) return true;
  return false;
}

function listFilesRecursive(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...listFilesRecursive(abs));
      continue;
    }
    if (shouldScanFile(abs)) out.push(abs);
  }
  return out;
}

function getStagedFiles() {
  const res = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  if (res.status !== 0) {
    console.error('Failed to read staged files. Is git available?');
    process.exit(2);
  }
  return res.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((rel) => path.resolve(ROOT, rel))
    .filter((abs) => fs.existsSync(abs) && shouldScanFile(abs));
}

function scanFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const findings = [];
  const rel = path.relative(ROOT, filePath).replaceAll('\\', '/');
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.includes('secrets scanning: allow')) continue;

    for (const p of PATTERNS) {
      p.regex.lastIndex = 0;
      let match;
      while ((match = p.regex.exec(line)) !== null) {
        if (p.name === 'Generic secret assignment') {
          const val = (match[1] || '').replace(/["']/g, '');
          if (isPlaceholder(val)) continue;
          if (val.length < 8) continue;
        }
        findings.push({
          file: rel,
          line: i + 1,
          type: p.name,
          snippet: line.trim().slice(0, 200)
        });
      }
    }
  }

  return findings;
}

const files = stagedOnly ? getStagedFiles() : listFilesRecursive(ROOT);
const findings = files.flatMap(scanFile);

if (findings.length === 0) {
  console.log(`Secret scan passed (${stagedOnly ? 'staged files' : 'workspace'}).`);
  process.exit(0);
}

console.error('Secret scan failed. Potential sensitive values found:');
for (const f of findings) {
  console.error(`- ${f.file}:${f.line} [${f.type}] ${f.snippet}`);
}
console.error('\nIf this is a false positive, replace with placeholders or add a clear safe marker comment.');
process.exit(1);
