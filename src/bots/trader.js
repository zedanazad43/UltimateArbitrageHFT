// Trader Bot — delegates to the exchange execution layer
import {
  hasExchangeCredentials,
  getExchangeBalance,
  placeExchangeMarketOrder,
  placeMarketOrderMEXC,
  placeMEXCFuturesOrder,
  hasSufficientUSDT,
  getRequiredCredentialKeys
} from '../exchange.js';

/**
 * Executes trades for a given set of signals (OpportunityObjects from the scanner).
 *
 * For each signal the trader:
 *  1. Validates that API credentials are configured for the required exchanges.
 *  2. Checks that sufficient balance exists on both legs before placing orders.
 *  3. Places both BUY and SELL legs simultaneously (CEX) or a single futures order (Perps).
 *
 * DEX signals are skipped in live mode (no on-chain bridge layer implemented yet).
 *
 * @param {object}   env     — Cloudflare Worker env bindings
 * @param {object}   config  — bot config entry from config.json (unused, kept for interface compat)
 * @param {Array}    signals — array of OpportunityObjects (output of scanMarkets / runScan)
 * @returns {Array}  results — array of { signal, status, error? } objects
 */
export const executeTrades = async (env, config, signals = []) => {
  console.log('[Trader] Executing trades for', signals.length, 'signal(s)...');
  const results = [];

  for (const signal of signals) {
    try {
      const result = await _executeOne(env, signal);
      console.log(`[Trader] ✅ Executed ${signal.symbol} ${signal.direction}`);
      results.push({ signal, status: 'ok', result });
    } catch (err) {
      console.error(`[Trader] ❌ Failed ${signal.symbol} ${signal.direction}: ${err.message}`);
      results.push({ signal, status: 'error', error: err.message });
    }
  }

  return results;
};

// ── Internal execution helper (mirrors orchestrator.executeTrade logic) ────────

async function _executeOne(env, opp) {
  // DEX cross-chain execution requires a bridge layer not yet implemented.
  if (opp.strategy === 'dex' || opp.buyExchange === '0x' || opp.sellExchange === '0x') {
    throw new Error('DEX execution not supported in live mode — use paper_trading=true');
  }

  const sizeUsd  = opp.sizeUsd  ?? 100;
  const leverage = opp.leverage ?? 1;
  const amount   = (sizeUsd / opp.buyPrice).toFixed(6);

  // ── Perpetuals ──────────────────────────────────────────────────────────────
  if (opp.isPerp) {
    if (!hasExchangeCredentials(env, 'mexc')) {
      throw new Error(
        `MEXC credentials required for perps trading. ` +
        `Missing: ${getRequiredCredentialKeys('mexc').join(', ')}`
      );
    }
    const sufficient = await hasSufficientUSDT(env, sizeUsd);
    if (!sufficient) {
      throw new Error(`Insufficient USDT on MEXC for $${sizeUsd.toFixed(2)} perps trade`);
    }
    // buyExchange === 'mexc_perp' → LONG (buying on perps); otherwise SELL leg is on perps → SHORT
    const side = opp.buyExchange === 'mexc_perp' ? 'LONG' : 'SHORT';
    return placeMEXCFuturesOrder(env, opp.symbol, side, amount, leverage);
  }

  // ── CEX spatial arbitrage ───────────────────────────────────────────────────
  const buyExch  = opp.buyExchange;
  const sellExch = opp.sellExchange;

  if (!hasExchangeCredentials(env, buyExch)) {
    throw new Error(
      `No credentials for buy exchange ${buyExch}. ` +
      `Required: ${getRequiredCredentialKeys(buyExch).join(', ')}`
    );
  }
  if (!hasExchangeCredentials(env, sellExch)) {
    throw new Error(
      `No credentials for sell exchange ${sellExch}. ` +
      `Required: ${getRequiredCredentialKeys(sellExch).join(', ')}`
    );
  }

  const baseAsset  = opp.symbol.replace(/USDT$/, '');
  const buyBalance = await getExchangeBalance(env, buyExch, 'USDT');
  if (buyBalance < sizeUsd) {
    throw new Error(
      `Insufficient USDT on ${buyExch}: ` +
      `$${buyBalance.toFixed(2)} available, $${sizeUsd.toFixed(2)} needed`
    );
  }
  const sellBalance = await getExchangeBalance(env, sellExch, baseAsset);
  if (sellBalance < parseFloat(amount)) {
    throw new Error(
      `Insufficient ${baseAsset} on ${sellExch}: ` +
      `${sellBalance.toFixed(6)} available, ${amount} needed`
    );
  }

  // Execute both legs simultaneously to minimise slippage.
  return Promise.all([
    placeExchangeMarketOrder(env, buyExch,  opp.symbol, 'BUY',  amount, sizeUsd),
    placeExchangeMarketOrder(env, sellExch, opp.symbol, 'SELL', amount, sizeUsd)
  ]);
}
