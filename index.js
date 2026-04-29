// ===== NEXUS ARBITRAGE HUB — Final Integrated Bot =====
// Entry point: ultimate-arbitrage-hft Cloudflare Worker
// Integrates: CEX + DEX + Perps strategies, admin dashboard, Telegram bot

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { renderDashboard, renderChecklist } from './src/dashboard.js';
import { runScan } from './src/orchestrator.js';
import { logAdminEvent, logBotEvent, getRecentTrades, getStrategyPnL, getPerformanceMetrics, exportTrades } from './src/db.js';
import { hasExchangeCredentials, getExchangeBalance } from './src/exchange.js';


// ─── Telegram notification helper ────────────────────────────────────────────
async function sendTelegramAlert(env, message) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown' })
    });
    await resp.body?.cancel();
  } catch (_) {}
}

// ─── State helpers ────────────────────────────────────────────────────────────
const DEFAULT_STATE = {
  trading_enabled: false,
  paper_trading: true,
  daily_pnl: 0, daily_trades: 0,
  total_pnl: 0, total_trades: 0,
  initial_capital: 1000,
  max_daily_loss_usd: 25,
  min_seconds_between_trades: 30,
  max_per_trade_loss_pct: 0.02,
  max_spread_pct: 5.0,
  win_rate: 0.55,
  risk_reward_ratio: 2.0
};

async function getState(env) {
  return await env.BOT_STATE.get('trading_state', 'json').catch((err) => {
    console.error('KV getState error:', err?.message);
    return null;
  }) || { ...DEFAULT_STATE };
}

async function saveState(env, state) {
  await env.BOT_STATE.put('trading_state', JSON.stringify(state));
}

// ─── Admin auth ───────────────────────────────────────────────────────────────
// ADMIN_TOKEN must be set as a Cloudflare Worker secret (`wrangler secret put ADMIN_TOKEN`).
// If it is absent the endpoint is denied — this prevents accidental exposure of admin
// controls on a freshly-deployed worker that has not yet had secrets configured.
function isAuthorized(env, c) {
  const token = env.ADMIN_TOKEN;
  if (!token) return false;
  return c.req.header('x-admin-token') === token;
}

// ─── Rate limiter helper ──────────────────────────────────────────────────────
// Uses the RATE_LIMITER binding (Cloudflare Rate Limiting API).
// Returns a 429 response if the caller has exceeded the configured threshold;
// returns null when the request may proceed.
// Gracefully skips rate limiting when the binding is absent (local dev).
async function checkRateLimit(env, c) {
  if (!env.RATE_LIMITER) return null;
  try {
    const key = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
    const { success } = await env.RATE_LIMITER.limit({ key });
    if (!success) return c.text('Too Many Requests', 429);
  } catch (e) {
    console.error('[RateLimit] error:', e.message);
  }
  return null;
}

// ─── Durable Object: MarketStreamer ───────────────────────────────────────────
export class MarketStreamer {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.prices = {};
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/price') {
      const symbol = url.searchParams.get('symbol') || 'BTCUSDT';
      const price = this.prices[symbol] || 0;
      return Response.json({ price });
    }
    if (url.pathname === '/update' && request.method === 'POST') {
      const { symbol, price } = await request.json();
      if (symbol && price) this.prices[symbol] = price;
      return Response.json({ ok: true });
    }
    return new Response('MarketStreamer OK');
  }
}

// ─── Hono App ─────────────────────────────────────────────────────────────────
const app = new Hono();
app.use('*', cors());

// ── Dashboard routes ──────────────────────────────────────────────────────────
app.get('/', async (c) => renderDashboard(c.env));
app.get('/dashboard', async (c) => renderDashboard(c.env));
app.get('/checklist', async (c) => renderChecklist(c.env));

// ── Admin: Start ──────────────────────────────────────────────────────────────
app.get('/start', async (c) => {
  const limited = await checkRateLimit(c.env, c);
  if (limited) return limited;
  if (!isAuthorized(c.env, c)) return c.text('Unauthorized', 401);
  const state = await getState(c.env);
  state.trading_enabled = true;
  state.auto_stopped = false;
  state.auto_stop_reason = null;
  await saveState(c.env, state);
  await logAdminEvent(c.env, 'start', c.req.raw);
  await sendTelegramAlert(c.env, '▶️ *تم تشغيل نظام Nexus Arbitrage Hub*');
  return c.text('✅ تم تشغيل التداول');
});

// ── Admin: Stop ───────────────────────────────────────────────────────────────
app.get('/stop', async (c) => {
  const limited = await checkRateLimit(c.env, c);
  if (limited) return limited;
  if (!isAuthorized(c.env, c)) return c.text('Unauthorized', 401);
  const state = await getState(c.env);
  state.trading_enabled = false;
  await saveState(c.env, state);
  await logAdminEvent(c.env, 'stop', c.req.raw);
  await sendTelegramAlert(c.env, '⏸️ *تم إيقاف نظام Nexus Arbitrage Hub*');
  return c.text('✅ تم إيقاف التداول');
});

// ── Admin: Immediate scan ─────────────────────────────────────────────────────
app.get('/scan', async (c) => {
  const limited = await checkRateLimit(c.env, c);
  if (limited) return limited;
  if (!isAuthorized(c.env, c)) return c.text('Unauthorized', 401);
  const state = await getState(c.env);
  const result = await runScan(c.env, state, sendTelegramAlert);
  await saveState(c.env, state);
  if (result) {
    const opp = result.opportunity;
    return c.text(
      `✅ مسح اكتمل — أفضل فرصة:\n` +
      `${opp.symbol} [${opp.strategy.toUpperCase()}] ${opp.direction}\n` +
      `صافي: ${opp.netPct.toFixed(4)}%  |  حجم: $${result.sizeUsd.toFixed(2)}`
    );
  }
  return c.text('✅ مسح اكتمل — لا توجد فرص مربحة حالياً');
});

// ── Admin: Set mode Paper ─────────────────────────────────────────────────────
app.post('/mode/paper', async (c) => {
  const limited = await checkRateLimit(c.env, c);
  if (limited) return limited;
  if (!isAuthorized(c.env, c)) return c.text('Unauthorized', 401);
  const state = await getState(c.env);
  state.paper_trading = true;
  await saveState(c.env, state);
  await logAdminEvent(c.env, 'mode:paper', c.req.raw);
  await sendTelegramAlert(c.env, '📄 *تم التبديل إلى وضع Paper Trading*');
  return c.text('✅ وضع Paper مفعّل');
});

// ── Admin: Set mode Live ──────────────────────────────────────────────────────
app.post('/mode/live', async (c) => {
  const limited = await checkRateLimit(c.env, c);
  if (limited) return limited;
  if (!isAuthorized(c.env, c)) return c.text('Unauthorized', 401);
  const state = await getState(c.env);
  state.paper_trading = false;
  await saveState(c.env, state);
  await logAdminEvent(c.env, 'mode:live', c.req.raw);
  await sendTelegramAlert(c.env, '🔴 *تم التبديل إلى وضع Live Trading — تنفيذ حقيقي*');
  return c.text('✅ وضع Live مفعّل');
});

// ── Admin: Save config ────────────────────────────────────────────────────────
app.post('/config', async (c) => {
  const limited = await checkRateLimit(c.env, c);
  if (limited) return limited;
  if (!isAuthorized(c.env, c)) return c.text('Unauthorized', 401);
  let body;
  try { body = await c.req.json(); } catch (_) { return c.text('Invalid JSON', 400); }
  const state = await getState(c.env);
  const num = (v) => (typeof v === 'number' && v > 0 ? v : undefined);
  if (num(body.max_daily_loss_usd))           state.max_daily_loss_usd           = body.max_daily_loss_usd;
  if (num(body.max_per_trade_loss_pct))       state.max_per_trade_loss_pct       = body.max_per_trade_loss_pct;
  if (num(body.min_seconds_between_trades))   state.min_seconds_between_trades   = body.min_seconds_between_trades;
  if (num(body.initial_capital))              state.initial_capital              = body.initial_capital;
  if (num(body.max_spread_pct))               state.max_spread_pct               = body.max_spread_pct;
  if (num(body.win_rate))                     state.win_rate                     = body.win_rate;
  if (num(body.risk_reward_ratio))            state.risk_reward_ratio            = body.risk_reward_ratio;
  await saveState(c.env, state);
  await logAdminEvent(c.env, 'config', c.req.raw);
  return c.text('✅ تم حفظ الإعدادات');
});

// ── API: Bot status ───────────────────────────────────────────────────────────
app.get('/api/status', async (c) => {
  const [state, lastScan, circuitBreaker] = await Promise.all([
    getState(c.env),
    c.env.BOT_STATE.get('nexus_last_scan', 'json').catch(() => null),
    c.env.BOT_STATE.get('nexus_circuit_breaker', 'json').catch(() => null)
  ]);
  return c.json({ ...state, lastScan, circuitBreaker: circuitBreaker || {} });
});

// ── API: Recent trades ────────────────────────────────────────────────────────
app.get('/api/trades', async (c) => {
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const trades = await getRecentTrades(c.env, Math.min(limit, 100));
  return c.json({ success: true, data: trades });
});

// ── API: Strategy P&L ─────────────────────────────────────────────────────────
app.get('/api/pnl', async (c) => {
  const pnl = await getStrategyPnL(c.env);
  return c.json({ success: true, data: pnl });
});

// ── API: Performance report ───────────────────────────────────────────────────
app.get('/api/report', async (c) => {
  const from   = c.req.query('from');
  const to     = c.req.query('to');
  const fromMs = from ? new Date(from).getTime() : 0;
  const toMs   = to   ? new Date(to).getTime()   : Date.now();
  if (isNaN(fromMs) || isNaN(toMs)) return c.json({ error: 'Invalid date parameters' }, 400);
  const metrics = await getPerformanceMetrics(c.env, fromMs, toMs);
  return c.json({ success: true, data: metrics });
});

// ── API: Exchange balances (auth-protected) ───────────────────────────────────
app.get('/api/balances', async (c) => {
  if (!isAuthorized(c.env, c)) return c.json({ error: 'Unauthorized' }, 401);
  const EXCHANGES = ['mexc', 'binance', 'kucoin', 'okx', 'bitget', 'bitmart'];
  const results = await Promise.all(
    EXCHANGES.map(async (ex) => {
      const configured = hasExchangeCredentials(c.env, ex);
      if (!configured) return { exchange: ex, configured: false, balance: null };
      const balance = await getExchangeBalance(c.env, ex, 'USDT');
      return { exchange: ex, configured: true, balance };
    })
  );
  return c.json({ success: true, data: results });
});

// ── Admin: Reset daily stats ──────────────────────────────────────────────────
app.post('/reset-daily', async (c) => {
  const limited = await checkRateLimit(c.env, c);
  if (limited) return limited;
  if (!isAuthorized(c.env, c)) return c.text('Unauthorized', 401);
  const state = await getState(c.env);
  state.daily_pnl    = 0;
  state.daily_trades = 0;
  state.last_daily_reset = Date.now();
  if (state.auto_stopped) {
    state.auto_stopped      = false;
    state.auto_stop_reason  = null;
  }
  await saveState(c.env, state);
  await logAdminEvent(c.env, 'reset-daily', c.req.raw);
  await sendTelegramAlert(c.env, '🔄 *تم إعادة تعيين إحصائيات اليوم يدوياً*');
  return c.text('✅ تم إعادة تعيين إحصائيات اليوم');
});

// ── API: CSV export — also archives to R2 ────────────────────────────────────
app.get('/api/export', async (c) => {
  const from   = c.req.query('from');
  const to     = c.req.query('to');
  const fromMs = from ? new Date(from).getTime() : 0;
  const toMs   = to   ? new Date(to).getTime()   : Date.now();
  if (isNaN(fromMs) || isNaN(toMs)) return c.text('Invalid date parameters', 400);
  const trades = await exportTrades(c.env, fromMs, toMs);
  const headers = ['id', 'strategy', 'size_usd', 'net_profit_percent', 'mode', 'created_at'];
  const rows = trades.map(t =>
    headers.map(h => {
      const v = t[h] ?? '';
      // Quote fields that contain commas or quotes
      const s = String(v);
      return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')
  );
  const csv = [headers.join(','), ...rows].join('\r\n');
  const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Archive to R2 (non-blocking — failure does not affect the download)
  if (c.env.TRADE_LOGS) {
    try {
      const key = `exports/${dateStr}-${Date.now()}.csv`;
      await c.env.TRADE_LOGS.put(key, csv, {
        httpMetadata: { contentType: 'text/csv; charset=utf-8' },
        customMetadata: { from: String(fromMs), to: String(toMs), rows: String(trades.length) },
      });
    } catch (e) {
      console.error('[R2] export archive error:', e.message);
    }
  }

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="trades-${dateStr}.csv"`
    }
  });
});

// ── API: R2 log archive listing ───────────────────────────────────────────────
// Returns a paginated list of CSV archives stored in the TRADE_LOGS R2 bucket.
// Accepts optional `?prefix=` query parameter (default: "exports/").
app.get('/api/logs', async (c) => {
  if (!c.env.TRADE_LOGS) return c.json({ error: 'R2 binding not configured' }, 503);
  const prefix = c.req.query('prefix') || 'exports/';
  const cursor = c.req.query('cursor') || undefined;
  try {
    const list = await c.env.TRADE_LOGS.list({ prefix, cursor, limit: 50 });
    return c.json({
      success: true,
      objects: list.objects.map(o => ({
        key: o.key,
        size: o.size,
        uploaded: o.uploaded,
        customMetadata: o.customMetadata,
      })),
      truncated: list.truncated,
      cursor: list.cursor,
    });
  } catch (e) {
    console.error('[R2] list error:', e.message);
    return c.json({ error: 'Failed to list log archives' }, 500);
  }
});

// ── API: Workers AI — opportunity analysis ────────────────────────────────────
// Accepts a JSON body with an `opportunity` object and returns an AI-generated
// short analysis and recommendation in Arabic.
// Body: { opportunity: { symbol, strategy, direction, buyPrice, sellPrice, netPct } }
app.post('/api/ai-analysis', async (c) => {
  if (!isAuthorized(c.env, c)) return c.json({ error: 'Unauthorized' }, 401);
  if (!c.env.AI) return c.json({ error: 'Workers AI binding not configured' }, 503);

  let body;
  try { body = await c.req.json(); } catch (_) { return c.json({ error: 'Invalid JSON' }, 400); }

  const opp = body?.opportunity;
  if (!opp) return c.json({ error: 'Missing opportunity field' }, 400);

  const prompt =
    `You are a professional crypto arbitrage analyst. Analyze this opportunity briefly (2-3 sentences) and give a buy/skip recommendation.\n` +
    `Pair: ${opp.symbol}\n` +
    `Strategy: ${opp.strategy?.toUpperCase()}\n` +
    `Direction: ${opp.direction}\n` +
    `Buy price: $${Number(opp.buyPrice).toFixed(6)}\n` +
    `Sell price: $${Number(opp.sellPrice).toFixed(6)}\n` +
    `Net profit: ${Number(opp.netPct).toFixed(4)}%\n` +
    `Respond in Arabic only.`;

  try {
    const result = await c.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 256,
    });
    const analysis = result?.response ?? result?.text ?? (typeof result === 'string' ? result : JSON.stringify(result));
    return c.json({ success: true, analysis });
  } catch (e) {
    console.error('[AI] run error:', e.message);
    return c.json({ error: 'AI analysis failed', detail: e.message }, 500);
  }
});

// ── API: Version metadata ─────────────────────────────────────────────────────
// Exposes the current Worker deployment version, tag, and timestamp.
app.get('/api/version', (c) => {
  const v = c.env.VERSION;
  return c.json({
    id:        v?.id        ?? null,
    tag:       v?.tag       ?? null,
    timestamp: v?.timestamp ?? null,
    worker:    'ultimate-arbitrage-hft',
  });
});

// ── Telegram webhook ──────────────────────────────────────────────────────────
app.post('/telegram/webhook', async (c) => {
  // Validate the optional webhook secret set via `wrangler secret put TELEGRAM_WEBHOOK_SECRET`
  // and passed to Telegram during setWebhook as the `secret_token` parameter.
  const expectedSecret = c.env.TELEGRAM_WEBHOOK_SECRET;
  if (expectedSecret) {
    const provided = c.req.header('X-Telegram-Bot-Api-Secret-Token');
    if (provided !== expectedSecret) return c.json({ ok: false }, 401);
  }

  const body = await c.req.json().catch((err) => {
    console.error('Telegram webhook JSON parse error:', err?.message);
    return {};
  });
  const msg = body.message || body.edited_message;
  if (!msg) return c.json({ ok: true });

  const chatId = msg.chat.id;
  const text = msg.text || '';
  const token = c.env.TELEGRAM_BOT_TOKEN;
  if (!token) return c.json({ ok: true });

  const send = async (txt) => {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: txt, parse_mode: 'Markdown' })
    });
    await resp.body?.cancel();
  };

  const cmd = text.trim().split(/\s+/)[0].toLowerCase();
  const state = await getState(c.env);

  try {
    if (cmd === '/start' || cmd === '/help') {
      await send(
        `🔷 *Nexus Arbitrage Hub*\n\n` +
        `📊 الاستراتيجيات: CEX + DEX + Perps\n` +
        `🏦 المنصات: MEXC, Binance, KuCoin, OKX, Bitget, Bitmart\n\n` +
        `⚡ *الأوامر:*\n` +
        `/status — حالة البوت والإحصائيات\n` +
        `/scan — مسح فوري للفرص\n` +
        `/start\\_trading — تشغيل التداول التلقائي\n` +
        `/stop\\_trading — إيقاف التداول التلقائي\n` +
        `/pnl — الأرباح حسب الاستراتيجية\n` +
        `/mode — الوضع الحالي (Paper/Live)\n` +
        `/help — قائمة الأوامر`
      );
    } else if (cmd === '/status') {
      const equity = (state.initial_capital || 1000) + (state.total_pnl || 0);
      const lastScan = await c.env.BOT_STATE.get('nexus_last_scan', 'json').catch(() => null);
      await send(
        `⚙️ *حالة Nexus Hub*\n\n` +
        `الوضع: ${state.paper_trading !== false ? '📄 Paper' : '🔴 Live'}\n` +
        `التداول: ${state.trading_enabled ? '✅ مفعّل' : '❌ متوقف'}\n` +
        `${state.auto_stopped ? `🛑 إيقاف تلقائي: ${state.auto_stop_reason}\n` : ''}` +
        `💰 رأس المال: $${equity.toFixed(2)}\n` +
        `📈 إجمالي الأرباح: $${(state.total_pnl || 0).toFixed(2)}\n` +
        `📊 ربح اليوم: $${(state.daily_pnl || 0).toFixed(2)}\n` +
        `🎯 صفقات اليوم: ${state.daily_trades || 0}\n` +
        `📊 إجمالي الصفقات: ${state.total_trades || 0}\n` +
        (lastScan ? `🕐 آخر مسح: ${new Date(lastScan.timestamp).toLocaleString('ar')}` : '🕐 لم يتم المسح بعد')
      );
    } else if (cmd === '/scan') {
      await send('🔍 جاري المسح عبر CEX + DEX + Perps...');
      const result = await runScan(c.env, state, sendTelegramAlert);
      await saveState(c.env, state);
      if (result) {
        const opp = result.opportunity;
        await send(
          `🎯 *أفضل فرصة وُجدت:*\n\n` +
          `الزوج: *${opp.symbol}*\n` +
          `الاستراتيجية: ${opp.strategy.toUpperCase()}\n` +
          `الاتجاه: ${opp.direction}\n` +
          `شراء: $${Number(opp.buyPrice).toFixed(4)}\n` +
          `بيع: $${Number(opp.sellPrice).toFixed(4)}\n` +
          `صافي الربح: *${opp.netPct.toFixed(4)}%*\n` +
          `معامل الأمان: ${(opp.safetyFactor * 100).toFixed(1)}%\n` +
          `الحجم: $${result.sizeUsd.toFixed(2)}`
        );
      } else {
        await send('ℹ️ لا توجد فرص مربحة عند الحد الحالي');
      }
    } else if (cmd === '/start_trading') {
      state.trading_enabled = true;
      state.auto_stopped = false;
      state.auto_stop_reason = null;
      await saveState(c.env, state);
      await send('▶️ *تم تشغيل التداول التلقائي* ✅');
    } else if (cmd === '/stop_trading') {
      state.trading_enabled = false;
      await saveState(c.env, state);
      await send('⏸️ *تم إيقاف التداول التلقائي*');
    } else if (cmd === '/pnl') {
      const pnl = await getStrategyPnL(c.env);
      await send(
        `📊 *الأرباح حسب الاستراتيجية:*\n\n` +
        `📈 CEX: $${pnl.cex.pnl.toFixed(2)} (${pnl.cex.trades} صفقة)\n` +
        `🌐 DEX: $${pnl.dex.pnl.toFixed(2)} (${pnl.dex.trades} صفقة)\n` +
        `⚡ Perps: $${pnl.perps.pnl.toFixed(2)} (${pnl.perps.trades} صفقة)\n` +
        `──────────────────\n` +
        `💰 الإجمالي: $${(state.total_pnl || 0).toFixed(2)}`
      );
    } else if (cmd === '/mode') {
      await send(
        `🎛️ *وضع التداول الحالي:*\n` +
        `${state.paper_trading !== false ? '📄 Paper Trading (تجريبي)' : '🔴 Live Trading (حقيقي)'}\n\n` +
        `لتغيير الوضع استخدم لوحة التحكم على الإنترنت`
      );
    }
  } catch (err) {
    await send(`⚠️ خطأ: ${err.message}`).catch(() => {});
  }
  return c.json({ ok: true });
});

// ── Manual cron trigger ───────────────────────────────────────────────────────
app.get('/cron', async (c) => {
  const result = await runScheduledCycle(c.env);
  return c.json({ success: true, result: result ? 'trade executed' : 'no trade' });
});

// ─── Scheduled cron cycle ─────────────────────────────────────────────────────
async function runScheduledCycle(env) {
  const state = await getState(env);

  if (!state.trading_enabled) {
    console.log('🔕 Nexus: التداول معطّل');
    return null;
  }

  // Daily reset (every 24 h)
  const now = Date.now();
  if (now - (state.last_daily_reset || 0) > 86_400_000) {
    // Send daily summary before resetting counters
    await sendDailyReport(env, state);

    state.daily_pnl = 0;
    state.daily_trades = 0;
    state.last_daily_reset = now;
    if (state.auto_stopped) {
      state.auto_stopped = false;
      state.auto_stop_reason = null;
      await logBotEvent(env, 'daily_reset', { reset_time: now });
    }
  }

  // Auto-stop guard
  if (state.auto_stopped) {
    console.log('🛑 Nexus: إيقاف تلقائي نشط —', state.auto_stop_reason);
    return null;
  }

  const maxDailyLoss = state.max_daily_loss_usd || 25;
  if (state.daily_pnl <= -maxDailyLoss) {
    state.auto_stopped = true;
    state.auto_stop_reason = `تجاوز حد الخسارة اليومية $${maxDailyLoss}`;
    await saveState(env, state);
    await logBotEvent(env, 'auto_stop', { reason: state.auto_stop_reason });
    await sendTelegramAlert(env, `🛑 *إيقاف تلقائي*\n${state.auto_stop_reason}`);
    return null;
  }

  // Throttle: enforce a minimum gap between consecutive trades to prevent
  // over-trading and allow market prices to settle between executions.
  const minMs = (state.min_seconds_between_trades || 30) * 1000;
  if (state.last_trade_timestamp && now - state.last_trade_timestamp < minMs) {
    return null;
  }

  const result = await runScan(env, state, sendTelegramAlert);
  await saveState(env, state);
  return result;
}

// ─── Daily summary Telegram report ───────────────────────────────────────────
async function sendDailyReport(env, state) {
  try {
    const metrics = await getPerformanceMetrics(
      env,
      (state.last_daily_reset || 0),
      Date.now()
    );
    const equity = (state.initial_capital || 1000) + (state.total_pnl || 0);
    const msg =
      `📊 *التقرير اليومي — Nexus Hub*\n\n` +
      `💰 رأس المال الحالي: $${equity.toFixed(2)}\n` +
      `📈 ربح اليوم: $${(state.daily_pnl || 0).toFixed(2)}\n` +
      `🎯 صفقات اليوم: ${state.daily_trades || 0}\n` +
      `──────────────────\n` +
      `✅ صفقات رابحة: ${metrics.win_trades}\n` +
      `❌ صفقات خاسرة: ${metrics.loss_trades}\n` +
      `📊 نسبة الربح: ${(metrics.win_rate * 100).toFixed(1)}%\n` +
      `🏆 أفضل صفقة: $${metrics.best_trade_usd.toFixed(2)}\n` +
      `📉 أسوأ صفقة: $${metrics.worst_trade_usd.toFixed(2)}\n` +
      `📉 أقصى تراجع: $${metrics.max_drawdown_usd.toFixed(2)}\n` +
      `📈 إجمالي الأرباح الكلية: $${(state.total_pnl || 0).toFixed(2)}`;
    await sendTelegramAlert(env, msg);
  } catch (e) {
    console.error('[daily_report] error:', e.message);
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────
export default {
  fetch: app.fetch.bind(app),

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduledCycle(env));
  },

  // ── Queue consumer ─────────────────────────────────────────────────────────
  // Processes messages enqueued via env.TRADE_QUEUE.send().
  // Each message is expected to carry { type, data } where type is one of:
  //   "trade_log"   — write a deferred trade record to D1 + R2 daily summary
  //   "alert"       — send a Telegram notification
  async queue(batch, env) {
    for (const msg of batch.messages) {
      try {
        const { type, data } = msg.body;

        if (type === 'trade_log' && env.DB) {
          const { strategy, sizeUsd, netPct, mode } = data;
          await env.DB.prepare(
            `INSERT INTO trades (strategy, size_usd, net_profit_percent, mode, created_at) VALUES (?, ?, ?, ?, ?)`
          ).bind(strategy, sizeUsd, netPct, mode, Date.now()).run();
        }

        if (type === 'alert') {
          await sendTelegramAlert(env, data.message);
        }

        msg.ack();
      } catch (e) {
        console.error('[Queue] message processing error:', e.message);
        msg.retry();
      }
    }
  },
};

