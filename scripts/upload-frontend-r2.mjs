#!/usr/bin/env node
import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const BUILD_DIR = join(ROOT, 'frontend', 'build');
const BUCKET = process.env.FRONTEND_R2_BUCKET || 'emergent-website';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function mimeTypeFor(filePath) {
  return MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream';
}

async function walkFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

function uploadOne(filePath) {
  const key = relative(BUILD_DIR, filePath).replace(/\\/g, '/');
  const objectPath = `${BUCKET}/${key}`;
  const contentType = mimeTypeFor(filePath);

  const args = [
    '--yes',
    'wrangler@4.87.0',
    'r2',
    'object',
    'put',
    objectPath,
    '--remote',
    '--file',
    filePath,
    '--content-type',
    contentType,
  ];

  const res = spawnSync('npx', args, { stdio: 'inherit' });
  if (res.status !== 0) {
    throw new Error(`Upload failed for ${key} (exit ${res.status ?? 1})`);
  }
}

async function main() {
  if (!existsSync(BUILD_DIR)) {
    throw new Error('frontend/build not found. Run `npm --prefix frontend run build` first.');
  }

  const files = await walkFiles(BUILD_DIR);
  if (files.length === 0) {
    throw new Error('frontend/build is empty. Build output is required before upload.');
  }

  console.log(`Uploading ${files.length} frontend files to R2 bucket: ${BUCKET}`);
  for (const filePath of files) {
    uploadOne(filePath);
  }
  console.log('Frontend upload complete.');
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
