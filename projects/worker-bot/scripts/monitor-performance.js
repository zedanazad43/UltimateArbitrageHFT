#!/usr/bin/env node
/**
 * Production Performance Monitor
 * Tracks endpoint availability and latency for /health and /dashboard.
 * Designed for scheduled execution in CI (GitHub Actions) and local runs.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ENDPOINT = process.env.MONITOR_BASE_URL || 'https://ultimatearbitragehft.zedanazad43.workers.dev';
const METRICS_FILE = path.join(__dirname, '../metrics.json');
const MAX_METRICS_HISTORY = 1000; // Keep last 1000 measurements
const MAX_P95_MS = Number(process.env.MONITOR_MAX_P95_MS || 4000);
const MAX_ERROR_RATE_PCT = Number(process.env.MONITOR_MAX_ERROR_RATE_PCT || 5);
const MIN_UPTIME_PCT = Number(process.env.MONITOR_MIN_UPTIME_PCT || 95);

let metrics = {
  lastUpdated: new Date().toISOString(),
  measurements: [],
  summary: {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    averageLatency: 0,
    p95Latency: 0,
    p99Latency: 0,
    errorRate: 0,
    uptime: 100,
    lastError: null
  }
};

function loadMetrics() {
  try {
    if (fs.existsSync(METRICS_FILE)) {
      const data = fs.readFileSync(METRICS_FILE, 'utf-8');
      metrics = JSON.parse(data);
      // Keep only last N measurements
      if (metrics.measurements.length > MAX_METRICS_HISTORY) {
        metrics.measurements = metrics.measurements.slice(-MAX_METRICS_HISTORY);
      }
    }
  } catch (err) {
    console.error('Failed to load metrics:', err.message);
  }
}

function saveMetrics() {
  try {
    fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2));
  } catch (err) {
    console.error('Failed to save metrics:', err.message);
  }
}

async function testEndpoint(endpoint, endpointPath) {
  const startTime = Date.now();
  const measurement = {
    timestamp: new Date().toISOString(),
    endpoint: endpoint + endpointPath,
    latency: 0,
    statusCode: 0,
    success: false,
    error: null
  };

  try {
    const response = await fetch(endpoint + endpointPath, {
      method: 'GET',
      headers: {
        'User-Agent': 'Production-Monitor/1.0'
      },
      signal: AbortSignal.timeout(30000)
    });

    measurement.latency = Date.now() - startTime;
    measurement.statusCode = response.status;
    measurement.success = response.status >= 200 && response.status < 400;

    // Consume response to prevent hanging
    await response.text();

    if (!measurement.success) {
      measurement.error = `HTTP ${response.status}`;
    }
  } catch (err) {
    measurement.latency = Date.now() - startTime;
    measurement.success = false;
    measurement.error = err.message;
  }

  return measurement;
}

function calculatePercentile(values, percentile) {
  if (values.length === 0) return 0;
  const sorted = values.sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

function updateSummary() {
  const measurements = metrics.measurements || [];
  const recentMeasurements = measurements.slice(-100); // Last 100 measurements

  if (recentMeasurements.length === 0) return;

  const successfulCount = recentMeasurements.filter(m => m.success).length;
  const failedCount = recentMeasurements.length - successfulCount;
  const latencies = recentMeasurements.filter(m => m.success).map(m => m.latency);

  metrics.summary.totalRequests = measurements.length;
  metrics.summary.successfulRequests = measurements.filter(m => m.success).length;
  metrics.summary.failedRequests = measurements.filter(m => !m.success).length;
  metrics.summary.averageLatency = latencies.length > 0 
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : 0;
  metrics.summary.p95Latency = calculatePercentile(latencies, 95);
  metrics.summary.p99Latency = calculatePercentile(latencies, 99);
  metrics.summary.errorRate = parseFloat(((failedCount / recentMeasurements.length) * 100).toFixed(2));
  metrics.summary.uptime = parseFloat((((recentMeasurements.length - failedCount) / recentMeasurements.length) * 100).toFixed(2));

  const lastError = [...measurements].reverse().find(m => m.error);
  metrics.summary.lastError = lastError ? {
    timestamp: lastError.timestamp,
    error: lastError.error,
    statusCode: lastError.statusCode
  } : null;

  metrics.lastUpdated = new Date().toISOString();
}

function generateReport() {
  const summary = metrics.summary;
  return `
╔════════════════════════════════════════════════════════════════╗
║         PRODUCTION PERFORMANCE REPORT                          ║
╚════════════════════════════════════════════════════════════════╝

📊 AVAILABILITY & RELIABILITY
  Uptime:                  ${summary.uptime}%
  Error Rate:              ${summary.errorRate}%
  Total Requests:          ${summary.totalRequests}
  Successful:              ${summary.successfulRequests}
  Failed:                  ${summary.failedRequests}

⚡ LATENCY METRICS (ms)
  Average:                 ${summary.averageLatency}ms
  P95:                     ${summary.p95Latency}ms
  P99:                     ${summary.p99Latency}ms

🚨 LAST ERROR
  ${summary.lastError ? `
  Time:                    ${summary.lastError.timestamp}
  Error:                   ${summary.lastError.error}
  Status Code:             ${summary.lastError.statusCode}
  ` : '  None recorded'}

⏰ Last Updated: ${metrics.lastUpdated}
`;
}

function checkAlerts() {
  const alerts = [];
  const summary = metrics.summary;

  if (summary.errorRate > MAX_ERROR_RATE_PCT) {
    alerts.push(`CRITICAL: Error rate ${summary.errorRate}% exceeds ${MAX_ERROR_RATE_PCT}% threshold`);
  }

  if (summary.uptime < MIN_UPTIME_PCT) {
    alerts.push(`WARNING: Uptime ${summary.uptime}% is below ${MIN_UPTIME_PCT}% threshold`);
  }

  if (summary.p95Latency > MAX_P95_MS) {
    alerts.push(`WARNING: P95 latency ${summary.p95Latency}ms exceeds ${MAX_P95_MS}ms threshold`);
  }

  if (summary.totalRequests > 0 && summary.successfulRequests === 0) {
    alerts.push('CRITICAL: All requests are failing');
  }

  return alerts;
}

async function main() {
  console.log('Starting production performance monitor...\n');

  loadMetrics();

  const endpoints = ['/health', '/dashboard'];
  console.log(`Running endpoint tests against ${ENDPOINT} ...`);
  for (let i = 0; i < 3; i++) {
    for (const endpointPath of endpoints) {
      const measurement = await testEndpoint(ENDPOINT, endpointPath);
      metrics.measurements.push(measurement);
      console.log(
        `  [${i + 1}/3] ${measurement.endpoint}: ${measurement.success ? 'OK' : 'FAIL'} ${measurement.latency}ms ${measurement.error ? `(${measurement.error})` : ''}`
      );
    }
    if (i < 2) await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Update summary statistics
  updateSummary();

  saveMetrics();

  // Display report
  console.log(generateReport());

  const alerts = checkAlerts();
  if (alerts.length > 0) {
    console.log('\nALERTS:');
    alerts.forEach(alert => console.log(`  ${alert}`));
    process.exit(1);
  } else {
    console.log('\nAll systems nominal\n');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Monitor failed:', err);
  process.exit(1);
});
