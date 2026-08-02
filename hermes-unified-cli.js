#!/usr/bin/env node
// hermes-unified-cli.js - Unified CLI interface for Hermes + Copilot + OmniRoute + OpenRouter
// Usage: node hermes-unified-cli.js [command] [options]

import { UnifiedRouter, PROVIDER_CONFIG, MODEL_ALIASES } from './src/infrastructure/hermes-unified-router.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// CLI Configuration
const CONFIG_PATH = join(__dirname, '.hermes-unified-config.json');

// Load or create config
let config = {};
try {
  if (existsSync(CONFIG_PATH)) {
    config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  }
} catch (_e) {
  // Create default config
  config = {
    defaultProvider: 'hermes',
    paperMode: true,
    budgetLimit: 0,
    latencyRequirement: 'medium',
    modelAliases: MODEL_ALIASES
  };
  saveConfig(config);
}

function saveConfig(cfg) {
  try {
    writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  } catch (e) {
    console.error('Warning: Could not save config:', e.message);
  }
}

// Mock environment for CLI
const mockEnv = {
  AIWORKER: process.env.AIWORKER || null,
  AI_GATEWAY_URL: process.env.AI_GATEWAY_URL || null,
  CODECOPILOT_TOKEN: process.env.CODECOPILOT_TOKEN || process.env.GITHUB_TOKEN || null,
  OMNIROUTE_GATEWAY_URL: process.env.OMNIROUTE_GATEWAY_URL || process.env.LOCAL_GATEWAY_URL || null,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || null,
  CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID || null
};

const mockState = {
  paper_trading: config.paperMode !== false
};

const router = new UnifiedRouter(mockEnv, mockState);

// Command handlers
async function cmdStatus() {
  console.log('\n=== Hermes Unified Router Status ===\n');
  const statuses = await router.getAllProviderStatuses();
  
  for (const [provider, status] of Object.entries(statuses)) {
    const cfg = PROVIDER_CONFIG[provider];
    const icon = status.healthy ? '✅' : status.configured ? '⚠️' : '❌';
    console.log(`${icon} ${provider.padEnd(12)} [${cfg.type}] models: ${cfg.models.length}, cost: ${cfg.cost}, latency: ${cfg.latency}`);
    if (status.error) console.log(`   Error: ${status.error}`);
  }
  console.log('');
}

async function cmdRoute(args) {
  const prompt = args.join(' ');
  if (!prompt) {
    console.error('Usage: hermes route <prompt> [--provider <name>] [--model <alias>] [--budget <usd>]');
    process.exit(1);
  }

  const options = {
    paperMode: config.paperMode !== false,
    latencyRequirement: config.latencyRequirement || 'medium',
    budgetLimit: config.budgetLimit || 0
  };

  // Parse flags
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--provider' && args[i+1]) {
      options.preferredProvider = args[++i];
    }
    if (args[i] === '--model' && args[i+1]) {
      options.modelHint = router.resolveModelAlias(args[++i]);
    }
    if (args[i] === '--budget' && args[i+1]) {
      options.budgetLimit = parseFloat(args[++i]);
    }
    if (args[i] === '--live') {
      options.paperMode = false;
    }
  }

  console.log(`\n🧠 Routing: "${prompt.substring(0, 50)}..."`);
  console.log(`   Mode: ${options.paperMode ? 'paper' : 'live'}`);
  console.log(`   Budget: $${options.budgetLimit}`);

  try {
    const result = await router.routeLLMCall([{ role: 'user', content: prompt }], options);
    console.log(`\n✅ Provider: ${result.routedVia}`);
    console.log(`   Model: ${result.model}`);
    console.log(`   Reason: ${result.route?.reason || 'auto'}`);
    if (result.cached) console.log(`   Status: cached`);
    console.log(`\n📝 Response:\n${result.text}\n`);
  } catch (e) {
    console.error(`\n❌ Error: ${e.message}\n`);
    process.exit(1);
  }
}

async function cmdListModels() {
  console.log('\n=== Available Models ===\n');
  
  for (const [provider, cfg] of Object.entries(PROVIDER_CONFIG)) {
    console.log(`\n${provider.toUpperCase()}:`);
    for (const model of cfg.models) {
      const alias = Object.entries(MODEL_ALIASES).find(([_, v]) => v === model)?.[0];
      console.log(`  • ${model}${alias ? ` (${alias})` : ''}`);
    }
  }
  console.log('');
}

async function cmdSwitch(args) {
  const key = args[0];
  const value = args[1];
  
  if (!key || !value) {
    console.error('Usage: hermes switch <key> <value>');
    console.error('  Keys: defaultProvider, paperMode, budgetLimit, latencyRequirement');
    process.exit(1);
  }

  if (key === 'paperMode') {
    config.paperMode = value === 'true' || value === '1';
  } else if (key === 'budgetLimit') {
    config.budgetLimit = parseFloat(value);
  } else if (key === 'latencyRequirement') {
    config.latencyRequirement = value;
  } else if (key === 'defaultProvider') {
    config.defaultProvider = value;
  }

  saveConfig(config);
  console.log(`✅ Updated ${key} = ${value}`);
}

async function cmdConfig(_args) {
  console.log('\n=== Current Configuration ===\n');
  console.log(JSON.stringify(config, null, 2));
  console.log('');
}

async function cmdHelp() {
  console.log(`
=== Hermes Unified Router CLI ===

Usage: hermes <command> [options]

Commands:
  status              Show all provider statuses
  route <prompt>      Route a prompt to the best provider
  list-models         List all available models with aliases
  switch <key> <val>  Switch configuration
  config              Show current configuration
  help                Show this help

Options for 'route':
  --provider <name>   Force specific provider (hermes, copilot, omniroute, openrouter)
  --model <alias>     Use specific model alias
  --budget <usd>      Set budget limit for routing
  --live              Use live mode (disable paper mode)

Examples:
  hermes status
  hermes route "analyze this arbitrage opportunity"
  hermes route "optimize trading strategy" --provider openrouter --model or-claude
  hermes switch paperMode false
  hermes list-models

`);
}

// Main CLI entry point
async function main() {
  const [, , command, ...args] = process.argv;

  if (!command || command === '--help' || command === 'help' || command === '-h') {
    await cmdHelp();
    return;
  }

  switch (command) {
    case 'status':
      await cmdStatus();
      break;
    case 'route':
      await cmdRoute(args);
      break;
    case 'list-models':
    case 'models':
      await cmdListModels();
      break;
    case 'switch':
      await cmdSwitch(args);
      break;
    case 'config':
      await cmdConfig(args);
      break;
    case 'help':
    case '--help':
      await cmdHelp();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      await cmdHelp();
      process.exit(1);
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});