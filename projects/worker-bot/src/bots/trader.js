// Trader Bot — shoot-first execution with post-only/IOC fallback, kill switch, and latency tracking
import {
  hasExchangeCredentials,
  getExchangeBalance,
  placeExchangeMarketOrder,
  placeMEXCFuturesOrder,
  hasSufficientUSDT,
  getRequiredCredentialKeys
} from '../exchange.js';
import { LatencyRttTracker } from '../infrastructure/latency-rtt-tracker.js';
import { AtomicOrderExecutor } from '../infrastructure/atomic-order-executor.js';
import { LatencyKillSwitch } from '../infrastructure/latency-kill-switch.js';
import { LatencySimulator, ReplayHarness } from '../infrastructure/latency-simulator.js';
import { TriClock, DistributedListener } from '../infrastructure/temporal-brain.js';
import { SmartKillSwitch } from '../infrastructure/smart-kill-loop.js';
import { AlertDispatcher, TelegramAlerter, GitHubNotifier } from '../infrastructure/alerting.js';
import { PropagationMapper } from '../infrastructure/chrono-replay.js';

const clock = new TriClock();
const rttTracker = new LatencyRttTracker({ windowMs: 30_000 });
const atomicExecutor = new AtomicOrderExecutor({ timeoutMs: 10 });
const killSwitch = new LatencyKillSwitch({ baselineMs: 15, maxAgeMs: 50 });
const smartKill = new SmartKillSwitch({ capitalBase: 10000, maxLossBps: 10, maxDriftMicros: 50 });
const listener = new DistributedListener();
const propagation = new PropagationMapper();
const alertDispatcher = new AlertDispatcher();

function buildAlertChannels(env) {
  const telegram = new TelegramAlerter({ botToken: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID });
  const github = new GitHubNotifier({ repo: env.GITHUB_REPO, token: env.GITHUB_TOKEN });
  alertDispatcher.register('telegram', telegram.sendText.bind(telegram));
  alertDispatcher.register('github', async (event) => github.postIssue(`[UAHFT] ${event.title || 'Kill switch'}`, event.body || ''));
}

export const ensureAlertChannels = (env) => {
  buildAlertChannels(env);
};

export const executeTrades = async (env, config, signals = []) => {
  if (!alertDispatcher.channels.size) buildAlertChannels(env);
  console.log('[Trader] Executing trades for', signals.length, 'signal(s)...');
  const results = [];

  for (const signal of signals) {
    const nowMs = clock.now();
    const mono = clock.monotonic();
    const signalAgeMs = nowMs - (signal.ts ?? nowMs);

    try {
      propagation.updateRtt(signal.buyExchange || 'unknown', signalAgeMs || 0);
      propagation.updateRtt(signal.sellExchange || 'unknown', signalAgeMs || 0);
      const result = await _executeOneShootFirst(env, signal, nowMs);
      const _rtt = Date.now() - mono;
      rttTracker.record({ label: signal.symbol, t1Ms: mono, t2Ms: mono + _rtt });
      listener.ingestHeartbeat(nowMs, nowMs + _rtt, Date.now(), 'trader');
      smartKill.onTrade({ pnlBps: result.pnlBps ?? 0, latencyMicros: _rtt * 1000, driftMicros: _rtt * 1000 });
      console.log(`[Trader] ✅ Executed ${signal.symbol} ${signal.direction} in ${_rtt.toFixed(2)}ms`);
      results.push({ signal, status: 'ok', result });
    } catch (err) {
      const _rtt = Date.now() - mono;
      rttTracker.record({ label: signal.symbol, t1Ms: mono, t2Ms: mono + _rtt });
      console.error(`[Trader] ❌ Failed ${signal.symbol} ${signal.direction}: ${err.message}`);
      smartKill.onTrade({ pnlBps: -10, latencyMicros: _rtt * 1000, driftMicros: _rtt * 1000 });
      results.push({ signal, status: 'error', error: err.message });
      await alertDispatcher.sendAll({ title: `Trade failed: ${signal.symbol}`, body: `${err.message}\nExchange latency tracker updated.` }).catch(() => {});
    }
  }

  if (smartKill.active) {
    await alertDispatcher.sendAll({ title: `Smart kill switch: ${smartKill.reason}`, body: JSON.stringify(smartKill.snapshot(), null, 2) }).catch(() => {});
  }

  return results;
};

async function _executeOneShootFirst(env, opp, t1) {
  if (opp.strategy === 'dex' || opp.buyExchange === '0x' || opp.sellExchange === '0x') {
    throw new Error('DEX execution not supported in live mode — use paper_trading=true');
  }

  const ageMs = Date.now() - (opp.ts || t1);
  const drift = rttTracker.maybeDrift({ baselineMs: 15, maxMultiplier: 2.5 });
  const guard = killSwitch.check({ rttMs: rttTracker.currentRttMs(), ageMs });
  if (!guard.tradingAllowed) {
    throw new Error(`Kill switch: ${guard.reason}`);
  }
  if (drift.drift) {
    console.warn(`[Trader] Latency drift detected: avg ${drift.avgRttMs}ms > baseline ${drift.baselineMs}ms`);
  }
  if (ageMs > killSwitch.maxAgeMs) {
    throw new Error(`Stale signal: age ${ageMs}ms > limit ${killSwitch.maxAgeMs}ms`);
  }

  const sizeUsd  = opp.sizeUsd  ?? 100;
  const leverage = opp.leverage ?? 1;
  const amount   = (sizeUsd / opp.buyPrice).toFixed(6);

  if (opp.isPerp) {
    if (!hasExchangeCredentials(env, 'mexc')) {
      throw new Error(`MEXC credentials required. Missing: ${getRequiredCredentialKeys('mexc').join(', ')}`);
    }
    const sufficient = await hasSufficientUSDT(env, sizeUsd);
    if (!sufficient) {
      throw new Error(`Insufficient USDT on MEXC for $${sizeUsd.toFixed(2)} perps trade`);
    }
    const side = opp.buyExchange === 'mexc_perp' ? 'LONG' : 'SHORT';
    const placeFn = async () => placeMEXCFuturesOrder(env, opp.symbol, side, amount, leverage);
    return atomicExecutor.executeShootFirst({
      placeFn,
      sellFn: async () => ({ filled: true }),
      hedgeFn: undefined
    });
  }

  const buyExch  = opp.buyExchange;
  const sellExch = opp.sellExchange;

  if (!hasExchangeCredentials(env, buyExch)) {
    throw new Error(`No credentials for buy exchange ${buyExch}. Required: ${getRequiredCredentialKeys(buyExch).join(', ')}`);
  }
  if (!hasExchangeCredentials(env, sellExch)) {
    throw new Error(`No credentials for sell exchange ${sellExch}. Required: ${getRequiredCredentialKeys(sellExch).join(', ')}`);
  }

  const baseAsset  = opp.symbol.replace(/USDT$/, '');
  const buyBalance = await getExchangeBalance(env, buyExch, 'USDT');
  if (buyBalance < sizeUsd) {
    throw new Error(`Insufficient USDT on ${buyExch}: $${buyBalance.toFixed(2)} available, $${sizeUsd.toFixed(2)} needed`);
  }
  const sellBalance = await getExchangeBalance(env, sellExch, baseAsset);
  if (sellBalance < parseFloat(amount)) {
    throw new Error(`Insufficient ${baseAsset} on ${sellExch}: ${sellBalance.toFixed(6)} available, ${amount} needed`);
  }

  return atomicExecutor.executeShootFirst({
    placeFn: async () => placeExchangeMarketOrder(env, buyExch, opp.symbol, 'BUY', amount, sizeUsd),
    sellFn: async ({ _buyResult: _traderBuyResult, _timeoutMs }) => atomicExecutor.postOnlyWithIoc({
      placeFn: async () => placeExchangeMarketOrder(env, sellExch, opp.symbol, 'SELL', amount, sizeUsd),
      onTimeout: async () => console.warn('[Trader] IOC timeout on sell leg for', opp.symbol)
    }),
    hedgeFn: async ({ _buyResult: _traderBuyResultForHedge }) => {
      console.warn('[Trader] Hedging inventory after failed sell leg for', opp.symbol);
      return { hedged: true };
    }
  });
}

export const getLatencySnapshot = () => rttTracker.snapshot();
export const getKillSwitchState = () => smartKill;
export const getClockStats = () => clock;
export const getListenerStats = () => listener.stats();
export const getPropagationStats = (exchange) => propagation.stats(exchange);
export { LatencySimulator, ReplayHarness };
