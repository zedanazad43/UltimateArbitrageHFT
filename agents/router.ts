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

export type AgentType =
  | "ollama"
  | "codegeex"
  | "cli"
  | "aimaster"
  | "arbitrage"
  | "hermes"
  | "merlin"
  | "omni"
  | "manus"
  | "cloudflare";

/** Endpoint config for cloud agents */
export interface AgentEndpoint {
  url: string;
  api_key_env?: string;
  model?: string;
}

const AGENT_ENDPOINTS: Partial<Record<AgentType, AgentEndpoint>> = {
  hermes: {
    url: "https://hermes-agent.nousresearch.com/v1",
    api_key_env: "HERMES_API_KEY",
    model: "openrouter/auto",
  },
  merlin: {
    url: "https://merlin.foyer.work/api/chat",
    api_key_env: "MERLIN_API_KEY",
    model: "auto",
  },
  omni: {
    url: "https://openrouter.ai/api/v1",
    api_key_env: "OPENROUTER_API_KEY",
    model: "openrouter/auto",
  },
  manus: {
    url: "http://127.0.0.1:8788/api/manus",
    api_key_env: "MANUS_API_KEY",
    model: "auto",
  },
  cloudflare: {
    url: "${CLOUDFLARE_AI_GATEWAY_URL}",
    api_key_env: "CLOUDFLARE_API_TOKEN",
    model: "@cf/meta/llama-3.1-8b-instruct",
  },
};

export class UniversalRouter {
  private tokenManager: TokenManager;
  private agentHealth: Map<AgentType, boolean> = new Map([
    ["ollama", true],
    ["codegeex", true],
    ["cli", true],
    ["aimaster", true],
    ["arbitrage", true],
    ["hermes", true],
    ["merlin", true],
    ["omni", true],
    ["manus", true],
    ["cloudflare", true],
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
      case "research":
        decision = this.routeResearch(compressed, priority);
        break;
      case "automation":
        decision = this.routeAutomation(compressed, priority);
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
  ): "code" | "analysis" | "trading" | "research" | "automation" | "general" {
    const lower = task.toLowerCase();
    if (lower.includes("code") || lower.includes("function") || lower.includes("debug"))
      return "code";
    if (lower.includes("analyze") || lower.includes("report"))
      return "analysis";
    if (lower.includes("trade") || lower.includes("arbitrage"))
      return "trading";
    if (lower.includes("search") || lower.includes("research") || lower.includes("web") || lower.includes("browse"))
      return "research";
    if (lower.includes("automate") || lower.includes("browser") || lower.includes("click") || lower.includes("form"))
      return "automation";
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
    if (priority === "critical") {
      if (this.agentHealth.get("hermes")) {
        return {
          agent: "hermes",
          reason: "critical_long_context",
          tokens_available: this.tokenManager.getStatus().remaining,
        };
      }
      if (this.agentHealth.get("omni")) {
        return {
          agent: "omni",
          reason: "critical_multi_model",
          tokens_available: this.tokenManager.getStatus().remaining,
        };
      }
      if (this.agentHealth.get("aimaster")) {
        return {
          agent: "aimaster",
          reason: "critical_priority",
          tokens_available: this.tokenManager.getStatus().remaining,
        };
      }
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
   * Route research/web tasks
   * Prefer: Merlin (web research) → Omni (multi-model) → Hermes → AIMaster
   */
  private routeResearch(context: string, priority: string): RoutingDecision {
    if (this.agentHealth.get("merlin")) {
      return {
        agent: "merlin",
        reason: "web_research_specialist",
        tokens_available: this.tokenManager.getStatus().remaining,
      };
    }
    if (this.agentHealth.get("omni")) {
      return {
        agent: "omni",
        reason: "multi_model_research",
        tokens_available: this.tokenManager.getStatus().remaining,
      };
    }
    if (this.agentHealth.get("hermes")) {
      return {
        agent: "hermes",
        reason: "long_context_fallback",
        tokens_available: this.tokenManager.getStatus().remaining,
      };
    }
    return {
      agent: "aimaster",
      reason: "local_fallback",
      tokens_available: this.tokenManager.getStatus().remaining,
    };
  }

  /**
   * Route automation/browser tasks
   * Prefer: Manus (browser automation) → Hermes (long task) → CLI
   */
  private routeAutomation(context: string, priority: string): RoutingDecision {
    if (this.agentHealth.get("manus")) {
      return {
        agent: "manus",
        reason: "browser_automation_specialist",
        tokens_available: this.tokenManager.getStatus().remaining,
      };
    }
    if (this.agentHealth.get("hermes")) {
      return {
        agent: "hermes",
        reason: "long_task_fallback",
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
   * Get endpoint config for a cloud agent
   */
  getEndpoint(agent: AgentType): AgentEndpoint | undefined {
    return AGENT_ENDPOINTS[agent];
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
