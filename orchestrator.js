import http from 'http';
import { execSync } from 'child_process';
import { readFileSync, existsSync, writeFileSync, readdirSync } from 'fs';
import os from 'os';

const PORT = 8000;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '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';
const OLLAMA_URL = 'http://127.0.0.1:11434/v1/chat/completions';
const HERMES_URL = 'http://127.0.0.1:9119/v1/chat/completions';   // Hermes gateway API

const tools = {
  run_powershell: (cmd) => {
    try {
      const safe = cmd.replace(/[|&;>$]/g, '');
      const out = execSync('powershell -Command "' + safe + '"', { timeout: 30000, encoding: 'utf8' });
      return out || '(no output)';
    } catch (e) { return 'PowerShell Error: ' + (e.stderr || e.message); }
  },
  web_search: async (query) => {
    try {
      const resp = await fetch('https://api.duckduckgo.com/?q=' + encodeURIComponent(query) + '&format=json&no_html=1');
      const data = await resp.json();
      return data.AbstractText || data.RelatedTopics?.[0]?.Text || 'No results.';
    } catch (e) { return 'Search error: ' + e.message; }
  },
  gh_run: (args) => {
    try {
      const env = Object.assign({}, process.env);
      delete env.GITHUB_TOKEN;
      return execSync('gh ' + args, { timeout: 30000, encoding: 'utf8', env }) || 'Done.';
    } catch (e) { return 'GitHub CLI error: ' + (e.stderr || e.message); }
  },
  browser_open: (url) => {
    try { execSync('start ' + url); return 'Opened.'; }
    catch (e) { return 'Browser error: ' + e.message; }
  },
  sysinfo: () => 'Platform: ' + os.platform() + ', CPU: ' + os.cpus()[0].model + ', Memory: ' + (os.totalmem()/1e9).toFixed(1) + ' GB',
  graveyard_analyze: (repoPath) => {
    const script = process.env.USERPROFILE + '\\.hero\\analyzer.ps1';
    try {
      const out = execSync('powershell -File "' + script + '" -Path "' + repoPath + '"', { timeout: 120000, encoding: 'utf8' });
      return out.trim() || 'Analysis complete.';
    } catch (e) { return 'Graveyard error: ' + (e.stderr || e.message); }
  },
  // FreeBuff integration
  freebuff_scan: () => {
    try {
      const out = execSync('freebuff scan', { timeout: 30000, encoding: 'utf8' });
      return out.trim() || 'Scan completed.';
    } catch (e) { return 'FreeBuff scan error: ' + (e.stderr || e.message); }
  },
  freebuff_execute: () => {
    try {
      const out = execSync('freebuff execute', { timeout: 60000, encoding: 'utf8' });
      return out.trim() || 'Execution completed.';
    } catch (e) { return 'FreeBuff execute error: ' + (e.stderr || e.message); }
  },
  // Hermes (via gateway API)
  hermes_ask: async (prompt) => {
    try {
      const resp = await fetch(HERMES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt })
      });
      if (resp.ok) {
        const data = await resp.json();
        return data.response || data.reply || data.choices?.[0]?.message?.content || JSON.stringify(data);
      }
    } catch (e) {}
    // Fallback to CLI
    try {
      const out = execSync('hermes chat "' + prompt.replace(/"/g, '\\"') + '"', { timeout: 30000, encoding: 'utf8' });
      return out.trim() || 'Hermes returned no output.';
    } catch (e) { return 'Hermes unavailable: ' + (e.stderr || e.message); }
  }
};

async function getAIResponse(messages) {
  // 1) Ollama local
  try {
    const resp = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'llama3.2:latest', messages })
    });
    const data = await resp.json();
    if (data.choices?.[0]?.message?.content) return data.choices[0].message.content;
  } catch (e) {}

  // 2) OpenRouter free
  try {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + OPENROUTER_KEY },
      body: JSON.stringify({ model: 'google/gemini-2.0-flash-exp', messages, max_tokens: 500 })
    });
    const data = await resp.json();
    if (data.choices?.[0]?.message?.content) return data.choices[0].message.content;
  } catch (e) {}

  return 'جميع النماذج غير متاحة حالياً.';
}

async function agent(msgs) {
  const msg = msgs[msgs.length-1]?.content || '';
  const lower = msg.toLowerCase();

  if (lower.startsWith('ps ')) return tools.run_powershell(msg.slice(3));
  if (lower.startsWith('search ')) return await tools.web_search(msg.slice(7));
  if (lower.startsWith('gh ')) return tools.gh_run(msg.slice(3));
  if (lower.startsWith('browser ')) return tools.browser_open(msg.slice(8));
  if (lower === 'sysinfo') return tools.sysinfo();
  if (lower.startsWith('graveyard ') || lower.includes('فحص المشروع')) {
    const repo = lower.startsWith('graveyard ') ? msg.slice(10).trim() : msg.split(' ').slice(1).join(' ');
    return tools.graveyard_analyze(repo || '.');
  }
  if (lower === 'freebuff scan') return tools.freebuff_scan();
  if (lower === 'freebuff execute') return tools.freebuff_execute();
  if (lower.includes('hermes')) {
    const prompt = msg.replace(/hermes/gi, '').trim();
    return await tools.hermes_ask(prompt);
  }

  return await getAIResponse(msgs);
}

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
    if (req.url === '/v1/models' || req.url === '/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'hero-agent', object: 'model' }] }));
        return;
    }
    if (req.url === '/v1/chat/completions') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            let reply;
            try {
                const payload = JSON.parse(body);
                reply = await agent(payload.messages || []);
            } catch (e) { reply = 'Error: ' + e.message; }
            const answer = {
                id: 'chatcmpl-' + Date.now(),
                object: 'chat.completion',
                created: Date.now(),
                model: 'hero-agent',
                choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }]
            };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(answer));
        });
        return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Hero + FreeBuff + Hermes');
});
server.listen(PORT, () => console.log('Hero running on http://localhost:' + PORT));
