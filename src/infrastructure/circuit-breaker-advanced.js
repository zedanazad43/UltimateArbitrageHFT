// Intelligent circuit breaker with auto-recovery for Railway failover

export class SmartCircuitBreaker {
  constructor(kv, name = 'hft-circuit') {
    this.kv = kv;
    this.name = name;
    this.states = {
      CLOSED: 'closed',      // Normal operation
      OPEN: 'open',          // Failing, reject requests
      HALF_OPEN: 'half-open', // Testing recovery
    };
    this.config = {
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 5000,
      resetTimeout: 60000, // 1 minute
    };
    this.state = this.states.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = 0;
  }

  async getState() {
    const stored = await this.kv.get(`${this.name}:state`);
    if (stored) {
      const data = JSON.parse(stored);
      this.state = data.state;
      this.failures = data.failures;
      this.successes = data.successes;
      this.lastFailureTime = data.lastFailureTime;
    }
    return this.state;
  }

  async setState(state, failures = 0, successes = 0) {
    this.state = state;
    this.failures = failures;
    this.successes = successes;
    await this.kv.put(
      `${this.name}:state`,
      JSON.stringify({
        state,
        failures,
        successes,
        lastFailureTime: this.lastFailureTime,
        changedAt: Date.now(),
      }),
      { expirationTtl: 3600 } // 1 hour TTL
    );
  }

  async canExecute() {
    await this.getState();

    if (this.state === this.states.CLOSED) {
      return true; // Normal operation
    }

    if (this.state === this.states.OPEN) {
      // Check if enough time has passed to attempt recovery
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure > this.config.resetTimeout) {
        await this.setState(this.states.HALF_OPEN, 0, 0);
        return true; // Try one request
      }
      return false; // Still in open state
    }

    if (this.state === this.states.HALF_OPEN) {
      return true; // Allow test request
    }

    return false;
  }

  async recordSuccess() {
    await this.getState();

    if (this.state === this.states.CLOSED) {
      // Already good, just update success count
      this.successes = Math.min(this.successes + 1, this.config.successThreshold);
      await this.setState(this.states.CLOSED, 0, this.successes);
      return;
    }

    if (this.state === this.states.HALF_OPEN) {
      this.successes++;
      if (this.successes >= this.config.successThreshold) {
        // Recovered! Return to closed state
        await this.setState(this.states.CLOSED, 0, 0);
      } else {
        await this.setState(this.states.HALF_OPEN, 0, this.successes);
      }
      return;
    }
  }

  async recordFailure() {
    await this.getState();
    this.lastFailureTime = Date.now();
    this.failures++;

    if (this.state === this.states.CLOSED) {
      if (this.failures >= this.config.failureThreshold) {
        // Trip the circuit
        await this.setState(this.states.OPEN, this.failures, 0);
        return { state: this.states.OPEN, message: 'Circuit breaker OPEN' };
      } else {
        await this.setState(this.states.CLOSED, this.failures, 0);
        return { state: this.states.CLOSED, failures: this.failures };
      }
    }

    if (this.state === this.states.HALF_OPEN) {
      // Immediate open, recovery failed
      await this.setState(this.states.OPEN, this.failures, 0);
      return { state: this.states.OPEN, message: 'Recovery failed, circuit OPEN' };
    }

    return { state: this.state };
  }

  async getStatus() {
    await this.getState();
    const timeSinceFailure = this.lastFailureTime
      ? Date.now() - this.lastFailureTime
      : null;

    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      canExecute: await this.canExecute(),
      lastFailureMs: timeSinceFailure,
      resetInMs:
        this.state === this.states.OPEN
          ? Math.max(0, this.config.resetTimeout - timeSinceFailure)
          : 0,
    };
  }

  async reset() {
    await this.setState(this.states.CLOSED, 0, 0);
    this.lastFailureTime = 0;
  }
}

// Helper function to execute with circuit breaker protection
export async function executeWithCircuitBreaker(
  breaker,
  fn,
  fallback = null
) {
  const canExecute = await breaker.canExecute();

  if (!canExecute) {
    // Circuit is open, use fallback
    if (fallback) {
      return { success: false, fallback: true, result: await fallback() };
    }
    return { success: false, circuitOpen: true };
  }

  try {
    const result = await Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), breaker.config.timeout)
      ),
    ]);

    await breaker.recordSuccess();
    return { success: true, result };
  } catch (error) {
    const status = await breaker.recordFailure();
    if (fallback && status.state === this.states.OPEN) {
      return {
        success: false,
        error: error.message,
        fallback: true,
        result: await fallback(),
      };
    }
    return { success: false, error: error.message };
  }
}
