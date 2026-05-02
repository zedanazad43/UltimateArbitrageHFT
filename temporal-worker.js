// temporal-worker.js — Local / server Temporal worker entry point
//
// This Node.js process connects to Temporal Cloud (or a local Temporal dev
// server), registers the ArbitrageTradingWorkflow, and polls for tasks.
// It must run continuously alongside the Cloudflare Worker deployment.
//
// ── Quick start ───────────────────────────────────────────────────────────────
//
//   1. Copy .dev.vars.example to .dev.vars and fill in the Temporal vars.
//   2. Export the required env vars (or load .dev.vars via `dotenv`):
//
//        export TEMPORAL_API_KEY="<your-temporal-cloud-api-key>"
//        export TEMPORAL_ADDRESS="<namespace>.<account>.tmprl.cloud:7233"
//        export TEMPORAL_NAMESPACE="default"
//        export TEMPORAL_WORKER_URL="https://<your-worker>.workers.dev"
//        export ADMIN_TOKEN="<your-cf-worker-admin-token>"
//
//   3. Start the worker:
//
//        npm run temporal:worker
//
// ── Temporal Cloud connection ─────────────────────────────────────────────────
//
//   TEMPORAL_ADDRESS should be the gRPC endpoint (host:port) for your Temporal
//   Cloud namespace, e.g.: "default.abc123.tmprl.cloud:7233"
//   TLS is enabled automatically when TEMPORAL_API_KEY is set.
//
// ── Local dev server (no API key) ────────────────────────────────────────────
//
//   Start the Temporal dev server:  npx @temporalio/cli server start-dev
//   Leave TEMPORAL_API_KEY unset; the worker connects without TLS.
//   TEMPORAL_ADDRESS defaults to "localhost:7233".

import { Worker, NativeConnection } from '@temporalio/worker';
import { fileURLToPath }            from 'url';
import path                         from 'path';
import * as activities              from './src/temporal/activities.js';

const {
  TEMPORAL_ADDRESS    = 'localhost:7233',
  TEMPORAL_API_KEY,
  TEMPORAL_NAMESPACE  = 'default',
  TEMPORAL_TASK_QUEUE = 'arbitrage-tasks',
  TEMPORAL_WORKER_URL,
  ADMIN_TOKEN,
} = process.env;

// ── Validate required environment ─────────────────────────────────────────────

if (!TEMPORAL_WORKER_URL) {
  console.error(
    '[temporal-worker] ERROR: TEMPORAL_WORKER_URL is required.\n' +
    '  Set it to the public URL of your Cloudflare Worker, e.g.:\n' +
    '    export TEMPORAL_WORKER_URL=https://your-worker.workers.dev\n' +
    '  (or http://localhost:8787 for local wrangler dev)'
  );
  process.exit(1);
}

if (!ADMIN_TOKEN) {
  console.error(
    '[temporal-worker] ERROR: ADMIN_TOKEN is required.\n' +
    '  Set it to the same value as your CF Worker ADMIN_TOKEN secret.'
  );
  process.exit(1);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const isCloud = Boolean(TEMPORAL_API_KEY);

  // Build connection options
  const connectionOptions = { address: TEMPORAL_ADDRESS };
  if (isCloud) {
    connectionOptions.tls    = {};          // empty object = enable TLS with default system CA roots (required for Temporal Cloud)
    connectionOptions.apiKey = TEMPORAL_API_KEY;
  }

  const connection = await NativeConnection.connect(connectionOptions);
  console.log(
    `[temporal-worker] Connected to Temporal at ${TEMPORAL_ADDRESS}` +
    (isCloud ? ' (Temporal Cloud / TLS)' : ' (local dev server)')
  );

  const worker = await Worker.create({
    connection,
    namespace:     TEMPORAL_NAMESPACE,
    // Temporal bundles workflows in a V8 isolate for determinism.
    // The path must point to the workflow module on disk.
    workflowsPath: path.join(__dirname, 'src', 'temporal', 'workflows.js'),
    activities,
    taskQueue:     TEMPORAL_TASK_QUEUE,
  });

  console.log(
    `[temporal-worker] Worker polling on task queue: "${TEMPORAL_TASK_QUEUE}"\n` +
    `[temporal-worker] Namespace: ${TEMPORAL_NAMESPACE}\n` +
    `[temporal-worker] CF Worker URL: ${TEMPORAL_WORKER_URL}`
  );

  // Graceful shutdown on SIGINT / SIGTERM
  const shutdown = () => {
    console.log('[temporal-worker] Shutting down…');
    worker.shutdown();
  };
  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);

  await worker.run();
  await connection.close();
  console.log('[temporal-worker] Worker stopped.');
}

main().catch((err) => {
  console.error('[temporal-worker] Fatal error:', err);
  process.exit(1);
});
