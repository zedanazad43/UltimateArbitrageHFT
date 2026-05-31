#!/usr/bin/env node

import dotenv from 'dotenv';
import { spawnSync } from 'node:child_process';

dotenv.config({ path: '.dev.vars', override: false });

const DEFAULT_REPO = 'zedanazad43/UltimateArbitrageHFT';
const DEFAULT_WORKFLOW = 'Deploy Worker';
const DEFAULT_POLL_MS = 8000;

function usage() {
  console.log(`Proxy001 Sync + Deploy

Usage:
  node scripts/proxy001-sync-deploy.js --extract-url <url> [options]

Required:
  --extract-url <url>            Full Proxy001 extract API URL

Options:
  --repo <owner/repo>            GitHub repository (default: ${DEFAULT_REPO})
  --workflow <name>              Workflow name (default: ${DEFAULT_WORKFLOW})
  --num <n>                      Override extract quantity
  --regions <code>               Override regions (e.g. us,gb,de)
  --protocol <http|socks5>       Proxy protocol (default: http)
  --return_type <json|txt>       API return type (default: json)
  --lb <n>                       Proxy001 separator mode (default: 4)
  --sb <value>                   Custom separator (when lb=6)
  --region <value>               PROXY_LIST region field (default: global)
  --priority <n>                 PROXY_LIST priority field (default: 10)
  --set-secret                   Set GitHub secret PROXY_LIST
  --set-auth-header              Set GitHub secret PROXY_AUTH_HEADER if present in env
  --trigger-deploy               Trigger deploy workflow
  --wait                         Wait for workflow completion
  --poll-ms <ms>                 Poll interval for wait mode (default: 8000)
  --output <path>                Save generated PROXY_LIST JSON to file
  --dry-run                      Do not set secrets or trigger workflow
  --help                         Show this help

Required env vars:
  PROXY001_API_KEY

Optional env vars:
  PROXY001_USERNAME
  PROXY001_PASSWORD
  PROXY_AUTH_HEADER
`);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      out._.push(token);
      continue;
    }
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    out[key] = value;
  }
  return out;
}

function normalizeProtocol(v) {
  const p = String(v || 'http').toLowerCase();
  return p === 'socks5' ? 'socks5' : 'http';
}

function ensureApiKey() {
  const key = process.env.PROXY001_API_KEY || '';
  if (!key) {
    throw new Error('PROXY001_API_KEY is required. Set it in environment or .dev.vars.');
  }
  return key;
}

function buildExtractUrl(args, apiKey) {
  const raw = args['extract-url'] || '';
  if (!raw) throw new Error('--extract-url is required');
  const u = new URL(raw);
  u.searchParams.set('api_key', apiKey);
  if (args.num) u.searchParams.set('num', String(args.num));
  if (args.regions) u.searchParams.set('regions', String(args.regions));
  if (args.protocol) u.searchParams.set('protocol', String(args.protocol));
  if (args.return_type) u.searchParams.set('return_type', String(args.return_type));
  if (args.lb) u.searchParams.set('lb', String(args.lb));
  if (args.sb) u.searchParams.set('sb', String(args.sb));
  return u.toString();
}

async function fetchExtractData(url) {
  const res = await fetch(url);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Proxy001 extract returned non-JSON (${res.status}): ${text.slice(0, 300)}`);
  }
  if (!res.ok || json?.success === false || Number(json?.code || 0) !== 0) {
    throw new Error(`Proxy001 extract failed (${res.status}): ${JSON.stringify(json)}`);
  }
  if (!Array.isArray(json.data) || json.data.length === 0) {
    throw new Error('Proxy001 extract returned no proxy data (data is empty).');
  }
  return json;
}

function buildProxyList(rows, args) {
  const protocol = normalizeProtocol(args.protocol);
  const username = args.username || process.env.PROXY001_USERNAME || '';
  const password = args.password || process.env.PROXY001_PASSWORD || '';
  const region = String(args.region || 'global');
  const priority = Number.isFinite(Number(args.priority)) ? Number(args.priority) : 10;

  return rows.map((row) => {
    const ip = String(row.ip || '').trim();
    const port = String(row.port || '').trim();
    if (!ip || !port) {
      throw new Error(`Invalid extract row: ${JSON.stringify(row)}`);
    }

    const authPart = username && password
      ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
      : '';

    return {
      url: `${protocol}://${authPart}${ip}:${port}`,
      type: protocol,
      region,
      priority,
    };
  });
}

function runGh(args, input = null) {
  const proc = spawnSync('gh', args, {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (proc.status !== 0) {
    const err = (proc.stderr || proc.stdout || '').trim();
    throw new Error(`gh ${args.join(' ')} failed: ${err}`);
  }

  return (proc.stdout || '').trim();
}

function setSecret(repo, name, value) {
  runGh(['secret', 'set', name, '--repo', repo, '--body', value]);
}

function triggerWorkflow(repo, workflow) {
  runGh(['workflow', 'run', workflow, '--repo', repo]);
}

function getLatestRun(repo, workflow) {
  const out = runGh([
    'run', 'list',
    '--repo', repo,
    '--workflow', workflow,
    '--limit', '1',
    '--json', 'databaseId,status,conclusion,url,displayTitle,createdAt'
  ]);

  const arr = JSON.parse(out);
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error('No workflow run found after trigger.');
  }
  return arr[0];
}

async function waitForRun(repo, workflow, pollMs) {
  while (true) {
    const run = getLatestRun(repo, workflow);
    const status = String(run.status || 'unknown');
    const conclusion = String(run.conclusion || '');

    console.log(`[workflow] status=${status} conclusion=${conclusion || '-'} id=${run.databaseId}`);

    if (status === 'completed') {
      if (conclusion !== 'success') {
        throw new Error(`Workflow completed with conclusion=${conclusion || 'unknown'}. URL: ${run.url}`);
      }
      return run;
    }

    await new Promise((resolve) => globalThis.setTimeout(resolve, pollMs));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args._.includes('help')) {
    usage();
    return;
  }

  const apiKey = ensureApiKey();
  const repo = String(args.repo || DEFAULT_REPO);
  const workflow = String(args.workflow || DEFAULT_WORKFLOW);
  const pollMs = Number.isFinite(Number(args['poll-ms'])) ? Number(args['poll-ms']) : DEFAULT_POLL_MS;
  const dryRun = String(args['dry-run'] || 'false') === 'true';

  const extractUrl = buildExtractUrl(args, apiKey);
  console.log(`[extract] requesting proxies from Proxy001`);
  const extract = await fetchExtractData(extractUrl);

  const rows = Array.isArray(extract.data) ? extract.data : [];
  const proxyList = buildProxyList(rows, args);
  const proxyListJson = JSON.stringify(proxyList);

  console.log(`[extract] received ${rows.length} endpoint(s)`);

  if (args.output) {
    const fs = await import('node:fs');
    fs.writeFileSync(String(args.output), JSON.stringify(proxyList, null, 2), 'utf8');
    console.log(`[output] wrote PROXY_LIST JSON -> ${args.output}`);
  }

  if (dryRun) {
    console.log('[dry-run] no secrets updated, no workflow triggered');
    console.log(JSON.stringify({
      repo,
      workflow,
      generatedProxyListCount: proxyList.length,
      firstProxy: proxyList[0]?.url || null,
    }, null, 2));
    return;
  }

  if (String(args['set-secret'] || 'false') === 'true') {
    console.log('[github] setting secret PROXY_LIST');
    setSecret(repo, 'PROXY_LIST', proxyListJson);

    if (String(args['set-auth-header'] || 'false') === 'true' && process.env.PROXY_AUTH_HEADER) {
      console.log('[github] setting secret PROXY_AUTH_HEADER');
      setSecret(repo, 'PROXY_AUTH_HEADER', process.env.PROXY_AUTH_HEADER);
    }
  }

  if (String(args['trigger-deploy'] || 'false') === 'true') {
    console.log(`[github] triggering workflow: ${workflow}`);
    triggerWorkflow(repo, workflow);

    if (String(args.wait || 'false') === 'true') {
      const run = await waitForRun(repo, workflow, pollMs);
      console.log(`[workflow] success: ${run.url}`);
    }
  }

  console.log(JSON.stringify({
    repo,
    workflow,
    generatedProxyListCount: proxyList.length,
    secretUpdated: String(args['set-secret'] || 'false') === 'true',
    deployTriggered: String(args['trigger-deploy'] || 'false') === 'true',
    waited: String(args.wait || 'false') === 'true',
  }, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
