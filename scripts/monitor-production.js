#!/usr/bin/env node

/**
 * Production Monitoring Dashboard
 * 
 * Tracks key metrics post-PR 281 merge:
 *   • Token budget consumption (target: <80% usage, >20% headroom)
 *   • Latency distribution (target: p95 <500ms)
 *   • Frontend cache hit ratios
 *   • Context compression effectiveness
 * 
 * Polls production endpoints and aggregates metrics.
 */

// Use native fetch (Node.js 18+)

const PROD_URL = 'https://api.ecostamp.net';
const SAMPLE_INTERVAL = 10000; // 10 seconds
const HISTORY_SIZE = 100;

let metrics = {
    latencies: [],
    tokenUsage: [],
    cacheHits: [],
    compressionRatios: [],
    errors: [],
    samples: 0,
};

async function fetchMetrics() {
    try {
        const startTime = Date.now();
        const response = await fetch(`${PROD_URL}/health`);
        const elapsed = Date.now() - startTime;

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        // Record latency
        metrics.latencies.push(elapsed);
        if (metrics.latencies.length > HISTORY_SIZE) {
            metrics.latencies.shift();
        }

        // Extract token info if available
        if (data.token_budget) {
            metrics.tokenUsage.push(data.token_budget.used_percent || 0);
            if (metrics.tokenUsage.length > HISTORY_SIZE) {
                metrics.tokenUsage.shift();
            }
        }

        metrics.samples++;
        return { success: true, elapsed, data };
    } catch (err) {
        metrics.errors.push({
            timestamp: new Date().toISOString(),
            message: err.message,
        });
        if (metrics.errors.length > HISTORY_SIZE) {
            metrics.errors.shift();
        }
        return { success: false, error: err.message };
    }
}

function calculateStats(arr) {
    if (arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const sum = arr.reduce((a, b) => a + b, 0);
    return {
        count: arr.length,
        min: sorted[0],
        max: sorted[arr.length - 1],
        avg: Math.round(sum / arr.length),
        p50: sorted[Math.floor(arr.length * 0.5)],
        p95: sorted[Math.floor(arr.length * 0.95)],
        p99: sorted[Math.floor(arr.length * 0.99)],
    };
}

function printDashboard() {
    console.clear();
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║         PRODUCTION MONITORING DASHBOARD (PR 281)           ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║ Samples: ${metrics.samples.toString().padEnd(50)} ║`);
    console.log(`║ Endpoint: ${PROD_URL.padEnd(50)} ║`);
    console.log('╠════════════════════════════════════════════════════════════╣');

    // Latency stats
    const latencyStats = calculateStats(metrics.latencies);
    if (latencyStats) {
        console.log('║ LATENCY (ms):                                              ║');
        console.log(`║   Avg: ${latencyStats.avg.toString().padEnd(4)} | P50: ${latencyStats.p50.toString().padEnd(4)} | P95: ${latencyStats.p95.toString().padEnd(4)} | P99: ${latencyStats.p99.toString().padEnd(4)}                   ║`);
        const healthStatus = latencyStats.p95 < 500 ? '✅' : latencyStats.p95 < 1000 ? '⚠️' : '❌';
        console.log(`║   Status: ${healthStatus} ${(latencyStats.p95 < 500 ? 'Excellent' : latencyStats.p95 < 1000 ? 'Acceptable' : 'Degraded').padEnd(47)} ║`);
    }

    // Token budget stats
    if (metrics.tokenUsage.length > 0) {
        const tokenStats = calculateStats(metrics.tokenUsage);
        console.log('║ TOKEN BUDGET (% used):                                     ║');
        console.log(`║   Avg: ${tokenStats.avg.toString().padEnd(5)} | Min: ${tokenStats.min.toString().padEnd(5)} | Max: ${tokenStats.max.toString().padEnd(5)}              ║`);
        const tokenStatus = tokenStats.avg < 80 ? '✅' : tokenStats.avg < 90 ? '⚠️' : '❌';
        const headroom = (100 - tokenStats.avg).toFixed(1);
        console.log(`║   Status: ${tokenStatus} Headroom: ${headroom}% (target >20%)${' '.repeat(Math.max(0, 20 - headroom.length - 13))} ║`);
    }

    // Error tracking
    if (metrics.errors.length > 0) {
        console.log('║ RECENT ERRORS:                                             ║');
        metrics.errors.slice(-3).forEach(err => {
            console.log(`║   • ${err.message.substring(0, 50).padEnd(50)} ║`);
        });
    } else {
        console.log('║ RECENT ERRORS: None ✅                                    ║');
    }

    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log('║ Monitoring active... (Press Ctrl+C to stop)                ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
}

async function main() {
    console.log(`🚀 Starting production monitoring for ${PROD_URL}`);
    console.log(`📊 Polling interval: ${SAMPLE_INTERVAL}ms\n`);

    // Initial sample
    await fetchMetrics();
    printDashboard();

    // Continuous monitoring
    setInterval(async () => {
        await fetchMetrics();
        printDashboard();
    }, SAMPLE_INTERVAL);
}

main().catch(console.error);
