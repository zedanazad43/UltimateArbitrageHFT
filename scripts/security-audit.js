#!/usr/bin/env node
/**
 * Security audit helper:
 * - Scans repository files for likely hardcoded secrets
 * - Optionally runs npm audit with moderate threshold
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const repoRoot = process.cwd();
const args = new Set(process.argv.slice(2));
const secretsOnly = args.has('--secrets-only');
const withAudit = args.has('--with-audit');

const includeExtensions = new Set(['.js', '.cjs', '.mjs', '.json', '.yaml', '.yml', '.toml', '.env']);
const ignoreDirs = new Set(['node_modules', '.git', '.wrangler', 'backups', 'logs', '.vscode']);
const ignorePathSegments = new Set(['tests']);

const secretPatterns = [
  /(?:ADMIN_TOKEN|API_KEY|SECRET|TOKEN|PASSWORD)\s*[:=]\s*["'][A-Za-z0-9_-]{12,}["']/i,
  /(sk-[A-Za-z0-9]{20,})/,
  /(xox[baprs]-[A-Za-z0-9-]{20,})/,
  /(ghp_[A-Za-z0-9]{20,})/
];

function shouldSkipFile(filePath) {
  const normalized = filePath.split(path.sep);
  if (normalized.some((seg) => ignorePathSegments.has(seg))) return true;
  if (filePath.includes(`${path.sep}backups${path.sep}`)) return true;
  if (filePath.includes(`${path.sep}logs${path.sep}`)) return true;
  return false;
}

function isClearlyMockValue(line) {
  return /secret-token|dummy|mock|example|test-only|sample|alias-secret/i.test(line);
}

function walk(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!ignoreDirs.has(entry.name)) walk(fullPath, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (shouldSkipFile(fullPath)) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!includeExtensions.has(ext)) continue;
    out.push(fullPath);
  }
  return out;
}

function findSecretFindings(files) {
  const findings = [];
  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/process\.env\.|\$\{\{\s*secrets\./i.test(line)) continue;
      if (/example|placeholder|dummy|template/i.test(line)) continue;
      if (isClearlyMockValue(line)) continue;

      for (const pattern of secretPatterns) {
        if (pattern.test(line)) {
          findings.push({
            file: path.relative(repoRoot, file),
            line: i + 1,
            text: line.trim().slice(0, 180)
          });
          break;
        }
      }
    }
  }
  return findings;
}

function runNpmAudit() {
  const result = spawnSync('npm', ['audit', '--audit-level=moderate', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32'
  });

  if (!result.stdout) {
    return { ok: result.status === 0, summary: 'No audit output produced.' };
  }

  try {
    const parsed = JSON.parse(result.stdout);
    const meta = parsed.metadata?.vulnerabilities || {};
    const total = Number(meta.total || 0);
    return {
      ok: total === 0 && result.status === 0,
      summary: `npm audit vulnerabilities => total=${total}, critical=${meta.critical || 0}, high=${meta.high || 0}, moderate=${meta.moderate || 0}, low=${meta.low || 0}`
    };
  } catch {
    return {
      ok: result.status === 0,
      summary: 'npm audit output could not be parsed as JSON.'
    };
  }
}

function main() {
  if (!secretsOnly && !withAudit) {
    console.error('Usage: node scripts/security-audit.js --secrets-only|--with-audit');
    process.exit(2);
  }

  const files = walk(repoRoot);
  const findings = findSecretFindings(files);

  if (findings.length > 0) {
    console.error('Potential hardcoded secrets found:');
    findings.slice(0, 20).forEach((f) => {
      console.error(`- ${f.file}:${f.line} ${f.text}`);
    });
    if (findings.length > 20) {
      console.error(`... and ${findings.length - 20} more findings`);
    }
    process.exit(1);
  }

  console.log('No hardcoded secrets detected in scanned files.');

  if (withAudit) {
    const audit = runNpmAudit();
    console.log(audit.summary);
    if (!audit.ok) process.exit(1);
  }

  process.exit(0);
}

main();
