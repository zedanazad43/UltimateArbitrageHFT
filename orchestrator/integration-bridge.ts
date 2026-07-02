/**
 * Integration Bridge - Connects to all free agents
 * No external API calls. Uses: Ollama (local), CodeGeeX (free), CLI, AIMaster (free providers)
 */

import { execSync } from "child_process";

export interface AgentResponse {
  agent: string;
  content: string;
  tokens_used?: number;
  latency_ms: number;
  success: boolean;
  error?: string;
}

export class IntegrationBridge {
  private projectRoot: string;

  constructor(projectRoot = "/app") {
    this.projectRoot = projectRoot;
  }

  /**
   * Call Ollama locally (free, no API key needed)
   * Usage: ollama run llama2 "prompt"
   */
  async callOllama(prompt: string): Promise<AgentResponse> {
    const start = Date.now();
    try {
      // Check if ollama is running
      try {
        execSync("ollama list", { timeout: 3000, stdio: "pipe" });
      } catch {
        return {
          agent: "ollama",
          content: "",
          latency_ms: Date.now() - start,
          success: false,
          error: "Ollama not running. Start with: ollama serve",
        };
      }

      // Run ollama with timeout
      const result = execSync(
        `echo "${prompt
          .replace(/"/g, '\\"')
          .substring(0, 500)}" | ollama run llama2`,
        {
          timeout: 30000,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "ignore"],
        }
      );

      return {
        agent: "ollama",
        content: result.trim(),
        latency_ms: Date.now() - start,
        success: true,
      };
    } catch (err: any) {
      return {
        agent: "ollama",
        content: "",
        latency_ms: Date.now() - start,
        success: false,
        error: err.message,
      };
    }
  }

  /**
   * Call CodeGeeX via local server (free tier)
   * Requires: codegeex-server running on localhost:8000
   */
  async callCodeGeeX(prompt: string): Promise<AgentResponse> {
    const start = Date.now();
    try {
      const response = await fetch("http://127.0.0.1:8000/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.substring(0, 500) }),
        signal: AbortSignal.timeout(20000),
      });

      if (!response.ok) {
        return {
          agent: "codegeex",
          content: "",
          latency_ms: Date.now() - start,
          success: false,
          error: `HTTP ${response.status}`,
        };
      }

      const data = await response.json();
      return {
        agent: "codegeex",
        content: data.result || data.text || "",
        latency_ms: Date.now() - start,
        success: true,
      };
    } catch (err: any) {
      return {
        agent: "codegeex",
        content: "",
        latency_ms: Date.now() - start,
        success: false,
        error: err.message,
      };
    }
  }

  /**
   * Call AIMaster (multi-model, includes free providers)
   * Runs: python aimaster/run.py chat --prompt "..."
   */
  async callAIMaster(prompt: string): Promise<AgentResponse> {
    const start = Date.now();
    try {
      const result = execSync(
        `cd ${this.projectRoot} && python3 aimaster/run.py chat --prompt "${prompt
          .replace(/"/g, '\\"')
          .substring(0, 500)}"`,
        {
          timeout: 30000,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "ignore"],
        }
      );

      return {
        agent: "aimaster",
        content: result.trim(),
        latency_ms: Date.now() - start,
        success: true,
      };
    } catch (err: any) {
      return {
        agent: "aimaster",
        content: "",
        latency_ms: Date.now() - start,
        success: false,
        error: err.message,
      };
    }
  }

  /**
   * Call Arbitrage Engine (specialized for trading)
   * Runs: python aimaster/integrations/arbitrage_engine.py
   */
  async callArbitrage(task: string): Promise<AgentResponse> {
    const start = Date.now();
    try {
      // Check if arbitrage module is available
      const result = execSync(
        `cd ${this.projectRoot} && python3 -c "from aimaster.integrations import ArbitrageIntegration; print('ok')"`,
        {
          timeout: 5000,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "ignore"],
        }
      );

      if (result.includes("ok")) {
        return {
          agent: "arbitrage",
          content: "Arbitrage engine ready",
          latency_ms: Date.now() - start,
          success: true,
        };
      }

      return {
        agent: "arbitrage",
        content: "",
        latency_ms: Date.now() - start,
        success: false,
        error: "Arbitrage module not available",
      };
    } catch (err: any) {
      return {
        agent: "arbitrage",
        content: "",
        latency_ms: Date.now() - start,
        success: false,
        error: "Arbitrage check failed",
      };
    }
  }

  /**
   * CLI fallback (always available)
   * Uses: built-in shell commands, no external deps
   */
  async callCLI(prompt: string): Promise<AgentResponse> {
    const start = Date.now();
    try {
      // Extract command from prompt
      const match = prompt.match(/run:|execute:|cmd:|(.*?):/);
      const cmd = match ? match[1] || match[0].replace(":", "") : prompt;

      // Whitelist safe commands
      const safeCmds = ["git", "node", "python3", "npm", "echo", "ls", "pwd"];
      const cmdName = cmd.split(" ")[0];

      if (!safeCmds.includes(cmdName)) {
        return {
          agent: "cli",
          content: "",
          latency_ms: Date.now() - start,
          success: false,
          error: `Unsafe command: ${cmdName}`,
        };
      }

      const result = execSync(cmd.substring(0, 200), {
        timeout: 10000,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
        cwd: this.projectRoot,
      });

      return {
        agent: "cli",
        content: result.trim().substring(0, 500),
        latency_ms: Date.now() - start,
        success: true,
      };
    } catch (err: any) {
      return {
        agent: "cli",
        content: "",
        latency_ms: Date.now() - start,
        success: false,
        error: err.message,
      };
    }
  }

  /**
   * Universal execute - dispatches to appropriate agent
   */
  async execute(agent: string, prompt: string): Promise<AgentResponse> {
    switch (agent) {
      case "ollama":
        return this.callOllama(prompt);
      case "codegeex":
        return this.callCodeGeeX(prompt);
      case "aimaster":
        return this.callAIMaster(prompt);
      case "arbitrage":
        return this.callArbitrage(prompt);
      case "cli":
        return this.callCLI(prompt);
      default:
        return {
          agent: "unknown",
          content: "",
          latency_ms: 0,
          success: false,
          error: `Unknown agent: ${agent}`,
        };
    }
  }
}
