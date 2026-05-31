// src/infra/observability.js
// Lightweight structured logging and metric emission for Worker/Node runtimes.

function sanitize(value, depth = 0) {
  if (depth > 5) return '[max-depth]';
  if (value == null) return value;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = sanitize(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function logEvent(level, event, fields = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level: String(level || 'info').toLowerCase(),
    event: String(event || 'event'),
    ...sanitize(fields),
  };

  const line = JSON.stringify(payload);
  if (payload.level === 'error') {
    console.error(line);
    return;
  }
  if (payload.level === 'warn') {
    console.warn(line);
    return;
  }
  console.log(line);
}

export function incrementMetric(name, value = 1, dimensions = {}) {
  logEvent('info', 'metric.counter', {
    metric: String(name || 'counter'),
    value: Number(value || 0),
    dimensions: sanitize(dimensions),
  });
}

export function observeLatency(name, startTimeMs, dimensions = {}) {
  const elapsedMs = Math.max(0, Date.now() - Number(startTimeMs || Date.now()));
  logEvent('info', 'metric.latency', {
    metric: String(name || 'latency_ms'),
    elapsedMs,
    dimensions: sanitize(dimensions),
  });
  return elapsedMs;
}
