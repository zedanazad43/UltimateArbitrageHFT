#!/usr/bin/env python3
r"""
OllamaAgentWrapper - Integrates the local Ollama agent (from generated_ai_agent.py)
into the AIMaster ecosystem. Provides web search + multi-model Ollama inference.
"""

import os
import sys
import subprocess
import logging
from typing import List, Optional, Dict, Any

logger = logging.getLogger(__name__)

# Add user's home path to find modules
_USER_HOME = os.path.expanduser("~")
if _USER_HOME not in sys.path:
    sys.path.insert(0, _USER_HOME)


class OllamaAgentWrapper:
    """
    Wraps the AI agent logic from C:\\Users\\azadz\\generated_ai_agent.py
    providing unified access to local Ollama models, web search, and tools.
    """

    def __init__(self, ollama_url: str = "http://127.0.0.1:11434"):
        self.ollama_url = ollama_url
        self.models: List[str] = []
        self.tools: Dict[str, Any] = {}
        self._detect_models()

    def _detect_models(self):
        """Detect installed Ollama models."""
        try:
            result = subprocess.run(
                ["ollama", "list"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=10,
            )
            if result.returncode == 0:
                lines = result.stdout.strip().split("\n")
                for line in lines[1:]:  # Skip header
                    if line.strip():
                        model_name = line.split()[0]
                        self.models.append(model_name)
                logger.info(f"Ollama models detected: {self.models}")
        except Exception as e:
            logger.warning(f"Could not get Ollama models: {e}")

    def list_models(self) -> List[str]:
        return self.models.copy()

    def call_model(self, model: str, prompt: str, timeout: int = 60) -> Optional[str]:
        """Call a specific Ollama model."""
        try:
            res = subprocess.run(
                ["ollama", "run", model, prompt],
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=timeout,
            )
            if res.returncode == 0:
                return res.stdout.strip()
        except subprocess.TimeoutExpired:
            logger.warning(f"Ollama model {model} timed out after {timeout}s")
        except Exception as e:
            logger.debug(f"Ollama model {model} error: {e}")
        return None

    def call_all_models(self, prompt: str, timeout: int = 60) -> Optional[str]:
        """Try all available models, return first successful response."""
        for model in self.models:
            resp = self.call_model(model, prompt, timeout=timeout)
            if resp and not resp.startswith("[Error"):
                logger.info(f"Got response from model: {model}")
                return resp
        return None

    def web_search(self, query: str) -> str:
        """Search the web using DuckDuckGo API."""
        try:
            import requests

            resp = requests.get(
                "https://api.duckduckgo.com",
                params={"q": query, "format": "json", "no_html": 1},
                timeout=10,
            )
            data = resp.json()
            abstract = data.get("AbstractText", "")
            if not abstract:
                related = data.get("RelatedTopics", [])
                texts = [
                    t.get("Text", "") for t in related[:3] if t.get("Text")
                ]
                return "\n".join(texts) if texts else "No results found"
            return abstract
        except Exception as e:
            logger.debug(f"Web search failed: {e}")
            return "Search unavailable"

    def chat(self, prompt: str, include_search: bool = True) -> Dict[str, Any]:
        """
        Full agent pipeline: web search + Ollama inference.

        Returns:
            Dict with 'response', 'model', 'search_results', 'tools_output'
        """
        search_results = ""
        if include_search:
            search_results = self.web_search(prompt)

        context = f"User query: {prompt}\n"
        if search_results and search_results != "Search unavailable":
            context += f"Web search results:\n{search_results}\n\n"
        context += "Provide a helpful and direct answer."

        response = self.call_all_models(context)

        if not response and not self.models:
            response = (
                "No Ollama models available. Install models with: ollama pull codegeex4"
            )

        return {
            "success": response is not None and len(response) > 0,
            "response": response or "No AI models available",
            "model": self.models[0] if self.models else "none",
            "search_results": search_results,
            "tools_output": "",
            "models_available": self.models,
        }

    def __repr__(self) -> str:
        return f"<OllamaAgentWrapper models={self.models}>"