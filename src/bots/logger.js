// Logger Bot — delegates to the D1 database event-logging layer
import { logBotEvent } from '../db.js';

/**
 * Persists an event to the D1 `bot_events` table.
 *
 * @param {object} env    — Cloudflare Worker env bindings
 * @param {object} config — bot config entry from config.json (unused, kept for interface compat)
 * @param {object} event  — event payload: { type: string, details?: object }
 * @returns {Promise<void>}
 */
export const logEvent = async (env, config, event = {}) => {
  const eventType = event.type || 'unknown';
  const details   = event.details ?? null;
  console.log(`[Logger] Event: ${eventType}`, details ?? '');
  await logBotEvent(env, eventType, details);
};
