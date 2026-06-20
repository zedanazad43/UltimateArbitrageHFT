#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['.git', 'node_modules', '.node_modules', '.wrangler', '.qodo', 'logs', 'oracleJdk-26', 'archive', 'proxy-gateway']);

function shouldSkipDir(name) {
  if (SKIP_DIRS.has(name)) return true;
  if (name.startsWith('backup_')) return true;
  return false;
}

function listJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name)) continue;
      out.push(...listJsFiles(abs));
      continue;
    }
    if (entry.name.endsWith('.js')) out.push(abs);
  }
  return out;
}

const jsFiles = listJsFiles(ROOT);
let failed = false;

for (const file of jsFiles) {
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (check.status !== 0) {
    failed = true;
    console.error(`Syntax check failed: ${path.relative(ROOT, file).replaceAll('\\', '/')}`);
    if (check.stderr) console.error(check.stderr.trim());
  }
}

const landingFile = path.join(ROOT, 'public', 'index.html');
if (fs.existsSync(landingFile)) {
  const html = fs.readFileSync(landingFile, 'utf8');
  if (/\sstyle\s*=\s*['"]/i.test(html)) {
    failed = true;
    console.error('Static check failed: inline style attribute found in public/index.html');
  }
}

if (failed) {
  process.exit(1);
}

console.log('Static checks passed.');
