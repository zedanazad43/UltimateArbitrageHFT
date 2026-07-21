import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TopologyMap, TriClock, DistributedListener } from '../src/infrastructure/temporal-brain.js';
import { PropagationMapper, MarketMakerDissector, ChronoReplay } from '../src/infrastructure/chrono-replay.js';
import { SmartKillSwitch, UltraFastDecisionLoop, ContinuousRLLoop } from '../src/infrastructure/smart-kill-loop.js';
import { AlertDispatcher as _AlertDispatcher, TelegramAlerter, GitHubNotifier } from '../src/infrastructure/alerting.js';

describe('TopologyMap', () => {
  test('records a successful measurement', async () => {
    const map = new TopologyMap();
    const entry = await map.measure('https://api.mexc.com/api/v3/ping', 1000);
    assert.ok(entry.timestamp > 0);
    assert.ok(typeof entry.rtt === 'number' || entry.status === 'ERR');
  });

  test('alerts when thresholds exceeded', async () => {
    const map = new TopologyMap();
    map.samples.set('https://london.cloudflare.com', { rtt: 20, status: 200, endpoint: 'https://london.cloudflare.com' });
    map.samples.set('https://fra.cloudflare.com/cdn-cgi/trace', { rtt: 5, status: 200, endpoint: 'https://fra.cloudflare.com/cdn-cgi/trace' });
    const alerts = map.alerts();
    assert.ok(alerts.some(a => a.includes('cfLondon')));
    assert.ok(!alerts.some(a => a.includes('cfFrankfurt')));
  });
});

describe('TriClock', () => {
  test('returns monotonically increasing values', () => {
    const c = new TriClock();
    const a = c.now();
    const b = c.now();
    assert.ok(b >= a);
  });

  test('applies Kalman offset smoothly', () => {
    const c = new TriClock();
    const first = c.applyKalman(10);
    const second = c.applyKalman(5);
    assert.ok(typeof first === 'number');
    assert.ok(typeof second === 'number');
  });
});

describe('DistributedListener', () => {
  test('calculates drift and stores bounded heartbeats', () => {
    const dl = new DistributedListener();
    for (let i = 0; i < 140; i++) dl.ingestHeartbeat(i, i + 3, i + 7, 'cf');
    assert.equal(dl.heartbeats.length, 128);
    const stats = dl.stats();
    assert.ok(stats.maxDriftMs >= stats.avgDriftMs);
  });
});

describe('PropagationMapper', () => {
  test('returns empty stats for unknown exchange', () => {
    const pm = new PropagationMapper();
    const stats = pm.stats('unknown');
    assert.equal(stats.count, 0);
    assert.equal(stats.avgMs, 0);
  });

  test('updates rolling RTT history up to max length', () => {
    const pm = new PropagationMapper();
    for (let i = 0; i < 600; i++) pm.updateRtt('binance', i);
    const stats = pm.stats('binance');
    assert.ok(stats.count <= 512);
  });
});

describe('MarketMakerDissector', () => {
  test('returns unknown until enough moves sampled', () => {
    const md = new MarketMakerDissector();
    assert.equal(md.classify('binance', 'BTCUSDT'), 'unknown');
  });

  test('classifies fast after enough top updates with low latency', () => {
    const md = new MarketMakerDissector();
    for (let i = 0; i < 30; i++) md.recordMove('binance', 'BTCUSDT', 5, true);
    assert.equal(md.get('binance', 'BTCUSDT'), 'fast');
  });
});

describe('ChronoReplay', () => {
  test('returns zeros when no ticks for dateKey', async () => {
    const cr = new ChronoReplay({});
    const result = await cr.simulate('2026-07-20');
    assert.equal(result.simulated, 0);
    assert.equal(result.winRate, 0);
  });
});

describe('SmartKillSwitch', () => {
  test('triggers when loss exceeds threshold', () => {
    const k = new SmartKillSwitch({ capitalBase: 10000, maxLossBps: 10 });
    k.onTrade({ pnlBps: -15, latencyMicros: 100, driftMicros: 10 });
    assert.equal(k.active, true);
    assert.ok(String(k.reason).includes('LOSS'));
  });

  test('resets active state', () => {
    const k = new SmartKillSwitch({});
    k.onTrade({ pnlBps: -100, latencyMicros: 100, driftMicros: 10 });
    k.reset();
    assert.equal(k.active, false);
  });

  test('invokes listener on trigger', () => {
    const k = new SmartKillSwitch({});
    let got = null;
    k.subscribe(snap => { got = snap.active; });
    k.onTrade({ pnlBps: -20, latencyMicros: 100, driftMicros: 1000 });
    assert.equal(got, true);
    k.reset();
    assert.equal(got, true);
  });
});

describe('UltraFastDecisionLoop', () => {
  test('rejects stale signal when age >= expected RTT', () => {
    const loop = new UltraFastDecisionLoop({ checkWindowMs: 100, maxRejectAgeMs: 20 });
    const r = loop.decide(null, { t2: 50, t1: 0, hasSlowMaker: true, expectedRttMs: 30 });
    assert.equal(r.reject, true);
    assert.equal(r.reason, 'rtt_not_profitable');
  });

  test('rejects when no slow maker', () => {
    const loop = new UltraFastDecisionLoop();
    const r = loop.decide(null, { t2: 1, t1: 0, hasSlowMaker: false, expectedRttMs: 100 });
    assert.equal(r.reject, true);
    assert.equal(r.reason, 'no_slow_maker');
  });
});

describe('ContinuousRLLoop', () => {
  test('returns accuracy counts', () => {
    const rl = new ContinuousRLLoop({ intervalMs: 1000 });
    rl.classify({ timely: 10, slippage: 2 });
    const s = rl.step();
    assert.ok(s.accuracy > 0);
    assert.equal(s.timely, 10);
  });
});

describe('TelegramAlerter', () => {
  test('skips send when botToken is missing', async () => {
    const alerter = new TelegramAlerter({});
    const r = await alerter.sendText('hi')();
    assert.ok(r.skipped);
  });
});

describe('GitHubNotifier', () => {
  test('returns skipped result when repo/token missing', async () => {
    const g = new GitHubNotifier({});
    const r = await g.sendMessage('t', 'b');
    assert.equal(r.skipped, true);
  });
});
