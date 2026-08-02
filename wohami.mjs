#!/usr/bin/env node
/**
 * wohami.mjs - Who Am I? - Identity and status checker
 * Part of COOPS Agent integration
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class WhoAmI {
  constructor() {
    this.identity = {
      name: 'COOPS Agent',
      version: '1.0.0',
      description: 'Full cooperation agent with desktop, CLI, VS Code, and cloud integrations',
      platforms: ['Windows', 'macOS', 'Linux'],
      providers: ['Ollama', 'CodeGeeX', 'HuggingFace', 'OpenRouter', 'OmniRoute', 'Merlin', 'Manus', 'Copilot', 'Hermes']
    };
  }

  async whoami(options = {}) {
    const result = {
      identity: this.identity,
      system: {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        homeDir: process.env.HOME || process.env.USERPROFILE,
        cwd: process.cwd(),
        hostname: os.hostname(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      },
      environment: {
        PATH: process.env.PATH ? 'set' : 'not set',
        NODE_ENV: process.env.NODE_ENV || 'development',
        CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN ? 'set' : 'not set',
        CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID || 'not set'
      }
    };

    if (options.verbose) {
      result.environment.PATH = process.env.PATH;
      result.environment.all = process.env;
    }

    return result;
  }

  async status() {
    const result = {
      identity: this.identity,
      memory: await this.checkMemory(),
      config: await this.checkConfig(),
      services: await this.checkServices()
    };

    return result;
  }

  async checkMemory() {
    const memoryPath = 'C:\\Users\\azadz\\AppData\\Local\\hermes\\coops_memory';
    
    try {
      const files = fs.readdirSync(memoryPath);
      return {
        path: memoryPath,
        exists: true,
        files: files.length,
        details: files
      };
    } catch (error) {
      return {
        path: memoryPath,
        exists: false,
        error: error.message
      };
    }
  }

  async checkConfig() {
    const configs = [
      'wrangler.toml',
      'cloudflared-config.yml',
      '.vscode/settings.json',
      '.github/copilot-chat-agents/coops-agent.agent.json'
    ];

    const result = {};
    for (const config of configs) {
      try {
        const content = fs.readFileSync(config, 'utf8');
        result[config] = { exists: true, size: content.length };
      } catch (error) {
        result[config] = { exists: false, error: error.message };
      }
    }

    return result;
  }

  async checkServices() {
    const services = {
      'cloudflared': await this.checkService('cloudflared'),
      'wrangler': await this.checkService('wrangler'),
      'python3': await this.checkService('python3'),
      'node': await this.checkService('node')
    };

    return services;
  }

  async checkService(name) {
    try {
      const result = execSync(`where ${name} 2>nul`, { 
        encoding: 'utf-8',
        timeout: 2000
      });
      return { installed: true, path: result.trim().split('\n')[0] };
    } catch (error) {
      return { installed: false, error: 'not found' };
    }
  }
}

// CLI Interface
const [command, ...args] = process.argv.slice(2);
const whoami = new WhoAmI();

async function main() {
  switch (command) {
    case 'whoami':
    case 'identity':
      const result = await whoami.whoami({ verbose: args.includes('-v') || args.includes('--verbose') });
      console.log(JSON.stringify(result, null, 2));
      break;
    case 'status':
      const status = await whoami.status();
      console.log(JSON.stringify(status, null, 2));
      break;
    case 'check':
      const check = await whoami.checkServices();
      console.log(JSON.stringify(check, null, 2));
      break;
    default:
      console.log(`
Usage: node wohami.mjs <command> [options]

Commands:
  whoami    - Show identity and system info
  status    - Show full status
  check     - Check installed services
      `);
  }
}

main().catch(console.error);