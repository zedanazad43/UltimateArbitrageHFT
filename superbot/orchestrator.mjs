/**
 * SuperBot orchestrator — thin process supervisor over the three isolated projects.
 * Keeps project boundaries hard: every command runs inside its project directory.
 */
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const PROJECTS = {
  worker: 'projects/worker-bot',
  engine: 'projects/go-engine',
  dashboard: 'projects/dashboard',
};

export function projectDir(key) {
  const dir = PROJECTS[key];
  if (!dir) throw new Error(`unknown project: ${key}`);
  return join(ROOT, dir);
}

export function runCommand(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32';
    const child = spawn(cmd, args, {
      cwd,
      stdio: 'inherit',
      shell: isWin,
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with ${code}`));
    });
  });
}

export function captureCommand(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, shell: process.platform === 'win32' });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', () => resolve({ ok: false, out }));
    child.on('close', (code) => resolve({ ok: code === 0, out }));
  });
}
