#!/usr/bin/env node
/**
 * wrangler.mjs - Cloudflare Workers deployment automation
 * Part of COOPS Agent integration
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class WranglerRunner {
  constructor() {
    this.config = {
      name: 'ultimatearbitrage-hft',
      main: 'src/index.js',
      compatibility_date: '2024-01-01',
      workers_dev: true,
      account_id: process.env.CLOUDFLARE_ACCOUNT_ID || 'default',
      api_token: process.env.CLOUDFLARE_API_TOKEN
    };
  }

  async deploy(options = {}) {
    console.log('🚀 Deploying to Cloudflare Workers...');
    
    const cmd = [
      'npx', 'wrangler', 'deploy',
      options.credentials ? '--credentials' : '',
      options.dryRun ? '--dry-run' : '',
      `--name=${this.config.name}`,
      `--account-id=${this.config.account_id}`
    ].filter(Boolean).join(' ');

    try {
      const result = execSync(cmd, { 
        encoding: 'utf-8',
        cwd: process.cwd(),
        timeout: 60000
      });
      
      console.log('✅ Deploy successful!');
      console.log(result);
      return { success: true, output: result };
    } catch (error) {
      console.error('❌ Deploy failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async dev(options = {}) {
    console.log('🔧 Starting local dev server...');
    
    const cmd = [
      'npx', 'wrangler', 'dev',
      `--port=${options.port || 8787}`,
      `--local`
    ].join(' ');

    try {
      const result = execSync(cmd, { 
        encoding: 'utf-8',
        cwd: process.cwd(),
        stdio: 'inherit',
        timeout: 30000
      });
      
      return { success: true, output: result };
    } catch (error) {
      // Dev server runs until killed, so this is expected
      return { success: true, output: 'Dev server running' };
    }
  }

  async tail(options = {}) {
    console.log('📋 Fetching logs...');
    
    const cmd = `npx wrangler tail ${options.lines ? `--lines ${options.lines}` : ''}`;
    
    try {
      const result = execSync(cmd, { 
        encoding: 'utf-8',
        cwd: process.cwd(),
        timeout: 30000
      });
      
      console.log(result);
      return { success: true, output: result };
    } catch (error) {
      console.error('❌ Tail failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async status() {
    console.log('📊 Checking worker status...');
    
    try {
      const result = execSync('npx wrangler whoami', { 
        encoding: 'utf-8',
        cwd: process.cwd(),
        timeout: 10000
      });
      
      console.log(result);
      return { success: true, output: result };
    } catch (error) {
      console.error('❌ Status check failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async kv(namespace, action, key = null) {
    const cmd = `npx wrangler kv ${action} ${namespace}${key ? ` ${key}` : ''}`;
    
    try {
      const result = execSync(cmd, { 
        encoding: 'utf-8',
        cwd: process.cwd(),
        timeout: 30000
      });
      
      return { success: true, output: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async d1(action, sql) {
    const cmd = `npx wrangler d1 ${action}`;
    
    try {
      const result = execSync(cmd, { 
        encoding: 'utf-8',
        cwd: process.cwd(),
        timeout: 30000,
        input: sql
      });
      
      return { success: true, output: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

// CLI Interface
const [command, ...args] = process.argv.slice(2);
const runner = new WranglerRunner();

async function main() {
  switch (command) {
    case 'deploy':
      await runner.deploy();
      break;
    case 'dev':
      await runner.dev();
      break;
    case 'tail':
      await runner.tail();
      break;
    case 'status':
      await runner.status();
      break;
    case 'kv':
      await runner.kv(args[0], args[1], args[2]);
      break;
    case 'd1':
      await runner.d1(args[0], args.slice(1).join('\n'));
      break;
    default:
      console.log(`
Usage: node wrangler.mjs <command> [args]

Commands:
  deploy    - Deploy to Cloudflare Workers
  dev       - Start local dev server
  tail      - Fetch logs
  status    - Check account status
  kv        - KV namespace operations
  d1        - D1 database operations
      `);
  }
}

main().catch(console.error);