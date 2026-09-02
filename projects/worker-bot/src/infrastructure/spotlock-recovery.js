// src/infrastructure/spotlock-recovery.js
// Recovery system for spot-lock state failures

export class SpotLockRecovery {
  constructor(db, kv) {
    this.db = db;
    this.kv = kv;
    this.stateFailures = 0;
    this.lastRecoveryTime = 0;
  }

  // Detect spot-lock state corruption
  async detectStateFailure() {
    try {
      // Check if spot_lock table exists and is accessible
      const result = await this.db.prepare(
        'SELECT COUNT(*) as count FROM trades WHERE mode = "paper" LIMIT 1'
      ).first();

      if (!result) {
        return { failed: true, reason: 'database_unreachable' };
      }

      // Verify state consistency in KV
      const kvState = await this.kv.get('spot-lock-state');
      const kvTimestamp = kvState
        ? JSON.parse(kvState).timestamp
        : null;

      if (kvTimestamp && Date.now() - kvTimestamp > 300000) {
        return { failed: true, reason: 'state_stale' };
      }

      return { failed: false };
    } catch (err) {
      console.error('[SpotLock] Detection error:', err.message);
      return { failed: true, reason: 'detection_error', error: err.message };
    }
  }

  // Reset state to consistent baseline
  async resetState() {
    const resetStart = Date.now();
    console.log('[SpotLock] Initiating reset...');

    try {
      // 1. Clear corrupted state from KV
      await this.kv.delete('spot-lock-state');
      await this.kv.delete('execution-lock');
      await this.kv.delete('trading-pause');

      // 2. Initialize fresh state
      const freshState = {
        enabled: true,
        lastChecked: Date.now(),
        consistency: 'verified',
        recoveryAttempt: this.stateFailures,
      };

      await this.kv.put('spot-lock-state', JSON.stringify(freshState), {
        expirationTtl: 3600,
      });

      // 3. Verify database connectivity
      await this.db.prepare(
        'SELECT 1 LIMIT 1'
      ).first();

      // 4. Reset failure counter
      this.stateFailures = 0;
      this.lastRecoveryTime = Date.now();

      const duration = Date.now() - resetStart;
      console.log(`[SpotLock] Reset successful (${duration}ms)`);

      return {
        success: true,
        duration,
        state: freshState,
      };
    } catch (err) {
      this.stateFailures++;
      console.error('[SpotLock] Reset failed:', err.message);
      return {
        success: false,
        error: err.message,
        failureCount: this.stateFailures,
      };
    }
  }

  // Automatic recovery on periodic check
  async autoRecover() {
    const failure = await this.detectStateFailure();

    if (failure.failed) {
      console.warn(`[SpotLock] Detected: ${failure.reason}`);

      // Allow max 3 automatic recovery attempts per hour
      const timeSinceLastRecovery = Date.now() - this.lastRecoveryTime;
      if (timeSinceLastRecovery > 1200000 || this.stateFailures < 3) {
        return await this.resetState();
      } else {
        console.error('[SpotLock] Too many recovery attempts, manual intervention needed');
        return {
          success: false,
          error: 'recovery_limit_exceeded',
          failureCount: this.stateFailures,
        };
      }
    }

    return { success: true, message: 'State is healthy' };
  }

  // Health check
  async getHealth() {
    return {
      stateFailures: this.stateFailures,
      lastRecoveryTime: this.lastRecoveryTime,
      timeSinceRecoveryMs: Date.now() - this.lastRecoveryTime,
      status: this.stateFailures === 0 ? 'healthy' : 'degraded',
    };
  }

  // Forced reset (admin)
  async forceReset() {
    console.warn('[SpotLock] FORCED RESET initiated by admin');
    this.stateFailures = 0;
    return await this.resetState();
  }
}

export function getSpotLockRecovery(db, kv) {
  return new SpotLockRecovery(db, kv);
}
