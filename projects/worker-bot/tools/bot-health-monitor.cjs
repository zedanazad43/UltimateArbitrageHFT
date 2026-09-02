const { execSync } = require('child_process');
const fs = require('fs');
const OR_FILE = 'C:/Users/azadz/.openrouter_key';

function ghToken() {
  try { return execSync('gh auth token').toString().trim(); } catch { return ''; }
}
function orKey() {
  try { return fs.readFileSync(OR_FILE, 'utf8').trim(); } catch { return ''; }
}

async function checkOrCredits() {
  const key = orKey();
  if (!key) return { ok: false, reason: 'NO_OR_KEY' };
  try {
    const r = await fetch('https://openrouter.ai/api/v1/credits', {
      headers: { 'Authorization': 'Bearer ' + key }
    });
    if (!r.ok) return { ok: false, reason: 'OR_API_ERR ' + r.status };
    const j = await r.json();
    const remaining = (j.data && (j.data.total_credits - j.data.total_usage)) || 0;
    return { ok: true, remaining };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

async function checkGitHubModels() {
  const tok = ghToken();
  if (!tok) return { ok: false, reason: 'NO_GH_TOKEN' };
  try {
    const r = await fetch('https://models.inference.ai.azure.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'deepseek/deepseek-chat', messages: [{ role: 'user', content: 'hi' }], max_tokens: 5 })
    });
    const j = await r.json();
    if (r.ok && j.choices) return { ok: true, via: 'github-models' };
    return { ok: false, reason: 'ERR ' + JSON.stringify(j.error || j).slice(0, 80) };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

(async () => {
  console.log('=== Bot Health Monitor ===');
  console.log('Timestamp:', new Date().toISOString());

  const or = await checkOrCredits();
  console.log('OpenRouter:', or.ok ? 'credits=' + or.remaining.toFixed(4) : 'FAIL ' + or.reason);

  const gh = await checkGitHubModels();
  console.log('GitHub Models:', gh.ok ? 'available (' + gh.via + ')' : 'FAIL ' + gh.reason);

  if (!or.ok || or.remaining < 0.01) {
    console.log('WARNING: OpenRouter credits low/negative. Using GitHub Models fallback.');
  }
})().catch(e => console.log('FATAL', e.message));
