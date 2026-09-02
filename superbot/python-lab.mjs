/**
 * SuperBot Python lab adapter — bridges the external quant stack without
 * polluting the Node/Go projects:
 *
 *   freqtrade         execution-grade crypto bot + hyperopt backtests
 *   backtrader        event-driven strategy backtesting
 *   nautilus_trader   institutional-grade event-driven backtesting + live
 *   OpenBB            market research / data workspace
 *
 * The lab lives in superbot/python-lab/ (its own venv + requirements.txt).
 * Nothing here imports Node project code and no project imports this —
 * the boundary is the CLI and JSON on stdout.
 *
 * Setup (one-time):
 *   cd superbot/python-lab && sh ./setup.sh
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const LAB_DIR = join(dirname(fileURLToPath(import.meta.url)), 'python-lab');
const VENV_PY = join(LAB_DIR, '.venv',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

function runPy(args, timeoutMs = 60_000) {
  return new Promise((resolve) => {
    if (!existsSync(VENV_PY)) {
      resolve({ ok: false, error: 'lab venv missing — run: sh ./setup.sh in superbot/python-lab' });
      return;
    }
    const child = spawn(VENV_PY, args, { cwd: LAB_DIR });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ ok: false, error: 'timeout', out }); }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: e.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, out, err });
    });
  });
}

export const pythonLab = {
  dir: LAB_DIR,
  venvPython: VENV_PY,

  async probe() {
    const available = existsSync(VENV_PY);
    if (!available) {
      return { available: false, python: null, packages: {} };
    }
    const res = await runPy(['-c',
      'import json,sys; info={"python":sys.version.split()[0]}; mods={};'
      + 'for m in ("freqtrade","backtrader","nautilus_trader","openbb"):'
      + '  try: mods[m]=__import__(m).__version__'
      + '  except Exception: mods[m]=None'
      + 'info["packages"]=mods; print(json.dumps(info))',
    ], 20_000);
    if (!res.ok) return { available: true, python: null, packages: {}, error: res.error || res.err?.slice(0, 200) };
    try {
      const info = JSON.parse(res.out.trim().split('\n').pop());
      return { available: true, ...info };
    } catch {
      return { available: true, python: null, packages: {}, error: 'probe parse failed' };
    }
  },

  /** Run a backtest through the lab's unified entrypoint. */
  async backtest(strategy) {
    return runPy(['lab.py', 'backtest', strategy], 120_000);
  },
};
