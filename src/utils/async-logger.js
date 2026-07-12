// src/utils/async-logger.js — High-performance non-blocking async logger

import { createWriteStream, appendFileSync } from 'fs';
import { join } from 'path';

const LOG_DIR = join(process.cwd(), 'logs');
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
const BATCH_SIZE = 100;

class AsyncLogger {
  constructor(options = {}) {
    this.level = options.level || 'info'; // debug, info, warn, error
    this.logs = [];
    this.isFlushing = false;
    this.stream = null;
    this.errorStream = null;
    this.stats = {
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
      total: 0
    };
  }

  /**
   * Initialize logger with file streams
   */
  async init() {
    const fs = await import('fs/promises');
    await fs.mkdir(LOG_DIR, { recursive: true });

    // Main log stream (all levels)
    this.stream = createWriteStream(join(LOG_DIR, 'app.log'), {
      flags: 'a',
      maxConcurrent: 1,
      autoClose: true
    });

    // Error log stream (errors only)
    this.errorStream = createWriteStream(join(LOG_DIR, 'errors.log'), {
      flags: 'a',
      maxConcurrent: 1,
      autoClose: true
    });

    // Start flush loop
    this._startFlushLoop();
  }

  /**
   * Non-blocking log method
   */
  _log(level, message, meta = {}) {
    const entry = {
      timestamp: Date.now(),
      iso: new Date().toISOString(),
      level,
      message,
      meta,
      pid: process.pid
    };

    this.stats[level] = (this.stats[level] || 0) + 1;
    this.stats.total++;

    // Add to batch queue
    this.logs.push(entry);

    // Flush if batch full
    if (this.logs.length >= BATCH_SIZE) {
      this._flushSync();
    }
  }

  /**
   * Start async flush loop
   */
  _startFlushLoop() {
    setInterval(() => {
      if (this.logs.length > 0) {
        this._flushSync();
      }
    }, 100); // Flush every 100ms
  }

  /**
   * Synchronous flush (fast, batched)
   */
  _flushSync() {
    if (this.isFlushing || this.logs.length === 0) return;

    this.isFlushing = true;
    const batch = this.logs.splice(0, BATCH_SIZE);

    try {
      const lines = batch.map(e =>
        JSON.stringify({
          ts: e.timestamp,
          iso: e.iso,
          level: e.level,
          msg: e.message,
          meta: e.meta,
          pid: e.pid
        })
      ).join('\n');

      // Write to main log
      if (this.stream) {
        this.stream.write(lines + '\n');
      }

      // Write errors separately
      const errors = batch.filter(e => e.level === 'error');
      if (errors.length > 0 && this.errorStream) {
        const errorLines = errors.map(e =>
          JSON.stringify({
            ts: e.timestamp,
            iso: e.iso,
            msg: e.message,
            meta: e.meta,
            pid: e.pid
          })
        ).join('\n');
        this.errorStream.write(errorLines + '\n');
      }
    } catch (err) {
      // Fail silently - don't block main thread
      console.error('Logger write failed:', err.message);
    }

    this.isFlushing = false;
  }

  /**
   * Public API methods
   */
  debug(message, meta = {}) {
    if (this.level === 'debug') {
      this._log('debug', message, meta);
    }
  }

  info(message, meta = {}) {
    this._log('info', message, meta);
  }

  warn(message, meta = {}) {
    this._log('warn', message, meta);
  }

  error(message, meta = {}) {
    this._log('error', message, meta);
  }

  /**
   * Flush all pending logs
   */
  async flush() {
    this._flushSync();
    return new Promise(resolve => {
      setTimeout(resolve, 100);
    });
  }

  /**
   * Get logger stats
   */
  getStats() {
    return { ...this.stats };
  }
}

export const logger = new AsyncLogger();
