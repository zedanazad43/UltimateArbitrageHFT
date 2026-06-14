#!/usr/bin/env python3
r"""
AgentOrchestrator - The Ultimate AI Agent Hub
==============================================
Unifies all AI agents into a single orchestration layer:
- Ollama (local models): CodeGeeX, Llama, DeepSeek-Coder
- DeepSeek (cloud API): deepseek-chat, deepseek-reasoner
- CodeGeeX (cloud API): codegeex-4 via Zhipu AI
- CodeGeeX (local): via codegeex-server.py bridge
- GitHub Copilot: API integrations
- Web Search: DuckDuckGo
- Arbitrage Engine: ultra_fast_arbitrage.py
"""

import asyncio
import logging
import os
from datetime import datetime
from typing import Dict, Any, List, Optional

from ..master import AIMasterAgent
from ..config import load_config, get_provider_config
from .ollama_agent import OllamaAgentWrapper
from .arbitrage_engine import ArbitrageIntegration

logger = logging.getLogger(__name__)


class AgentOrchestrator:
    """Central hub that orchestrates ALL AI agents and tools."""

    def __init__(
        self,
        config_path: Optional[str] = None,
        enable_arbitrage: bool = True,
        enable_deepseek: bool = True,
        enable_codegeex: bool = True,
        enable_ollama_agent: bool = True,
    ):
        self.config = load_config(config_path)
        self._setup_logging()
        self.ai_master = AIMasterAgent(config_path)

        self.ollama_agent: Optional[OllamaAgentWrapper] = None
        if enable_ollama_agent:
            try:
                self.ollama_agent = OllamaAgentWrapper()
                logger.info("OllamaAgent loaded: %s", self.ollama_agent.models)
            except Exception as e:
                logger.warning("OllamaAgent init failed: %s", e)

        self.arbitrage: Optional[ArbitrageIntegration] = None
        if enable_arbitrage:
            try:
                arb_config = self.config.get("arbitrage", {})
                self.arbitrage = ArbitrageIntegration(arb_config)
                logger.info("ArbitrageIntegration loaded")
            except Exception as e:
                logger.warning("ArbitrageIntegration init failed: %s", e)

        self.status: Dict[str, Any] = {
            "started_at": datetime.now().isoformat(),
            "version": self.config.get("version", "1.0.0"),
            "agents": {},
        }

        logger.info(
            "AgentOrchestrator initialized: AI=%d arbitrage=%s ollama=%s",
            len(self.ai_master.providers),
            "enabled" if self.arbitrage else "disabled",
            "enabled" if self.ollama_agent else "disabled",
        )

    def _setup_logging(self):
        log_cfg = self.config.get("logging", {})
        logging.basicConfig(
            level=getattr(logging, log_cfg.get("level", "INFO").upper(), logging.INFO),
            format="%(asctime)s - Orchestrator - %(levelname)s - %(message)s",
        )

    def health_report(self) -> Dict[str, Any]:
        report = {
            "timestamp": datetime.now().isoformat(),
            "ai_master": self.ai_master.list_providers(),
            "ollama_agent": {},
            "arbitrage": {},
            "available_providers": self.ai_master.get_available_providers(),
        }
        if self.ollama_agent:
            report["ollama_agent"] = {
                "available": True,
                "models": self.ollama_agent.models,
                "model_count": len(self.ollama_agent.models),
            }
        else:
            report["ollama_agent"] = {"available": False}
        if self.arbitrage:
            report["arbitrage"] = {"available": True, **self.arbitrage.get_stats()}
        else:
            report["arbitrage"] = {"available": False}
        return report

    def print_health(self):
        report = self.health_report()
        providers = report["available_providers"]
        print("=" * 70)
        print("  AIMaster Agent Orchestrator - Health Report")
        print("=" * 70)
        print("  Started:", report["timestamp"])
        print("  AI Providers Available:", len(providers))
        for p in providers:
            print("    [+] " + p)
        if report["ollama_agent"]["available"]:
            m = report["ollama_agent"]
            print("  Ollama Models: %d (%s)" % (m["model_count"], ", ".join(m["models"])))
        if report["arbitrage"]["available"]:
            a = report["arbitrage"]
            print("  Arbitrage: %d scans, %d opportunities" % (a["total_scans"], a["opportunities_found"]))
        print("=" * 70)

    def chat_ai(self, prompt: str, **kwargs) -> Dict[str, Any]:
        result = self.ai_master.chat(prompt=prompt, **kwargs)
        return result.to_dict()

    def chat_provider(self, prompt: str, provider: str, **kwargs) -> Dict[str, Any]:
        result = self.ai_master.chat(prompt=prompt, provider=provider, **kwargs)
        return result.to_dict()

    def chat_ollama(self, prompt: str, include_search: bool = False) -> Dict[str, Any]:
        if not self.ollama_agent:
            return {"success": False, "error": "Ollama agent not available"}
        return self.ollama_agent.chat(prompt, include_search=include_search)

    def scan_arbitrage(self) -> Dict[str, Any]:
        if not self.arbitrage:
            return {"error": "Arbitrage not enabled", "opportunities": []}
        opps = self.arbitrage.scan()
        return {
            "timestamp": datetime.now().isoformat(),
            "opportunities": [o.to_dict() for o in opps],
            "count": len(opps),
            "stats": self.arbitrage.get_stats(),
        }

    def get_arbitrage_stats(self) -> Dict[str, Any]:
        if not self.arbitrage:
            return {"error": "Arbitrage not enabled"}
        return self.arbitrage.get_stats()

    def set_live_trading(self, enabled: bool):
        if self.arbitrage:
            self.arbitrage.set_live_mode(enabled)

    def web_search(self, query: str) -> str:
        if self.ollama_agent:
            return self.ollama_agent.web_search(query)
        return "Web search not available"

    def query(self, prompt: str, use_arbitrage: bool = False) -> Dict[str, Any]:
        result = {
            "timestamp": datetime.now().isoformat(),
            "prompt": prompt,
            "ai_response": None,
            "arbitrage": None,
            "web_search": None,
        }
        try:
            result["ai_response"] = self.chat_ai(prompt)
        except Exception as e:
            result["ai_response"] = {"error": str(e)}
        if use_arbitrage and self.arbitrage:
            result["arbitrage"] = self.scan_arbitrage()
        if self.ollama_agent:
            result["web_search"] = self.ollama_agent.web_search(prompt)[:500]
        return result

    def run_command(self, command: str, *args) -> str:
        commands = {
            "health": self.print_health,
            "scan": lambda: self._fmt_scan(),
            "ai": lambda: self.chat_ai(" ".join(args)).get("content", "No response"),
            "providers": lambda: "\n".join(self.ai_master.get_available_providers()),
            "stats": lambda: str(self.get_arbitrage_stats()),
        }
        if command in commands:
            result = commands[command]()
            return str(result) if result is not None else "OK"
        return "Unknown command: " + command + ". Available: " + str(list(commands.keys()))

    def _fmt_scan(self) -> str:
        opps = self.scan_arbitrage()
        if not opps.get("opportunities"):
            return "No arbitrage opportunities found."
        lines = ["Found %d opportunities:" % opps["count"]]
        for o in opps["opportunities"]:
            lines.append(
                "  %s: %s->%s +%.2f%% ($%.2f)"
                % (o["symbol"], o["buy_exchange"], o["sell_exchange"], o["profit_percent"], o["net_profit_usd"])
            )
        return "\n".join(lines)

    def __repr__(self) -> str:
        providers = self.ai_master.get_available_providers()
        return (
            "<AgentOrchestrator v%s AI=%d arbitrage=%s ollama=%s>"
            % (
                self.config.get("version"),
                len(providers),
                "ON" if self.arbitrage else "OFF",
                "ON" if self.ollama_agent else "OFF",
            )
        )