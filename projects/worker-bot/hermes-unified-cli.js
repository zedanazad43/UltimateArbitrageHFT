#!/usr/bin/env node
// Unified, paper-safe command line interface for configured AI providers.

import { UnifiedRouter, PROVIDER_CONFIG, MODEL_ALIASES } from './src/ai-integration/hermes-unified-router.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONFIG_PATH = process.env.HERMES_UNIFIED_CONFIG_PATH || join(__dirname, '.hermes-unified-config.json');
const DEFAULT_CONFIG = Object.freeze({
  defaultProvider: 'auto',
  paperMode: true,
  budgetLimit: 0,
  latencyRequirement: 'medium',
  modelAliases: MODEL_ALIASES,
});

function saveConfig(config) {
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    const config = { ...DEFAULT_CONFIG };
    saveConfig(config);
    return config;
  }

  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    return { ...DEFAULT_CONFIG, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch (error) {
    console.error(`Warning: invalid Hermes config at ${CONFIG_PATH}; using safe defaults (${error.message})`);
    return { ...DEFAULT_CONFIG };
  }
}

const config = loadConfig();
const env = {
  AIWORKER: globalThis.AIWORKER,
  HERMES_API_URL: process.env.HERMES_API_URL,
  HERMES_API_KEY: process.env.HERMES_API_KEY,
  COPILOT_API_URL: process.env.COPILOT_API_URL,
  CODECOPILOT_TOKEN: process.env.CODECOPILOT_TOKEN || process.env.GITHUB_TOKEN,
  OMNIROUTE_GATEWAY_URL: process.env.OMNIROUTE_GATEWAY_URL || process.env.LOCAL_GATEWAY_URL,
  OMNIROUTE_API_KEY: process.env.OMNIROUTE_API_KEY,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
};
const router = new UnifiedRouter(env, { paper_trading: config.paperMode !== false });

function parseRouteArgs(args) {
  const promptParts = [];
  const options = {
    paperMode: config.paperMode !== false,
    latencyRequirement: config.latencyRequirement,
    budgetLimit: config.budgetLimit,
  };

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--provider') {
      const provider = args[++index];
      if (!provider) throw new Error('--provider requires a provider name');
      options.preferredProvider = provider;
    } else if (value === '--model') {
      const model = args[++index];
      if (!model) throw new Error('--model requires a model name or alias');
      options.modelHint = router.resolveModelAlias(model);
    } else if (value === '--budget') {
      const budget = Number(args[++index]);
      if (!Number.isFinite(budget) || budget < 0) throw new Error('--budget must be a non-negative number');
      options.budgetLimit = budget;
    } else if (value === '--live') {
      options.paperMode = false;
    } else if (value.startsWith('--')) {
      throw new Error(`Unknown option: ${value}`);
    } else {
      promptParts.push(value);
    }
  }

  if (!options.preferredProvider && config.defaultProvider && config.defaultProvider !== 'auto') {
    options.preferredProvider = config.defaultProvider;
  }
  return { prompt: promptParts.join(' ').trim(), options };
}

async function cmdStatus() {
  console.log('\n=== Hermes Unified Router Status ===\n');
  const statuses = await router.getAllProviderStatuses();
  for (const [provider, status] of Object.entries(statuses)) {
    const metadata = PROVIDER_CONFIG[provider];
    const icon = status.healthy ? '✅' : status.configured ? '⚠️' : '❌';
    console.log(`${icon} ${provider.padEnd(12)} [${metadata.type}] models: ${metadata.models.length}, cost: ${metadata.cost}, latency: ${metadata.latency}`);
    if (status.error) console.log(`   ${status.error}`);
  }
  console.log('\nStatus checks are local configuration checks; no provider request was made.\n');
}

async function cmdRoute(args) {
  const { prompt, options } = parseRouteArgs(args);
  if (!prompt) throw new Error('Usage: hermes route <prompt> [--provider <name>] [--model <alias>] [--budget <usd>] [--live]');

  console.log(`\nRouting: "${prompt.slice(0, 80)}${prompt.length > 80 ? '…' : ''}"`);
  console.log(`Mode: ${options.paperMode ? 'paper' : 'live'}`);
  console.log(`Budget limit: $${options.budgetLimit}`);

  const result = await router.routeLLMCall([{ role: 'user', content: prompt }], options);
  console.log(`\nProvider: ${result.routedVia}`);
  console.log(`Model: ${result.model}`);
  console.log(`Reason: ${result.route?.reason || 'auto'}`);
  console.log(`\nResponse:\n${result.text}\n`);
}

function cmdListModels() {
  console.log('\n=== Configured Model Defaults ===\n');
  for (const [provider, metadata] of Object.entries(PROVIDER_CONFIG)) {
    console.log(`\n${provider.toUpperCase()}:`);
    for (const model of metadata.models) {
      const alias = Object.entries(MODEL_ALIASES).find(([, value]) => value === model)?.[0];
      console.log(`  • ${model}${alias ? ` (${alias})` : ''}`);
    }
  }
  console.log('\nUse a live provider catalog to select a production model; these defaults are compatibility fallbacks.\n');
}

function cmdSwitch(args) {
  const [key, value] = args;
  if (!key || value === undefined) throw new Error('Usage: hermes switch <defaultProvider|paperMode|budgetLimit|latencyRequirement> <value>');

  if (key === 'paperMode') {
    if (!['true', 'false', '1', '0'].includes(value)) throw new Error('paperMode must be true or false');
    config.paperMode = value === 'true' || value === '1';
  } else if (key === 'budgetLimit') {
    const budget = Number(value);
    if (!Number.isFinite(budget) || budget < 0) throw new Error('budgetLimit must be a non-negative number');
    config.budgetLimit = budget;
  } else if (key === 'latencyRequirement') {
    if (!['low', 'medium', 'high'].includes(value)) throw new Error('latencyRequirement must be low, medium, or high');
    config.latencyRequirement = value;
  } else if (key === 'defaultProvider') {
    if (value !== 'auto' && !PROVIDER_CONFIG[value]) throw new Error(`Unknown provider: ${value}`);
    config.defaultProvider = value;
  } else {
    throw new Error(`Unsupported setting: ${key}`);
  }

  saveConfig(config);
  console.log(`Updated ${key} = ${value}`);
}

function cmdConfig() {
  console.log('\n=== Current Configuration ===\n');
  console.log(JSON.stringify(config, null, 2));
  console.log('');
}

function cmdHelp() {
  console.log(`
=== Hermes Unified Router CLI ===

Usage: node hermes-unified-cli.js <command> [options]

Commands:
  status              Show local provider configuration status
  route <prompt>      Select a provider (paper mode by default)
  list-models         Show compatibility model defaults
  switch <key> <val>  Update a local CLI setting
  config              Show current local CLI configuration
  help                Show this help

Route options:
  --provider <name>   Force hermes, copilot, omniroute, or openrouter
  --model <alias>     Use a model alias or explicit model ID
  --budget <usd>      Set a non-negative routing budget
  --live              Allow a configured provider request (disabled by default)

Examples:
  node hermes-unified-cli.js status
  node hermes-unified-cli.js route "analyze this arbitrage opportunity"
  node hermes-unified-cli.js route "review this code" --provider openrouter --model or-gpt-mini
  node hermes-unified-cli.js switch defaultProvider auto
`);
}

async function main() {
  const [, , command = 'help', ...args] = process.argv;
  switch (command) {
    case 'status': await cmdStatus(); break;
    case 'route': await cmdRoute(args); break;
    case 'list-models':
    case 'models': cmdListModels(); break;
    case 'switch': cmdSwitch(args); break;
    case 'config': cmdConfig(); break;
    case 'help':
    case '--help':
    case '-h': cmdHelp(); break;
    default: throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  console.error(`Hermes CLI error: ${error.message}`);
  process.exitCode = 1;
});
