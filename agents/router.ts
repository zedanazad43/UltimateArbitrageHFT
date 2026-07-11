/**
 * Universal Router - Intelligently routes requests to best free agent
 * Priority: Local (Ollama) → CodeGeeX → CLI fallback
 * No external API calls unless necessary
 */

import { TokenManager } from "./token-manager";

export interface RoutingRequest {
  task: string;
  context?: string;
  priority?: "critical" | "high" | "normal" | "low";
  agent?: string; // force agent
}

export interface RoutingDecision {
  agent: string;
  reason: string;
  tokens_available: number;
  compressed_context?: string;
}

export type AgentType = "ollama" | "codegeex" | "cli" | "aimaster" | "arbitrage";

export class UniversalRouter {
  private tokenManager: TokenManager;
  private agentHealth: Map<AgentType, boolean> = new Map([
    ["ollama", true],
    ["codegeex", true],
    ["cli", true],
    ["aimaster", true],
    ["arbitrage", true],
  ]);

  constructor(tokenManager: TokenManager) {
    this.tokenManager = tokenManager;
  }

  /**
   * Route a request to the best available agent
   */
  route(req: RoutingRequest): RoutingDecision {
    // If agent forced, use it
    if (req.agent && this.agentHealth.get(req.agent as AgentType)) {
      return {
        agent: req.agent,
        reason: "forced",
        tokens_available: this.tokenManager.getStatus().remaining,
      };
    }

    // Compress context first
    let compressed = req.context ?? "";
    let leanCtx = null;
    if (compressed.length > 1000) {
      leanCtx = this.tokenManager.compressContext(compressed);
      compressed = compressed.substring(0, 1000); // max 1000 chars
    }

    // Route by task type
    const taskType = this.classifyTask(req.task);
    const priority = req.priority ?? "normal";

    let decision: RoutingDecision;

    switch (taskType) {
      case "code":
        decision = this.routeCode(compressed, priority);
        break;
      case "analysis":
        decision = this.routeAnalysis(compressed, priority);
        break;
      case "trading":
        decision = this.routeTrading(compressed, priority);
        break;
      default:
        decision = this.routeDefault(compressed, priority);
    }

    if (leanCtx) {
      decision.compressed_context = compressed;
    }

    return decision;
  }

  /**
   * Classify task type from task string
   */
  private classifyTask(
    task: string
  ): "code" | "analysis" | "trading" | "general" {
    const lower = task.toLowerCase();
    if (
      lower.includes("code") ||
      lower.includes("function") ||
      lower.includes("debug")
    )
      return "code";
    if (lower.includes("analyze") || lower.includes("report"))
      return "analysis";
    if (lower.includes("trade") || lower.includes("arbitrage"))
      return "trading";
    return "general";
  }

  /**
   * Route code-related tasks
   * Prefer: CodeGeeX (trained on code) → Ollama → CLI
   */
  private routeCode(context: string, priority: string): RoutingDecision {
    if (this.agentHealth.get("codegeex")) {
      return {
        agent: "codegeex",
        reason: `code_specialist`,
        tokens_available: this.tokenManager.getStatus().remaining,
      };
    }
    if (this.agentHealth.get("ollama")) {
      return {
        agent: "ollama",
        reason: "fallback_to_local",
        tokens_available: this.tokenManager.getStatus().remaining,
      };
    }
    return {
      agent: "cli",
      reason: "last_resort",
      tokens_available: this.tokenManager.getStatus().remaining,
    };
  }

  /**
   * Route analysis tasks
   * Prefer: AIMaster (multi-model) → Ollama → CLI
   */
  private routeAnalysis(context: string, priority: string): RoutingDecision {
    if (this.agentHealth.get("aimaster")) {
      return {
        agent: "aimaster",
        reason: "multi_model_analysis",
        tokens_available: this.tokenManager.getStatus().remaining,
      };
    }
    if (this.agentHealth.get("ollama")) {
      return {
        agent: "ollama",
        reason: "local_inference",
        tokens_available: this.tokenManager.getStatus().remaining,
      };
    }
    return {
      agent: "cli",
      reason: "last_resort",
      tokens_available: this.tokenManager.getStatus().remaining,
    };
  }

  /**
   * Route trading tasks
   * Prefer: Arbitrage engine (specialized) → AIMaster → Ollama
   */
  private routeTrading(context: string, priority: string): RoutingDecision {
    if (this.agentHealth.get("arbitrage")) {
      return {
        agent: "arbitrage",
        reason: "specialized_trading",
        tokens_available: this.tokenManager.getStatus().remaining,
      };
    }
    if (this.agentHealth.get("aimaster")) {
      return {
        agent: "aimaster",
        reason: "multi_model_fallback",
        tokens_available: this.tokenManager.getStatus().remaining,
      };
    }
    return {
      agent: "ollama",
      reason: "local_inference",
      tokens_available: this.tokenManager.getStatus().remaining,
    };
  }

  /**
   * Route general tasks
   */
  private routeDefault(context: string, priority: string): RoutingDecision {
    // Check token budget
    if (
      this.tokenManager.getStatus().used_percent > 80 &&
      this.agentHealth.get("ollama")
    ) {
      return {
        agent: "ollama",
        reason: "token_budget_tight",
        tokens_available: this.tokenManager.getStatus().remaining,
      };
    }

    // Default priority-based routing
    if (priority === "critical" && this.agentHealth.get("aimaster")) {
      return {
        agent: "aimaster",
        reason: "critical_priority",
        tokens_available: this.tokenManager.getStatus().remaining,
      };
    }

    // Use cheapest available
    if (this.agentHealth.get("ollama")) {
      return {
        agent: "ollama",
        reason: "cost_efficient",
        tokens_available: this.tokenManager.getStatus().remaining,
      };
    }

    if (this.agentHealth.get("codegeex")) {
      return {
        agent: "codegeex",
        reason: "free_tier_available",
        tokens_available: this.tokenManager.getStatus().remaining,
      };
    }

    return {
      agent: "cli",
      reason: "fallback",
      tokens_available: this.tokenManager.getStatus().remaining,
    };
  }

  /**
   * Report agent health status
   */
  reportHealth(agent: AgentType, healthy: boolean) {
    this.agentHealth.set(agent, healthy);
  }

  /**
   * Get health summary
   */
  getHealthSummary(): Record<string, boolean> {
    return Object.fromEntries(this.agentHealth);
  }
}
