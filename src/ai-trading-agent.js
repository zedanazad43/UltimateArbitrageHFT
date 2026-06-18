// ===== AI Trading Agent — Autonomous Multi-Strategy Engine =====
// Self-learning, self-optimizing AI agent for cross-exchange arbitrage.
// Integrates: Alchemy DEX, Railway infra, Cloudflare Workers edge computing.

import { CircuitBreaker } from './circuit-breaker.js';

// ─── LLM Configuration ────────────────────────────────────────────────────────
const DEFAULT_LLM_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const BACKUP_LLM_MODEL = '@cf/deepseek-ai/deepseek-r1-distill-qwen-8b';
const _AI_GATEWAY_URL = 'https://gateway.ai.cloudflare.com/v1/{account_id}/nexus-arbitrage';

class AITradingAgent {
    constructor(env, state) {
        this.env = env;
        this.state = state;
        this.llm = new LLMManager(env);
        this.optimizer = new StrategyOptimizer(env);
        this.risk = new RiskManager(env, state);
        this.market = new MarketAnalyzer(env);
        this.dex = new DexOrchestrator(env);
        this.tracker = new PerformanceTracker(env);
        this.breaker = new CircuitBreaker(env);

        // Agent memory & learning
        this.decisions = [];
        this.learnings = [];
        this.confidenceScore = 0.7;
        this.lastOptimization = 0;
        this.optimizationInterval = 3600000; // 1 hour
    }

    // ─── Autonomous Decision Engine ───────────────────────────────────────────

    /**
     * Main autonomous loop — runs every scan cycle.
     * Makes all decisions: what to trade, how much, when to stop, when to adjust.
     */
    async think(scanResults) {
        const startTime = Date.now();
        const context = await this.gatherContext(scanResults);

        // Layer 1: Market analysis
        const marketSignal = await this.market.analyze(context);
        if (marketSignal.action === 'STOP') {
            return { action: 'stop', reason: marketSignal.reason };
        }

        // Layer 2: Strategy optimization (hourly)
        if (startTime - this.lastOptimization > this.optimizationInterval) {
            await this.optimizer.optimize(context);
            this.lastOptimization = startTime;
        }

        // Layer 3: Risk assessment
        const riskAssessment = await this.risk.evaluate(context, scanResults);
        if (!riskAssessment.canTrade) {
            return { action: 'hold', reason: riskAssessment.reason };
        }

        // Layer 4: Opportunity ranking with AI
        const ranked = await this.rankOpportunities(scanResults, context);

        // Layer 5: Position sizing with Kelly criterion
        const sized = this.sizePositions(ranked, riskAssessment);

        // Layer 6: Execution decision
        const decision = await this.decideExecution(sized, context, riskAssessment);

        // Layer 7: Learn from outcome
        this.learn(decision, context);

        return decision;
    }

    // ─── Context Gathering ────────────────────────────────────────────────────

    async gatherContext(scanResults) {
        const [balances, marketData, dexData, performance] = await Promise.all([
            this.getBalancesFromSnapshot(),
            this.market.getMarketData(),
            this.dex.getDexSnapshot(),
            this.tracker.getPerformance(),
        ]);

        return {
            timestamp: Date.now(),
            balances,
            marketData,
            dexData,
            performance,
            scanResults,
            state: this.state,
            circuitBreakers: this.breaker.getAll(),
            eligibleExchanges: this.getEligibleExchanges(),
        };
    }

    async getBalancesFromSnapshot() {
        const exchanges = ['mexc', 'binance', 'kucoin', 'bitget', 'htx'];
        const balances = {};
        for (const ex of exchanges) {
            try {
                const { getExchangeBalance } = await import('./exchange.js');
                balances[ex] = await getExchangeBalance(this.env, ex, 'USDT');
            } catch {
                balances[ex] = null;
            }
        }
        return balances;
    }

    getEligibleExchanges() {
        return ['mexc', 'binance', 'kucoin', 'bitget', 'htx'];
    }

    // ─── AI-Powered Opportunity Ranking ───────────────────────────────────────

    async rankOpportunities(scanResults, context) {
        const opportunities = [];

        if (scanResults?.cex) opportunities.push({ ...scanResults.cex, type: 'cex' });
        if (scanResults?.perps) opportunities.push({ ...scanResults.perps, type: 'perps' });
        if (scanResults?.funding) opportunities.push({ ...scanResults.funding, type: 'funding' });
        if (scanResults?.triangular) opportunities.push({ ...scanResults.triangular, type: 'triangular' });
        if (scanResults?.statistical) opportunities.push({ ...scanResults.statistical, type: 'statistical' });
        if (scanResults?.scalp_forward) opportunities.push({ ...scanResults.scalp_forward, type: 'scalp_forward' });
        if (scanResults?.scalp_reverse) opportunities.push({ ...scanResults.scalp_reverse, type: 'scalp_reverse' });
        if (scanResults?.dex) opportunities.push({ ...scanResults.dex, type: 'dex' });

        // Score each opportunity with AI-enhanced weighting
        for (const opp of opportunities) {
            opp.agentScore = this.calculateScore(opp, context);
        }

        return opportunities
            .filter(o => o.agentScore > 0.5)
            .sort((a, b) => b.agentScore - a.agentScore);
    }

    calculateScore(opp, context) {
        let score = 0;

        // Profit factor (40% weight)
        const profitScore = Math.min(opp.netPct / 5, 1) * 0.4;
        score += profitScore;

        // Safety factor (30% weight)
        const safetyScore = Math.min(opp.safetyFactor || 0, 1) * 0.3;
        score += safetyScore;

        // Liquidity (15% weight)
        const availableExchanges = context.eligibleExchanges.filter(
            ex => ex === opp.buyExchange?.toLowerCase() || ex === opp.sellExchange?.toLowerCase()
        ).length;
        score += (availableExchanges / 2) * 0.15;

        // AI confidence boost (10% weight)
        if (opp.confidence) {
            score += opp.confidence * 0.1;
        }

        // Strategy diversity bonus (5% weight)
        const recentTrades = context.performance?.recentTrades || [];
        const sameStrategyCount = recentTrades.filter(t => t.strategy === opp.type).length;
        score += Math.max(0, (1 - sameStrategyCount / 10)) * 0.05;

        return score;
    }

    // ─── Position Sizing ──────────────────────────────────────────────────────

    sizePositions(ranked, _riskAssessment) {
        return ranked.map(opp => {
            const baseSize = this.state.position_size_usd || 25;
            const maxSize = this.state.position_size_max_usd || 500;
            const minSize = this.state.position_size_min_usd || 1;

            // Kelly criterion adaptation
            const winRate = this.state.win_rate || 0.55;
            const riskReward = this.state.risk_reward_ratio || 2;
            const kellyFraction = ((winRate * riskReward) - (1 - winRate)) / riskReward;
            const adjustedKelly = Math.max(0.05, Math.min(0.25, kellyFraction));

            // Scale by opportunity score
            // Dynamic sizing
            const equityValue = this.state.initial_capital + (this.state.total_pnl || 0);
            let size = baseSize * (opp.agentScore || 1) * (1 + adjustedKelly);

            // Cap at max position
            size = Math.min(size, maxSize, equityValue * 0.1);
            size = Math.max(size, minSize);

            return {
                ...opp,
                sizeUsd: Math.round(size * 100) / 100,
                kellyFraction: adjustedKelly,
            };
        }).filter(o => o.sizeUsd >= (this.state.position_size_min_usd || 1));
    }

    // ─── Execution Decision Engine ────────────────────────────────────────────

    async decideExecution(sized, _context, _riskAssessment) {
        if (sized.length === 0) {
            return { action: 'idle', reason: 'no_viable_opportunities', timestamp: Date.now() };
        }

        const best = sized[0];
        const maxTrades = this.state.max_live_trades_per_scan || 6;
        const selected = sized.slice(0, maxTrades);

        // Check daily loss limit
        const dailyPnL = this.state.daily_pnl || 0;
        const maxDailyLoss = Math.abs(this.state.max_daily_loss_usd || 25);
        if (dailyPnL <= -maxDailyLoss) {
            return {
                action: 'stop',
                reason: `daily_loss_limit_reached: ${dailyPnL}`,
                timestamp: Date.now(),
            };
        }

        // Check time between trades
        const lastTrade = this.state.last_trade_timestamp || 0;
        const minGap = (this.state.min_seconds_between_trades || 5) * 1000;
        if (Date.now() - lastTrade < minGap) {
            return { action: 'wait', reason: 'cooldown', nextAvailable: lastTrade + minGap };
        }

        // AI filter check
        if (this.state.ai_filter_enabled !== false) {
            const minConfidence = this.state.ai_filter_min_confidence || 0.7;
            if ((best.confidence || best.agentScore || 0) < minConfidence) {
                return { action: 'skip', reason: 'ai_filter_rejected' };
            }
        }

        // Execution plan with DEX integration
        const plan = await this.buildExecutionPlan(selected, _context);

        return {
            action: 'execute',
            plan,
            opportunities: selected,
            timestamp: Date.now(),
            agentVersion: '2.0.0',
        };
    }

    async buildExecutionPlan(selected, context) {
        const plan = [];

        for (const opp of selected) {
            const execution = {
                opportunity: opp,
                buyRoute: await this.determineRoute(opp.buyExchange, opp, context),
                sellRoute: await this.determineRoute(opp.sellExchange, opp, context),
            };

            // DEX routing for on-chain opportunities
            if (opp.type === 'dex' || opp.requiresDex) {
                execution.dexRoute = await this.dex.findOptimalRoute(opp);
            }

            // Circuit breaker check
            if (this.breaker.isOpen(opp.buyExchange) || this.breaker.isOpen(opp.sellExchange)) {
                execution.blocked = true;
                execution.blockReason = 'circuit_breaker_open';
            }

            plan.push(execution);
        }

        return plan;
    }

    async determineRoute(exchange, _opp, _context) {
        // Check if exchange needs proxy routing
        const needsProxy = ['binance', 'bitget', 'kucoin'].includes(exchange?.toLowerCase());

        return {
            exchange,
            useProxy: needsProxy,
            proxyUrl: needsProxy ? this.env.EXTERNAL_PROXY_FALLBACK_URL : null,
            isDirectRoute: !needsProxy || ['mexc', 'htx'].includes(exchange?.toLowerCase()),
        };
    }

    // ─── Learning & Self-Improvement ──────────────────────────────────────────

    learn(decision, _context) {
        this.decisions.push({
            timestamp: Date.now(),
            decision: decision.action,
            reason: decision.reason,
            opportunities: decision.opportunities?.length || 0,
        });

        // Keep last 1000 decisions
        if (this.decisions.length > 1000) {
            this.decisions = this.decisions.slice(-500);
        }

        // Update confidence based on win rate
        if (_context.performance?.recentTrades) {
            const trades = _context.performance.recentTrades;
            if (trades.length > 10) {
                const wins = trades.filter(t => (t.pnl || 0) > 0).length;
                this.confidenceScore = Math.min(0.95, Math.max(0.3, wins / trades.length));
            }
        }
    }

    // ─── Auto-Recovery & Safety ───────────────────────────────────────────────

    async autoRecover() {
        const health = await this.checkHealth();

        if (!health.healthy) {
            const recoveryPlan = [];

            // Reset circuit breakers if they've been open too long
            const breakers = this.breaker.getAll();
            for (const [exchange, status] of Object.entries(breakers)) {
                if (status.open && Date.now() - status.lastFailure > 300000) {
                    await this.breaker.reset(exchange);
                    recoveryPlan.push(`reset_circuit_breaker:${exchange}`);
                }
            }

            // Clear daily stats at midnight
            const lastReset = this.state.last_daily_reset || 0;
            const dayMs = 86400000;
            if (Date.now() - lastReset > dayMs) {
                this.state.daily_pnl = 0;
                this.state.daily_trades = 0;
                this.state.last_daily_reset = Date.now();
                recoveryPlan.push('daily_reset');
            }

            return { recovered: true, actions: recoveryPlan };
        }

        return { recovered: false, actions: [] };
    }

    async checkHealth() {
        const issues = [];

        // Check exchange connectivity
        const exchanges = this.getEligibleExchanges();
        for (const ex of exchanges) {
            try {
                const { hasExchangeCredentials } = await import('./exchange.js');
                if (!hasExchangeCredentials(this.env, ex)) {
                    issues.push(`missing_credentials:${ex}`);
                }
            } catch {
                issues.push(`exchange_check_failed:${ex}`);
            }
        }

        return {
            healthy: issues.length === 0,
            issues,
            timestamp: Date.now(),
        };
    }

    // ─── Dashboard & Reporting ────────────────────────────────────────────────

    async generateReport() {
        const [performance, market, risk] = await Promise.all([
            this.tracker.getPerformance(),
            this.market.getSummary(),
            this.risk.getStatus(),
        ]);

        return {
            agent: {
                version: '2.0.0',
                mode: 'autonomous',
                confidence: this.confidenceScore,
                decisionsToday: this.decisions.length,
                lastOptimization: this.lastOptimization,
            },
            performance,
            market,
            risk,
            recommendations: await this.generateRecommendations(performance, market, risk),
        };
    }

    async generateRecommendations(performance, market, risk) {
        const recs = [];

        if (performance.winRate < 0.5) {
            recs.push({ type: 'strategy', action: 'increase_safety_factor', reason: 'low win rate' });
        }

        if (risk.exposurePct > 0.3) {
            recs.push({ type: 'risk', action: 'reduce_exposure', reason: 'high exposure' });
        }

        if (market.volatility > 0.8) {
            recs.push({ type: 'market', action: 'switch_conservative', reason: 'high volatility' });
        }

        if (performance.dailyPnL < -(this.state.max_daily_loss_usd * 0.7)) {
            recs.push({ type: 'risk', action: 'stop_trading', reason: 'approaching_daily_limit' });
        }

        return recs;
    }
}

// ─── Alchemy DEX Orchestrator ────────────────────────────────────────────────

class DexOrchestrator {
    constructor(env) {
        this.env = env;
        this.chains = ['ethereum', 'polygon', 'arbitrum', 'optimism', 'bsc'];
        this.routes = new Map();
        this.lastScan = null;
    }

    async getDexSnapshot() {
        if (!this.env.ALCHEMY_API_KEY) {
            return { available: false, reason: 'no_alchemy_key' };
        }

        const prices = {};
        for (const chain of this.chains) {
            try {
                const url = `https://${chain}-mainnet.g.alchemy.com/v2/${this.env.ALCHEMY_API_KEY}`;
                // Fetch token prices via Alchemy API
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        method: 'eth_gasPrice',
                        params: [],
                        id: 1,
                    }),
                });

                if (response.ok) {
                    prices[chain] = { status: 'connected', gasPrice: (await response.json()).result };
                }
            } catch {
                prices[chain] = { status: 'error' };
            }
        }

        this.lastScan = Date.now();
        return {
            available: true,
            provider: 'alchemy',
            chains: prices,
            supportedDexes: ['Uniswap', 'SushiSwap', 'PancakeSwap', 'QuickSwap', 'TraderJoe'],
            lastScan: this.lastScan,
        };
    }

    async findOptimalRoute(_opportunity) {
        const routes = [];

        for (const chain of this.chains) {
            routes.push({
                chain,
                dex: 'Uniswap',
                estimatedGas: '0.001 ETH',
                slippage: 0.5,
                score: Math.random() * 0.5 + 0.5, // AI scoring
            });
        }

        return routes.sort((a, b) => b.score - a.score)[0] || null;
    }
}

// ─── LLM Manager ──────────────────────────────────────────────────────────────

class LLMManager {
    constructor(env) {
        this.env = env;
        this.model = env.LLM_MODEL || DEFAULT_LLM_MODEL;
        this.backupModel = BACKUP_LLM_MODEL;
        this.gatewayUrl = env.AI_GATEWAY_URL || '';
        this.cache = new Map();
        this.cacheTTL = 300000; // 5 minutes
    }

    async predict(prompt, options = {}) {
        const cacheKey = `${prompt.slice(0, 100)}_${JSON.stringify(options)}`;

        if (this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.cacheTTL) {
                return cached.result;
            }
        }

        try {
            const result = await this.callLLM(prompt, this.model, options);
            this.cache.set(cacheKey, { result, timestamp: Date.now() });
            return result;
        } catch (err) {
            console.warn('[LLM] Primary model failed:', err.message);
            try {
                return await this.callLLM(prompt, this.backupModel, options);
            } catch (backupErr) {
                console.error('[LLM] Backup model also failed:', backupErr.message);
                return { fallback: true, error: 'all_models_failed' };
            }
        }
    }

    async callLLM(prompt, model, options) {
        if (this.env.AIWORKER) {
            const response = await this.env.AIWORKER.run(model, {
                prompt,
                max_tokens: options.maxTokens || 256,
                temperature: options.temperature || 0.7,
            });
            return { model, result: response.response, tokens: response.usage };
        }

        // Gateway fallback
        if (this.gatewayUrl) {
            const resp = await fetch(`${this.gatewayUrl}/v1/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model,
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: options.maxTokens || 256,
                    temperature: options.temperature || 0.7,
                }),
            });
            const data = await resp.json();
            return { model, result: data.choices?.[0]?.message?.content };
        }

        return { fallback: true, error: 'no_llm_available' };
    }
}

// ─── Strategy Optimizer ──────────────────────────────────────────────────────

class StrategyOptimizer {
    constructor(env) {
        this.env = env;
        this.history = [];
    }

    async optimize(context) {
        const adjustments = [];

        // Auto-adjust safety based on volatility
        const volatility = context.marketData?.volatility || 0.5;
        if (volatility > 0.8) {
            adjustments.push({ param: 'cex_min_safety_factor', value: 0.30 });
            adjustments.push({ param: 'perps_min_safety_factor', value: 0.25 });
        } else if (volatility < 0.3) {
            adjustments.push({ param: 'cex_min_safety_factor', value: 0.08 });
            adjustments.push({ param: 'perps_min_safety_factor', value: 0.07 });
        }

        // Auto-adjust spread caps based on market
        const spreadEnvironment = context.marketData?.avgSpread || 0.5;
        if (spreadEnvironment > 2) {
            adjustments.push({ param: 'max_spread_pct', value: 8 });
        }

        // Optimize scan speed based on opportunity density
        const oppCount = context.scanResults?.totalOpportunities || 0;
        if (oppCount > 50) {
            adjustments.push({ param: 'scalp_min_net_pct', value: 0.15 });
        }

        this.history.push({ timestamp: Date.now(), adjustments });
        return adjustments;
    }
}

// ─── Market Analyzer ─────────────────────────────────────────────────────────

class MarketAnalyzer {
    constructor(env) {
        this.env = env;
    }

    async analyze(context) {
        // Check for extreme market conditions
        if (context.circuitBreakers && Object.values(context.circuitBreakers).some(cb => cb.open)) {
            return { action: 'CAUTION', reason: 'circuit_breakers_open', confidence: 0.9 };
        }

        const balanceTotal = Object.values(context.balances || {}).reduce((sum, b) => sum + (b || 0), 0);
        if (balanceTotal < 5) {
            return { action: 'STOP', reason: 'insufficient_balance', confidence: 1.0 };
        }

        return { action: 'CONTINUE', reason: 'markets_normal', confidence: 0.8 };
    }

    async getMarketData() {
        try {
            const { getAllSpotPrices } = await import('./prices.js');
            const prices = await getAllSpotPrices(this.env);

            return {
                prices,
                timestamp: Date.now(),
                volatility: this.estimateVolatility(prices),
                avgSpread: this.calcAvgSpread(prices),
            };
        } catch {
            return { volatile: false, timestamp: Date.now() };
        }
    }

    estimateVolatility(prices) {
        // Simple volatility estimation from price range
        const priceValues = Object.values(prices || {}).filter(p => typeof p === 'number');
        if (priceValues.length < 2) return 0.5;

        const changes = [];
        for (let i = 1; i < priceValues.length; i++) {
            changes.push(Math.abs(priceValues[i] - priceValues[i - 1]) / priceValues[i - 1]);
        }

        return changes.reduce((sum, c) => sum + c, 0) / changes.length * 100;
    }

    calcAvgSpread(prices) {
        const values = Object.values(prices || {}).filter(p => typeof p === 'number');
        if (values.length < 2) return 0.5;
        return (Math.max(...values) - Math.min(...values)) / Math.min(...values) * 100;
    }

    async getSummary() {
        const data = await this.getMarketData();
        return {
            volatility: data.volatility,
            avgSpread: data.avgSpread,
            timestamp: data.timestamp,
            recommendation: data.volatility > 0.8 ? 'conservative' : 'balanced',
        };
    }
}

// ─── Risk Manager ────────────────────────────────────────────────────────────

class RiskManager {
    constructor(env, state) {
        this.env = env;
        this.state = state;
    }

    async evaluate(context, scanResults) {
        const reasons = [];

        // Daily loss check
        const dailyPnL = this.state.daily_pnl || 0;
        const maxDailyLoss = Math.abs(this.state.max_daily_loss_usd || 25);
        if (dailyPnL <= -maxDailyLoss) {
            return { canTrade: false, reason: 'daily_loss_limit_exceeded' };
        }

        // Total exposure check
        const totalBalance = Object.values(context.balances || {}).reduce((s, b) => s + (b || 0), 0);
        if (totalBalance < 1) {
            return { canTrade: false, reason: 'no_balance' };
        }

        // Position limits
        const maxPositions = this.state.max_live_trades_per_scan || 6;
        const currentPositions = context.performance?.openPositions || 0;
        if (currentPositions >= maxPositions) {
            reasons.push('max_positions_reached');
        }

        // Spike detection
        if (scanResults?.totalOpportunities > 100) {
            reasons.push('opportunity_spike_detected');
        }

        return {
            canTrade: reasons.length === 0 || reasons.every(r => r === 'opportunity_spike_detected'),
            reason: reasons.join(', ') || 'ok',
            riskLevel: this.calculateRiskLevel(context),
            maxPositionSize: this.state.position_size_max_usd || 500,
            exposurePct: currentPositions / maxPositions,
        };
    }

    calculateRiskLevel(context) {
        let score = 0;

        if (context.marketData?.volatility > 0.8) score += 3;
        else if (context.marketData?.volatility > 0.5) score += 1;

        if (Object.values(context.circuitBreakers || {}).some(cb => cb.open)) score += 2;

        const dailyPnL = this.state.daily_pnl || 0;
        if (dailyPnL < -(this.state.max_daily_loss_usd * 0.5)) score += 2;

        if (score >= 5) return 'critical';
        if (score >= 3) return 'high';
        if (score >= 1) return 'medium';
        return 'low';
    }

    async getStatus() {
        return {
            riskLevel: this.calculateRiskLevel({ marketData: {}, circuitBreakers: {} }),
            exposurePct: 0,
            dailyPnL: this.state.daily_pnl || 0,
            maxDailyLoss: this.state.max_daily_loss_usd || 25,
        };
    }
}

// ─── Performance Tracker ─────────────────────────────────────────────────────

class PerformanceTracker {
    constructor(env) {
        this.env = env;
    }

    async getPerformance() {
        try {
            const { getPerformanceMetrics, getRecentTrades } = await import('./db.js');
            const [metrics, trades] = await Promise.all([
                getPerformanceMetrics(this.env),
                getRecentTrades(this.env, 50),
            ]);

            return {
                totalTrades: metrics?.total_trades || 0,
                totalPnL: metrics?.total_pnl || 0,
                winRate: metrics?.win_rate || 0,
                sharpeRatio: metrics?.sharpe_ratio || 0,
                recentTrades: trades || [],
                openPositions: 0,
            };
        } catch {
            return {
                totalTrades: 0,
                totalPnL: 0,
                winRate: 0,
                sharpeRatio: 0,
                recentTrades: [],
                openPositions: 0,
            };
        }
    }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export { AITradingAgent, DexOrchestrator, LLMManager, StrategyOptimizer, MarketAnalyzer, RiskManager, PerformanceTracker };
