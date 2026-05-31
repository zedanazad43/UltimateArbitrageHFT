#!/usr/bin/env node

import dotenv from 'dotenv';

dotenv.config({ path: '.dev.vars', override: false });

const DEFAULT_BASE_URL = 'https://proxy001.com';
const baseUrl = String(process.env.PROXY001_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
const apiKey = process.env.PROXY001_API_KEY || '';

function usage() {
  console.log(`Proxy001 Helper

Usage:
  node scripts/proxy001-helper.js whitelist:list
  node scripts/proxy001-helper.js whitelist:add --ips <ip1,ip2>
  node scripts/proxy001-helper.js whitelist:del --ips <ip1,ip2>

  node scripts/proxy001-helper.js extract --url <full_extract_endpoint> [--num 10] [--regions us] [--protocol http] [--return_type json] [--lb 4] [--sb ',']

  node scripts/proxy001-helper.js to-proxy-list --ips <ip:port,ip:port> [--protocol http] [--username USER] [--password PASS] [--region global] [--priority 10]

Env vars:
  PROXY001_API_KEY          Required for whitelist/extract calls
  PROXY001_BASE_URL         Optional, default: https://proxy001.com
  PROXY001_EXTRACT_URL      Optional fallback endpoint for extract command
  PROXY001_USERNAME         Optional fallback for to-proxy-list
  PROXY001_PASSWORD         Optional fallback for to-proxy-list
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

function assertApiKey() {
  if (!apiKey) {
    throw new Error('PROXY001_API_KEY is required. Set it in .dev.vars or environment.');
  }
}

function normalizeCsv(raw) {
  return String(raw || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

async function callJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 300)}`);
  }
  if (!res.ok || data?.success === false || Number(data?.code || 0) !== 0) {
    throw new Error(`Proxy001 API error (${res.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

async function whitelistList() {
  assertApiKey();
  const url = `${baseUrl}/api/user/white_ip_list?api_key=${encodeURIComponent(apiKey)}`;
  const json = await callJson(url);
  console.log(JSON.stringify(json, null, 2));
}

async function whitelistAdd(ipsRaw) {
  assertApiKey();
  const ips = normalizeCsv(ipsRaw).join(',');
  if (!ips) throw new Error('--ips is required for whitelist:add');
  const url = `${baseUrl}/api/user/add_white_ip?api_key=${encodeURIComponent(apiKey)}&ips=${encodeURIComponent(ips)}`;
  const json = await callJson(url);
  console.log(JSON.stringify(json, null, 2));
}

async function whitelistDel(ipsRaw) {
  assertApiKey();
  const ips = normalizeCsv(ipsRaw).join(',');
  if (!ips) throw new Error('--ips is required for whitelist:del');
  const url = `${baseUrl}/api/user/del_white_ip?api_key=${encodeURIComponent(apiKey)}&ips=${encodeURIComponent(ips)}`;
  const json = await callJson(url);
  console.log(JSON.stringify(json, null, 2));
}

function buildProxyUrl(ip, port, protocol, username, password) {
  const proto = protocol === 'socks5' ? 'socks5' : 'http';
  if (username && password) {
    return `${proto}://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${ip}:${port}`;
  }
  return `${proto}://${ip}:${port}`;
}

function toProxyListJson(rawIps, protocol, username, password, region, priority) {
  const endpoints = normalizeCsv(rawIps).map((entry) => {
    const [ip, port] = entry.split(':');
    if (!ip || !port) {
      throw new Error(`Invalid ip:port entry: ${entry}`);
    }
    return {
      url: buildProxyUrl(ip.trim(), String(port).trim(), protocol, username, password),
      type: protocol === 'socks5' ? 'socks5' : 'http',
      region,
      priority,
    };
  });

  if (endpoints.length === 0) {
    throw new Error('No valid --ips entries provided');
  }

  return endpoints;
}

async function extract(args) {
  assertApiKey();
  const endpoint = args.url || process.env.PROXY001_EXTRACT_URL || '';
  if (!endpoint) {
    throw new Error('extract requires --url or PROXY001_EXTRACT_URL');
  }

  const u = new URL(endpoint);
  const params = u.searchParams;
  params.set('api_key', apiKey);
  if (args.num) params.set('num', String(args.num));
  if (args.regions) params.set('regions', String(args.regions));
  if (args.protocol) params.set('protocol', String(args.protocol));
  if (args.return_type) params.set('return_type', String(args.return_type));
  if (args.lb) params.set('lb', String(args.lb));
  if (args.sb) params.set('sb', String(args.sb));

  const json = await callJson(u.toString());

  // If data arrives as [{ip, port}], print helper PROXY_LIST output as well.
  const rows = Array.isArray(json.data) ? json.data : [];
  if (rows.length > 0 && rows[0].ip && rows[0].port) {
    const ipPairs = rows.map((x) => `${x.ip}:${x.port}`).join(',');
    const protocol = String(args.protocol || 'http').toLowerCase();
    const username = args.username || process.env.PROXY001_USERNAME || '';
    const password = args.password || process.env.PROXY001_PASSWORD || '';
    const region = args.region || 'global';
    const priority = Number.isFinite(Number(args.priority)) ? Number(args.priority) : 10;

    const proxyList = toProxyListJson(ipPairs, protocol, username, password, region, priority);
    console.log(JSON.stringify({
      source: json,
      proxyList,
      nextStep: 'Store proxyList JSON as PROXY_LIST secret (GitHub or Wrangler).',
    }, null, 2));
    return;
  }

  console.log(JSON.stringify(json, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  if (!cmd || cmd === 'help' || cmd === '--help') {
    usage();
    return;
  }

  if (cmd === 'whitelist:list') {
    await whitelistList();
    return;
  }

  if (cmd === 'whitelist:add') {
    await whitelistAdd(args.ips);
    return;
  }

  if (cmd === 'whitelist:del') {
    await whitelistDel(args.ips);
    return;
  }

  if (cmd === 'extract') {
    await extract(args);
    return;
  }

  if (cmd === 'to-proxy-list') {
    const protocol = String(args.protocol || 'http').toLowerCase();
    const username = args.username || process.env.PROXY001_USERNAME || '';
    const password = args.password || process.env.PROXY001_PASSWORD || '';
    const region = args.region || 'global';
    const priority = Number.isFinite(Number(args.priority)) ? Number(args.priority) : 10;
    const proxyList = toProxyListJson(args.ips, protocol, username, password, region, priority);
    console.log(JSON.stringify(proxyList, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${cmd}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
