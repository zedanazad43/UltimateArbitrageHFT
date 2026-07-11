"""
AIMaster - Multi-Provider AI Agent Orchestrator
===============================================
Routes requests to the best available AI backend:
- Local: Ollama (CodeGeeX, Llama, etc.)
- Cloud: DeepSeek, CodeGeeX API
- Integration: GitHub Copilot

Usage:
    from aimaster import AIMasterAgent
    agent = AIMasterAgent()
    response = agent.chat("What is arbitrage?")
"""

from .master import AIMasterAgent
from .config import load_config

__version__ = "1.0.0"
__all__ = ["AIMasterAgent", "load_config"]