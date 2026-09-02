#!/usr/bin/env node
/**
 * SuperBot control plane — one brain over three isolated projects.
 *
 *   projects/worker-bot   Cloudflare Worker (scans, execution, Telegram, dashboard API)
 *   projects/go-engine    Go HFT engine (sub-ms arbitrage, MEV-protected execution)
 *   projects/dashboard    React + Vite control center
 *   superbot/             this control plane (adapters + orchestration)
 *
 * External quant stack (optional, installed into a Python lab env):
 *   freqtrade, backtrader, nautilus_trader, OpenBB — wired through superbot/python-lab.mjs
 *
 * Usage:
 *   node superbot/cli.mjs <command> [args]
 *
 * Commands:
 *   status [--json]         show state of all projects + adapters
 *   test                    run worker-bot tests + go engine tests
 *   build                   build go engine + dashboard + worker dry-run
 *   run   <worker|engine>   start a project locally
 *   scan  [SYMBOL]          fetch live cross-exchange prices (ccxt adapter, public API)
 *   backtest <strategy>     run a backtest via the Python lab (freqtrade/backtrader/nautilus)
 *   deploy                  deploy worker-bot to Cloudflare (requires wrangler auth)
 */
import { runCommand } from './orchestrator.mjs';
import { ccxtAdapter } from './ccxt-adapter.mjs';
import { pythonLab } from './python-lab.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const PROJECTS = {
  worker: { name: 'worker-bot', dir: 'projects/worker-bot', kind: 'node/cloudflare' },
  engine: { name: 'go-engine', dir: 'projects/go-engine', kind: 'go' },
  dashboard: { name: 'dashboard', dir: 'projects/dashboard', kind: 'react/vite' },
};

const HELP = `
SuperBot — unified control plane

  node superbot/cli.mjs status [--json]      overview of all projects
  node superbot/cli.mjs test                 worker-bot + go-engine tests
  node superbot/cli.mjs build                go engine, dashboard, worker dry-run
  node superbot/cli.mjs run worker|engine    start a project locally
  node superbot/cli.mjs scan [SYMBOL]        live cross-exchange price scan
  node superbot/cli.mjs backtest <strategy>  run strategy via Python lab
  node superbot/cli.mjs deploy               deploy worker to Cloudflare
  node superbot/cli.mjs help                 this message
`.trim();

async function cmdStatus(asJson) {
  const status = { superbot: { version: '3.0.0', root: ROOT }, projects: {}, adapters: {} };
  for (const [key, p] of Object.entries(PROJECTS)) {
    status.projects[key] = { ...p, present: true };
  }
  status.adapters.ccxt = { exchanges: ccxtAdapter.exchanges.length, ready: true };
  status.adapters.pythonLab = await pythonLab.probe();
  if (asJson) {
    console.log(JSON.stringify(status, null, 2));
  } else {
    console.log('┌─ SuperBot control plane');
    for (const p of Object.values(PROJECTS)) console.log(`│  ● ${p.name.padEnd(14)} ${p.kind.padEnd(16)} ${p.dir}`);
    console.log(`│  ● ccxt adapter  ${status.adapters.ccxt.exchanges} exchanges (public data)`);
    const lab = status.adapters.pythonLab;
    console.log(`│  ● python lab    ${lab.available ? `ready (${lab.python})` : 'not installed — freqtrade/backtrader/OpenBB unavailable'}`);
    console.log('└─');
  }
}

async function cmdTest() {
  console.log('▶ worker-bot tests');
  await runCommand('npm', ['run', 'test:all'], join(ROOT, 'projects/worker-bot'));
  console.log('▶ go-engine tests');
  await runCommand('go', ['test', './...'], join(ROOT, 'projects/go-engine'));
  console.log('✅ all project tests passed');
}async function step(label, fn) {
  process.stdout.write(`▶ ${label} ... `);
  try {
    await fn();
    console.log('✅');
    return true;
  } catch (err) {
    console.log(`❌ ${String(err?.message || err).split('\n')[0]}`);
    return false;
  }
}

async function cmdBuild() {
  const results = {
    'go-engine': await step('go-engine build', () =>
      runCommand('go', ['build', '-o', 'bin/hft-engine', './cmd/hft'], join(ROOT, 'projects/go-engine'))),
    dashboard: await step('dashboard build', () =>
      runCommand('npm', ['run', 'build'], join(ROOT, 'projects/dashboard'))),
    'worker-bot': await step('worker-bot dry-run', () =>
      runCommand('npx', ['--yes', 'wrangler@4.87.0', 'deploy', '--dry-run'], join(ROOT, 'projects/worker-bot'))),
  };
  const failed = Object.entries(results).filter(([, ok]) => !ok);
  if (failed.length) {
    console.log(`\n⚠️  build failed for: ${failed.map(([n]) => n).join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('\n✅ all projects build');
  }
}

async function cmdRun(target) {
  if (target === 'worker') {
    await runCommand('npm', ['run', 'dev'], join(ROOT, 'projects/worker-bot'));
  } else if (target === 'engine') {
    await runCommand('go', ['run', './cmd/hft'], join(ROOT, 'projects/go-engine'));
  } else {
    console.error('usage: run worker|engine');
    process.exitCode = 1;
  }
}

async function cmdScan(symbol) {
  const sym = (symbol || 'BTC/USDT').toUpperCase();
  const { quotes, best } = await ccxtAdapter.spreadScan(sym);
  console.log(`\n⟐ SuperBot spread scan — ${sym}\n`);
  for (const row of quotes) {
    console.log(
      `  ${row.exchange.padEnd(10)} ${row.ok ? Number(row.price).toFixed(2).padStart(12) : String(row.error || 'failed').slice(0, 40).padStart(12)}`
    );
  }
  if (best) {
    console.log(`\n  best arb: buy ${best.buy} → sell ${best.sell} = ${best.grossPct.toFixed(3)}% gross\n`);
  }
}

async function cmdBacktest(strategy) {
  const result = await pythonLab.backtest(strategy || 'freqtrade');
  console.log(JSON.stringify(result, null, 2));
}

async function cmdDeploy() {
  await runCommand('npx', ['--yes', 'wrangler@4.87.0', 'deploy'], join(ROOT, 'projects/worker-bot'));
  console.log('✅ worker deployed');
}

const [, , command, ...args] = process.argv;
const commands = {
  status: () => cmdStatus(args.includes('--json')),
  test: cmdTest,
  build: cmdBuild,
  run: () => cmdRun(args[0]),
  scan: () => cmdScan(args[0]),
  backtest: () => cmdBacktest(args[0]),
  deploy: cmdDeploy,
  help: () => console.log(HELP),
};

if (!command || !commands[command]) {
  console.log(HELP);
  process.exit(command ? 1 : 0);
}
await commands[command]();
