// Scanner Bot — delegates to the Nexus orchestrator scan engine
import { runScan } from '../orchestrator.js';

/**
 * Runs one full market-scan cycle (CEX + DEX + Perps) and returns the result.
 *
 * @param {object}   env      — Cloudflare Worker env bindings
 * @param {object}   config   — bot config entry from config.json (unused, kept for interface compat)
 * @param {object}   state    — current trading_state from KV (mutated in place by runScan)
 * @param {function} [notify] — async (env, msg) => void  Telegram alert helper (optional)
 * @returns {object|null}  trade result from runScan, or null when no opportunity found
 */
export const scanMarkets = async (env, config, state = {}, notify = async () => {}) => {
  console.log('[Scanner] Starting market scan (CEX + DEX + Perps)...');
  const result = await runScan(env, state, notify, {
    source: 'scanner_bot',
    trigger: 'src/bots/scanner.js',
  });
  if (result) {
    const opp = result.opportunity;
    console.log(
      `[Scanner] Opportunity found: [${opp.strategy.toUpperCase()}] ${opp.symbol}` +
      ` ${opp.direction} net ${opp.netPct.toFixed(4)}% size $${result.sizeUsd.toFixed(2)}`
    );
  } else {
    console.log('[Scanner] No profitable opportunities found in this cycle.');
  }
  return result;
};
