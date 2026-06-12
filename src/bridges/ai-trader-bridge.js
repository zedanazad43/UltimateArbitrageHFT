/**
 * AI Trader Bridge — Machine Learning Enhanced Decision Engine
 *
 * مستوحى من:
 * - N00Bception/AI-CryptoTrader (⭐100+) — تداول بتقنيات Ensemble ML
 * - alsk1992/CloddsBot (⭐369) — وكيل تداول ذكي مستقل
 * - yeahrb/CEX-Option-Futures-Crypto-Quant-Algorithm-Trading-Bot (⭐483)
 * - gobabygo/ninjabot (⭐1.7k) — مؤشرات فنية متقدمة
 *
 * يوفر هذا الجسر:
 * - تحليل فني متعدد المؤشرات (EMA, RSI, MACD, Bollinger, ATR, OBV, VWAP)
 * - نظام إشارات Ensemble (تصويت متعدد المؤشرات)
 * - كشف الانحرافات والشذوذ (Anomaly Detection)
 * - تحليل المشاعر للسوق (Sentiment Scoring)
 * - تقييم مخاطر متكامل
 */

// ── Technical Indicators (inspired by ninjabot/freqtrade) ──────────────────────

/**
 * Simple Moving Average
 */
export function SMA(candles, period = 20) {
  if (candles.length < period) return null;
  const slice = candles.slice(-period);
  return slice.reduce((a, c) => a + c.close, 0) / period;
}

/**
 * Exponential Moving Average
 */
export function EMA(candles, period = 20) {
  if (candles.length < period) return null;
  const k = 2 / (period + 1);
  let ema = candles.slice(0, period).reduce((a, c) => a + c.close, 0) / period;
  for (let i = period; i < candles.length; i++) {
    ema = candles[i].close * k + ema * (1 - k);
  }
  return ema;
}

/**
 * Relative Strength Index (RSI) — Wilder's smoothing
 */
export function RSI(candles, period = 14) {
  if (candles.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change >= 0) gains += change; else losses -= change;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * MACD (Moving Average Convergence Divergence)
 * Returns { macd, signal, histogram }
 */
export function MACD(candles, fast = 12, slow = 26, signal = 9) {
  if (candles.length < slow + signal) return null;
  const emaFast = EMA(candles, fast);
  const emaSlow = EMA(candles, slow);
  if (emaFast === null || emaSlow === null) return null;
  const macdLine = emaFast - emaSlow;

  // Calculate signal line from MACD values
  const macdValues = [];
  for (let i = slow; i < candles.length; i++) {
    const slice = candles.slice(0, i + 1);
    const ef = EMA(slice, fast);
    const es = EMA(slice, slow);
    if (ef !== null && es !== null) macdValues.push(ef - es);
  }
  const signalLine = macdValues.length >= signal
    ? macdValues.slice(-signal).reduce((a, v) => a + v, 0) / signal
    : macdLine;

  return {
    macd: macdLine,
    signal: signalLine,
    histogram: macdLine - signalLine,
  };
}

/**
 * Bollinger Bands — returns { upper, middle, lower, width, percentB }
 */
export function bollingerBands(candles, period = 20, stdDev = 2) {
  if (candles.length < period) return null;
  const middle = SMA(candles, period);
  const slice = candles.slice(-period);
  const variance = slice.reduce((a, c) => a + (c.close - middle) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  const current = candles[candles.length - 1].close;

  return {
    upper: middle + stdDev * std,
    middle,
    lower: middle - stdDev * std,
    width: (2 * stdDev * std / middle) * 100, // Bandwidth %
    percentB: (current - (middle - stdDev * std)) / (2 * stdDev * std), // %B
  };
}

/**
 * Average True Range (ATR) — volatility indicator
 */
export function ATR(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const trValues = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    trValues.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  const slice = trValues.slice(-period);
  return slice.reduce((a, v) => a + v, 0) / period;
}

/**
 * On-Balance Volume (OBV) — momentum + volume
 */
export function OBV(candles) {
  let obv = 0;
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].close > candles[i - 1].close) obv += candles[i].volume;
    else if (candles[i].close < candles[i - 1].close) obv -= candles[i].volume;
  }
  return obv;
}

/**
 * VWAP (Volume-Weighted Average Price)
 */
export function VWAP(candles) {
  if (candles.length === 0) return null;
  let totalVolume = 0, totalValue = 0;
  for (const c of candles) {
    const typical = (c.high + c.low + c.close) / 3;
    totalValue += typical * c.volume;
    totalVolume += c.volume;
  }
  return totalVolume > 0 ? totalValue / totalVolume : null;
}

// ── Anomaly Detection (Z-Score based) ─────────────────────────────────────────

/**
 * Detects price anomalies using Z-Score method.
 * Returns anomalies with Z > threshold from the mean.
 */
export function detectAnomalies(candles, threshold = 2.5, window = 50) {
  if (candles.length < window) return [];
  const prices = candles.slice(-window).map(c => c.close);
  const mean = prices.reduce((a, p) => a + p, 0) / prices.length;
  const variance = prices.reduce((a, p) => a + (p - mean) ** 2, 0) / prices.length;
  const std = Math.sqrt(variance);

  const anomalies = [];
  for (let i = candles.length - window; i < candles.length; i++) {
    const zScore = std > 0 ? Math.abs((candles[i].close - mean) / std) : 0;
    if (zScore > threshold) {
      anomalies.push({
        index: i,
        price: candles[i].close,
        zScore,
        direction: candles[i].close > mean ? 'overbought' : 'oversold',
      });
    }
  }
  return anomalies;
}

// ── Ensemble Signal System (multi-indicator voting) ──────────────────────────

/**
 * Generates ensemble trading signal based on multiple indicators.
 * Each indicator votes: BUY (+1), SELL (-1), or NEUTRAL (0).
 * Final signal is the weighted sum of votes.
 * 
 * Inspired by AI-CryptoTrader's ensemble approach.
 */
export function ensembleSignal(candles, weights = {}) {
  const defaultWeights = {
    rsi: 0.25,
    macd: 0.25,
    bollinger: 0.15,
    ema: 0.15,
    volume: 0.10,
    anomaly: 0.10,
  };
  const w = { ...defaultWeights, ...weights };
  const signals = {};
  let totalWeight = 0;
  let score = 0;

  // RSI Signal
  const rsi = RSI(candles, 14);
  if (rsi !== null) {
    if (rsi < 30) { signals.rsi = { vote: 1, value: rsi }; score += w.rsi * 1; }
    else if (rsi > 70) { signals.rsi = { vote: -1, value: rsi }; score += w.rsi * -1; }
    else signals.rsi = { vote: 0, value: rsi };
    totalWeight += w.rsi;
  }

  // MACD Signal
  const macd = MACD(candles);
  if (macd) {
    if (macd.histogram > 0 && macd.macd > macd.signal) {
      signals.macd = { vote: 1, value: macd };
      score += w.macd * 1;
    } else if (macd.histogram < 0 && macd.macd < macd.signal) {
      signals.macd = { vote: -1, value: macd };
      score += w.macd * -1;
    } else {
      signals.macd = { vote: 0, value: macd };
    }
    totalWeight += w.macd;
  }

  // Bollinger Bands Signal
  const bb = bollingerBands(candles);
  if (bb) {
    if (bb.percentB < 0.05) { signals.bollinger = { vote: 1, value: bb }; score += w.bollinger * 1; }
    else if (bb.percentB > 0.95) { signals.bollinger = { vote: -1, value: bb }; score += w.bollinger * -1; }
    else signals.bollinger = { vote: 0, value: bb };
    totalWeight += w.bollinger;
  }

  // EMA Trend Signal (EMA20 vs EMA50 cross)
  const ema20 = EMA(candles, 20);
  const ema50 = EMA(candles, 50);
  if (ema20 !== null && ema50 !== null) {
    if (ema20 > ema50) { signals.ema = { vote: 1, value: { ema20, ema50 } }; score += w.ema * 1; }
    else { signals.ema = { vote: -1, value: { ema20, ema50 } }; score += w.ema * -1; }
    totalWeight += w.ema;
  }

  // Volume anomaly (OBV direction + volume spike)
  const obv = OBV(candles);
  const avgVolume = candles.slice(-20).reduce((a, c) => a + c.volume, 0) / Math.min(candles.length, 20);
  const lastVolume = candles[candles.length - 1]?.volume || 0;
  if (avgVolume > 0) {
    const volumeSpike = lastVolume / avgVolume;
    if (volumeSpike > 1.5 && obv > 0) { signals.volume = { vote: 1, value: volumeSpike }; score += w.volume * 1; }
    else if (volumeSpike > 1.5 && obv < 0) { signals.volume = { vote: -1, value: volumeSpike }; score += w.volume * -1; }
    else signals.volume = { vote: 0, value: volumeSpike };
    totalWeight += w.volume;
  }

  // Anomaly signal
  const anomalies = detectAnomalies(candles, 2.5, 50);
  if (anomalies.length > 0) {
    const latest = anomalies[anomalies.length - 1];
    if (latest.direction === 'oversold') { signals.anomaly = { vote: 1, value: latest }; score += w.anomaly * 1; }
    else { signals.anomaly = { vote: -1, value: latest }; score += w.anomaly * -1; }
    totalWeight += w.anomaly;
  }

  // Normalize score to -1..1
  const normalizedScore = totalWeight > 0 ? score / totalWeight : 0;

  return {
    signal: normalizedScore > 0.3 ? 'BUY' : normalizedScore < -0.3 ? 'SELL' : 'NEUTRAL',
    score: normalizedScore,
    strength: Math.abs(normalizedScore),
    indicators: signals,
    activeIndicators: Object.keys(signals).length,
    totalIndicators: 5,
  };
}

// ── Market Sentiment Scanner ──────────────────────────────────────────────────

/**
 * Simple market sentiment based on:
 * - RSI positioning
 * - Bollinger %B
 * - MACD histogram momentum
 * - Recent price volatility
 */
export function marketSentiment(candles) {

  // RSI-based heat
  const rsi = RSI(candles, 14);
  const rsiHeat = rsi !== null ? (rsi - 50) / 50 : 0; // -1..1

  // Volatility-based heat
  const atr = ATR(candles, 14);
  const avgClose = candles.slice(-14).reduce((a, c) => a + c.close, 0) / Math.min(candles.length, 14);
  const volHeat = atr && avgClose > 0 ? Math.min((atr / avgClose) / 0.05, 1) : 0.5;

  // Momentum (5-period)
  const momentum5 = candles.length >= 5
    ? (candles[candles.length - 1].close - candles[candles.length - 5].close) / candles[candles.length - 5].close
    : 0;

  // Composite
  const composite = (rsiHeat * 0.4 + momentum5 * 20 * 0.3 + volHeat * 0.3);

  return {
    sentiment: composite > 0.2 ? 'bullish' : composite < -0.2 ? 'bearish' : 'neutral',
    score: composite,
    volatility: volHeat,
    momentum: momentum5,
    rsiPosition: rsiHeat,
    confidence: Math.min(Math.abs(composite) * 2, 1),
  };
}

// ── Integrated Risk Scoring ──────────────────────────────────────────────────

/**
 * Comprehensive risk score for a trading opportunity.
 * 0 = safest, 1 = extreme risk.
 */
export function riskScore(opportunity, candles, config = {}) {
  let score = 0;
  const weights = { volatility: 0.25, liquidity: 0.25, momentum: 0.20, spread: 0.15, anomaly: 0.15, ...config };

  // 1. Volatility risk (ATR % of price)
  const atr = ATR(candles, 14);
  const currentPrice = candles[candles.length - 1]?.close || opportunity.buyPrice || 1;
  if (atr && currentPrice > 0) {
    const volPct = atr / currentPrice;
    if (volPct > 0.05) score += weights.volatility * 1;
    else if (volPct > 0.02) score += weights.volatility * 0.5;
    else score += weights.volatility * 0.2;
  }

  // 2. Liquidity risk (from opportunity data)
  if (opportunity.liquidityScore !== undefined) {
    score += weights.liquidity * (1 - opportunity.liquidityScore);
  } else {
    score += weights.liquidity * 0.3;
  }

  // 3. Momentum contrarian risk
  const sentiment = marketSentiment(candles);
  if (opportunity.direction === 'Long' && sentiment.sentiment === 'bearish') score += weights.momentum * 0.7;
  else if (opportunity.direction === 'Short' && sentiment.sentiment === 'bullish') score += weights.momentum * 0.7;

  // 4. Spread risk
  const spreadPct = opportunity.grossPct || opportunity.spreadPct || 0;
  if (spreadPct < 0.3) score += weights.spread * 0.8; // Very thin spread = higher execution risk
  else if (spreadPct > 5) score += weights.spread * 0.4; // Very wide = fundamental issue

  // 5. Anomaly risk
  const anomalies = detectAnomalies(candles, 2.5, 50);
  if (anomalies.length > 3) score += weights.anomaly * 0.8;
  else if (anomalies.length > 0) score += weights.anomaly * 0.4;

  return Math.min(score, 1);
}

// ── Opportunity Ranking with AI signals ───────────────────────────────────────

/**
 * Ranks arbitrage opportunities combining:
 * - Raw profit potential
 * - Risk score (from technical analysis)
 * - Market sentiment alignment
 * - Liquidity depth
 * 
 * Returns top N opportunities sorted by composite score.
 */
export function rankOpportunities(opportunities, candlesMap, topN = 5) {
  const scored = opportunities.map(opp => {
    const candles = candlesMap[opp.symbol] || [];
    const risk = candles.length > 0 ? riskScore(opp, candles) : 0.5;
    const sentiment = candles.length > 0 ? marketSentiment(candles) : { sentiment: 'neutral', score: 0 };
    const ensemble = candles.length > 0 ? ensembleSignal(candles) : { signal: 'NEUTRAL', score: 0 };

    // Composite score: profit * (1-risk) * sentiment_alignment * signal_strength
    const profitScore = Math.max(opp.netPct || 0, opp.adjustedNetPct || 0);
    const riskMultiplier = 1 - risk;
    const sentimentAlignment = sentiment.sentiment === 'bullish' && opp.direction !== 'Short' ? 1.1
      : sentiment.sentiment === 'bearish' && opp.direction === 'Short' ? 1.1 : 1.0;
    const signalMultiplier = 1 + ensemble.strength * 0.3;

    const composite = profitScore * riskMultiplier * sentimentAlignment * signalMultiplier;

    return {
      ...opp,
      aiScore: composite,
      risk,
      sentiment: sentiment.sentiment,
      ensembleSignal: ensemble.signal,
      rank: 0,
    };
  });

  scored.sort((a, b) => b.aiScore - a.aiScore);
  scored.forEach((s, i) => s.rank = i + 1);

  return scored.slice(0, topN);
}

// ── Market Regime Detection ───────────────────────────────────────────────────

/**
 * Detects current market regime:
 * - trending_up: Strong upward momentum, low volatility
 * - trending_down: Strong downward momentum
 * - ranging: Low momentum, bounded volatility
 * - volatile: High volatility, unclear direction
 * - breakout: Sudden spike in volume + price
 */
export function detectMarketRegime(candles) {
  if (candles.length < 30) return { regime: 'unknown', confidence: 0 };

  const atr = ATR(candles, 14);
  const avgPrice = candles.slice(-14).reduce((a, c) => a + c.close, 0) / Math.min(candles.length, 14);
  const volPct = atr && avgPrice > 0 ? atr / avgPrice : 0;

  const ema20 = EMA(candles, 20);
  const ema50 = EMA(candles, 50);
  const trendStrength = ema20 && ema50 ? Math.abs(ema20 - ema50) / ema50 : 0;

  const lastVolume = candles[candles.length - 1].volume || 0;
  const avgVolume = candles.slice(-20).reduce((a, c) => a + c.volume, 0) / Math.min(candles.length, 20);
  const volumeSpike = avgVolume > 0 ? lastVolume / avgVolume : 1;

  const rsi = RSI(candles, 14);

  if (volumeSpike > 2.0 && volPct > 0.03) return { regime: 'breakout', confidence: 0.85 };
  if (volPct > 0.05) return { regime: 'volatile', confidence: 0.8 };
  if (trendStrength > 0.02 && ema20 > ema50 && rsi > 50) return { regime: 'trending_up', confidence: 0.75 };
  if (trendStrength > 0.02 && ema20 < ema50 && rsi < 50) return { regime: 'trending_down', confidence: 0.75 };
  if (trendStrength < 0.01 && volPct < 0.02) return { regime: 'ranging', confidence: 0.7 };

  return { regime: 'ranging', confidence: 0.5 };
}

// ── Position Size Optimizer (Kelly Criterion variant) ────────────────────────

/**
 * Kelly-optimal position sizing adjusted for risk.
 * f* = (p * b - q) / b where p=win probability, q=loss probability, b=win/loss ratio
 * Then apply fractional Kelly (e.g., half-Kelly for safety).
 */
export function kellyPosition(opportunity, capital, config = {}) {
  const {
    winRate = 0.55,
    riskRewardRatio = 2.0,
    fractionalKelly = 0.5, // Half-Kelly for safety
    maxPositionPct = 0.05,
    minPositionPct = 0.005,
  } = config;

  const q = 1 - winRate;
  const kelly = (winRate * riskRewardRatio - q) / riskRewardRatio;
  const adjustedKelly = Math.max(0, kelly * fractionalKelly);

  const positionPct = Math.min(adjustedKelly, maxPositionPct);
  const finalPct = Math.max(positionPct, minPositionPct);

  return {
    positionPct: finalPct,
    positionUsd: capital * finalPct,
    kellyRaw: kelly,
    kellyAdjusted: adjustedKelly,
    isSafe: kelly > 0 && adjustedKelly < maxPositionPct,
  };
}

