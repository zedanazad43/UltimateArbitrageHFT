/**
 * Universal Orchestrator - Main entry point
 * Combines: Token Manager + Router + Integration Bridge
 * Token-efficient, all-free, primary agent for platforms/VSCode/CLI/web
 */

import { TokenManager } from "./token-manager";
import { UniversalRouter, RoutingRequest, RoutingDecision } from "./router";
import { IntegrationBridge, AgentResponse } from "./integration-bridge";

export interface OrchestratorRequest {
    task: string;
    context?: string;
    priority?: "critical" | "high" | "normal" | "low";
    agent?: string;
}

export interface OrchestratorResponse {
    id: string;
    task: string;
    result: string;
    agent_used: string;
    routing_decision: RoutingDecision;
    tokens_used: number;
    tokens_remaining: number;
    latency_ms: number;
    success: boolean;
    error?: string;
}

export class UniversalOrchestrator {
    private tokenManager: TokenManager;
    private router: UniversalRouter;
    private bridge: IntegrationBridge;
    private requestId = 0;

    constructor(
        projectRoot = "/app",
        tokenBudget = 100_000
    ) {
        this.tokenManager = new TokenManager(tokenBudget);
        this.router = new UniversalRouter(this.tokenManager);
        this.bridge = new IntegrationBridge(projectRoot);
    }

    /**
     * Execute a request through the full orchestration pipeline
     */
    async execute(req: OrchestratorRequest): Promise<OrchestratorResponse> {
        const id = `orch_${++this.requestId}`;
        const startTime = Date.now();

        try {
            // Step 1: Compress context to save tokens
            const leanCtx = req.context
                ? this.tokenManager.compressContext(req.context)
                : null;
            const estimatedTokens = leanCtx?.compressed_tokens ?? 100;

            // Step 2: Check if we're running low on tokens
            // Block immediately if request doesn't fit, regardless of used_percent
            if (!this.tokenManager.canFitRequest(estimatedTokens)) {
                return {
                    id,
                    task: req.task,
                    result: "",
                    agent_used: "none",
                    routing_decision: { agent: "none", reason: "token_limit", tokens_available: 0 },
                    tokens_used: 0,
                    tokens_remaining: 0,
                    latency_ms: Date.now() - startTime,
                    success: false,
                    error: "Token budget exhausted (request does not fit available tokens)",
                };
            }

            // Step 3: Route to best agent
            const decision = this.router.route({
                task: req.task,
                context: leanCtx?.compressed || req.context,
                priority: req.priority,
                agent: req.agent,
            });

            // Step 4: Execute on selected agent with compressed context embedded in prompt
            const contextPrefix = (leanCtx?.compressed || req.context) 
                ? `[CONTEXT]\n${leanCtx?.compressed || req.context}\n[/CONTEXT]\n\n` 
                : '';
            const augmentedTask = contextPrefix + req.task;
            const response = await this.bridge.execute(decision.agent, augmentedTask);

            // Step 5: Update token budget
            this.tokenManager.consumeTokens(estimatedTokens);
            const budgetStatus = this.tokenManager.getStatus();

            // Step 6: Check agent health
            if (!response.success) {
                this.router.reportHealth(decision.agent as any, false);
            }

            return {
                id,
                task: req.task,
                result: response.content,
                agent_used: response.agent,
                routing_decision: decision,
                tokens_used: estimatedTokens,
                tokens_remaining: budgetStatus.remaining,
                latency_ms: Date.now() - startTime,
                success: response.success,
                error: response.error,
            };
        } catch (err: any) {
            return {
                id,
                task: req.task,
                result: "",
                agent_used: "error",
                routing_decision: { agent: "error", reason: "exception", tokens_available: 0 },
                tokens_used: 0,
                tokens_remaining: this.tokenManager.getStatus().remaining,
                latency_ms: Date.now() - startTime,
                success: false,
                error: err.message,
            };
        }
    }

    /**
     * Get orchestrator status
     */
    status() {
        return {
            token_budget: this.tokenManager.getStatus(),
            agent_health: this.router.getHealthSummary(),
            timestamp: new Date().toISOString(),
        };
    }

    /**
     * Reset token budget (for new session)
     */
    resetBudget(newTotal = 100_000) {
        this.tokenManager.reset(newTotal);
    }

    /**
     * Batch execute multiple requests
     * Prioritizes critical tasks first
     */
    async executeBatch(requests: OrchestratorRequest[]) {
        // Sort by priority (critical → high → normal → low)
        const priorityMap = { critical: 0, high: 1, normal: 2, low: 3 };
        const sorted = [...requests].sort(
            (a, b) =>
                (priorityMap[a.priority ?? "normal"] ?? 2) -
                (priorityMap[b.priority ?? "normal"] ?? 2)
        );

        const results = [];
        for (const req of sorted) {
            const result = await this.execute(req);
            results.push(result);

            // Stop if budget exhausted
            if (this.tokenManager.getStatus().used_percent > 95) {
                console.warn("Token budget 95% used, stopping batch");
                break;
            }
        }

        return results;
    }

    /**
     * Get recommendations based on current state
     */
    getRecommendations() {
        const status = this.status();
        const recs: string[] = [];

        if (status.token_budget.used_percent > 80) {
            recs.push("⚠️ Token budget 80%+ used - switching to Ollama (free)");
        }
        if (status.token_budget.used_percent > 95) {
            recs.push("🚨 Token budget critical - only CLI available");
        }

        const unhealthy = Object.entries(status.agent_health)
            .filter(([_, healthy]) => !healthy)
            .map(([agent]) => agent);
        if (unhealthy.length > 0) {
            recs.push(`❌ Unhealthy agents: ${unhealthy.join(", ")}`);
        }

        return recs;
    }
}

// Export for CLI/module usage
export { TokenManager, UniversalRouter, IntegrationBridge };
