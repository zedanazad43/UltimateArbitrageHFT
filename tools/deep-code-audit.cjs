const fs = require('fs');
const path = require('path');

const TARGET = 'C:/Users/azadz/OneDrive/UltimateArbitrageHFT';
const FILES = [
  'index.js',
  'src/exchange.js',
  'src/infra/proxy-pool.js',
  'src/infra/external-proxy.js'
];

function auditFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const issues = [];
  const base = path.basename(filePath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ln = i + 1;

    // 1. Hardcoded secrets patterns
    if (/api[_-]?key|secret|token|password/i.test(line) && /['"][a-zA-Z0-9]{20,}['"]/.test(line) && !/env\.|process\.env/.test(line)) {
      issues.push({ file: base, line: ln, severity: 'HIGH', type: 'Hardcoded secret', text: line.trim().slice(0, 100) });
    }

    // 2. HTTP instead of HTTPS (internal fetches to exchanges)
    if (/fetch\(|axios\.|request\(|https?:\/\//i.test(line) && /http:\/\//i.test(line) && !/localhost|127\.0\.0\.1/.test(line)) {
      issues.push({ file: base, line: ln, severity: 'MEDIUM', type: 'Plain HTTP', text: line.trim().slice(0, 100) });
    }

    // 3. Missing error handling on async
    if (/await\s+fetch\(/.test(line) && !/try\s*\{/.test(lines[Math.max(0, i - 2)])) {
      issues.push({ file: base, line: ln, severity: 'MEDIUM', type: 'Missing try/catch near async fetch', text: line.trim().slice(0, 100) });
    }

    // 4. eval / Function constructor
    if (/\beval\(|\bFunction\(/.test(line)) {
      issues.push({ file: base, line: ln, severity: 'HIGH', type: 'eval/Function', text: line.trim().slice(0, 100) });
    }

    // 5. Insecure CORS wildcard
    if (/Access-Control-Allow-Origin.*\*/.test(line)) {
      issues.push({ file: base, line: ln, severity: 'MEDIUM', type: 'Wildcard CORS', text: line.trim().slice(0, 100) });
    }
  }

  return issues;
}

(async () => {
  console.log('=== Deep Code Audit ===');
  let total = 0;
  for (const f of FILES) {
    const full = path.join(TARGET, f);
    if (!fs.existsSync(full)) { console.log('MISSING ' + f); continue; }
    const issues = auditFile(full);
    total += issues.length;
    for (const iss of issues) {
      console.log(`[${iss.severity}] ${iss.file}:${iss.line} ${iss.type} => ${iss.text}`);
    }
  }
  console.log('=== Total issues: ' + total + ' ===');
})();
