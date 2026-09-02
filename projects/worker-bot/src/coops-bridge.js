/**
 * COOPS Bridge - Connect VSCode Chat, GitHub Copilot, Hermes, and Ollama
 * Enables automatic routing of commands to appropriate AI providers
 */

import express from 'express';
import { exec } from 'child_process';

const app = express();
app.use(express.json());

// Model routing configuration
const MODEL_ROUTING = {
  // Default providers
  'default': 'hermes',
  
  // Provider endpoints
  'ollama': 'http://127.0.0.1:11434',
  'codegeex': 'http://127.0.0.1:8000',
  'hermes': 'https://inference-api.nousresearch.com/v1/chat/completions',
  'openrouter': 'https://openrouter.ai/api/v1',
  'cli': 'local',
  
  // Command routing patterns
  'patterns': {
    'build': ['hermes', 'codegeex'],
    'test': ['hermes', 'codegeex'],
    'deploy': ['hermes', 'openrouter'],
    'optimize': ['hermes', 'codegeex'],
    'analyze': ['hermes', 'codegeex'],
    'fix bug': ['hermes', 'codegeex'],
    'create': ['hermes', 'codegeex'],
    'implement': ['hermes', 'codegeex'],
    'debug': ['hermes', 'codegeex'],
    'review': ['hermes', 'codegeex'],
    'document': ['hermes', 'codegeex'],
    'refactor': ['hermes', 'codegeex']
  }
};

// Command execution function
function executeCommand(command, args = []) {
  return new Promise((resolve, reject) => {
    const fullCommand = command + ' ' + args.join(' ');
    exec(fullCommand, { cwd: process.cwd() }, (error, stdout, stderr) => {
      if (error) {
        reject({ error: error.message, stderr });
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

// API Routes

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    providers: Object.keys(MODEL_ROUTING).filter(k => k !== 'patterns'),
    timestamp: new Date().toISOString()
  });
});

// Get routing info
app.get('/routing', (req, res) => {
  res.json(MODEL_ROUTING);
});

// Execute command
app.post('/execute', async (req, res) => {
  const { command, args } = req.body;
  try {
    const result = await executeCommand(command, args);
    res.json(result);
  } catch (err) {
    res.status(500).json(err);
  }
});

// Route prompt to appropriate provider
app.post('/route', async (req, res) => {
  const { prompt, context } = req.body;
  
  // Determine best provider based on prompt
  let provider = MODEL_ROUTING.default;
  for (const [pattern, providers] of Object.entries(MODEL_ROUTING.patterns)) {
    if (prompt.toLowerCase().includes(pattern)) {
      provider = providers[0];
      break;
    }
  }
  
  res.json({
    prompt: prompt,
    provider: provider,
    context: context || 'general'
  });
});

// Get status
app.get('/status', (req, res) => {
  exec('python3 cooperation/coops_desktop_agent.py status', (error, stdout, _stderr) => {
    if (error) {
      res.json({ error: error.message });
    } else {
      try {
        const data = JSON.parse(stdout);
        res.json(data);
      } catch {
        res.json({ raw: stdout });
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`COOPS Bridge running on port ${PORT}`);
});

export default app;