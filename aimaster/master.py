#!/usr/bin/env python3
"""
AIMasterAgent - Multi-Provider AI Orchestrator
Routes requests to the best available AI backend with fallback logic.
"""

import logging
import time
from typing import Dict, Any, List, Optional

from .config import load_config, get_provider_config
from .providers.base import ProviderResult
from .providers.ollama import OllamaProvider
from .providers.deepseek import DeepSeekProvider
from .providers.codegeex import CodeGeexProvider, CodeGeexLocalProvider
from .providers.github import GitHubCopilotProvider

logger = logging.getLogger(__name__)


class AIMasterAgent:
    """
    Master AI Agent that orchestrates requests across multiple AI providers.

    Features:
    - Auto-detection of available providers
    - Priority-based routing with fallback
    - Health checks and provider status tracking
    - Unified chat interface across all backends

    Usage:
        agent = AIMasterAgent()
        result = agent.chat("Explain arbitrage trading")
        print(result.content)
    """

    def __init__(self, config_path: Optional[str] = None):
        """
        Initialize AIMaster with optional config file path.

        Args:
            config_path: Path to aimaster-config.json (optional, auto-detected).
        """
        self.config = load_config(config_path)
        self._setup_logging()

        # Initialize all providers
        self.providers: Dict[str, Any] = self._init_providers()

        # Provider priority order (local first → cloud fallbacks)
        self._priority_order = [
            "codegeex_local",
            "ollama",
            "deepseek",
            "codegeex_api",
            "github_copilot",
        ]

        # Health cache (avoid repeated checks)
        self._health_cache: Dict[str, bool] = {}
        self._last_health_check: float = 0
        self._health_interval = self.config.get("routing", {}).get(
            "health_check_interval_seconds", 60
        )

        logger.info(
            f"AIMasterAgent initialized with {len(self.providers)} providers: "
            f"{list(self.providers.keys())}"
        )

    def _setup_logging(self):
        """Configure logging from config."""
        log_cfg = self.config.get("logging", {})
        level_name = log_cfg.get("level", "INFO")
        log_file = log_cfg.get("file", "logs/aimaster.log")

        logging.basicConfig(
            level=getattr(logging, level_name.upper(), logging.INFO),
            format="%(asctime)s - AIMaster - %(levelname)s - %(message)s",
            handlers=[
                logging.StreamHandler(),
                logging.FileHandler(log_file, encoding="utf-8")
                if log_file
                else logging.NullHandler(),
            ],
        )

    def _init_providers(self) -> Dict[str, Any]:
        """Initialize all AI provider instances."""
        providers_config = self.config.get("providers", {})

        provider_map = {
            "ollama": OllamaProvider,
            "deepseek": DeepSeekProvider,
            "codegeex_api": CodeGeexProvider,
            "codegeex_local": CodeGeexLocalProvider,
            "github_copilot": GitHubCopilotProvider,
        }

        initialized = {}
        for name, provider_class in provider_map.items():
            cfg = get_provider_config(self.config, name)
            if cfg.get("enabled", True):
                try:
                    provider = provider_class(cfg)
                    initialized[name] = provider
                except Exception as e:
                    logger.error(f"Failed to init provider '{name}': {e}")

        return initialized

    def health_check(self) -> Dict[str, Any]:
        """
        Check health of all providers.

        Returns:
            Dict mapping provider_name → health_status (bool).
        """
        now = time.time()
        if self._health_cache and (now - self._last_health_check) < self._health_interval:
            return self._health_cache.copy()

        self._health_cache = {}
        for name, provider in self.providers.items():
            try:
                self._health_cache[name] = provider.is_available()
            except Exception as e:
                logger.warning(f"Health check failed for {name}: {e}")
                self._health_cache[name] = False

        self._last_health_check = now
        return self._health_cache.copy()

    def get_available_providers(self) -> List[str]:
        """List currently available (healthy) providers."""
        health = self.health_check()
        available = []
        # Sort by priority order
        for name in self._priority_order:
            if name in health and health[name]:
                available.append(name)
        # Add any providers not in priority list
        for name in health:
            if name not in available and health[name]:
                available.append(name)
        return available

    def list_providers(self) -> Dict[str, Dict[str, Any]]:
        """Get detailed status of all providers."""
        health = self.health_check()
        result = {}
        for name, provider in self.providers.items():
            result[name] = {
                "enabled": provider.enabled,
                "healthy": health.get(name, False),
                "type": provider.__class__.__name__,
                "model": getattr(provider, "model", "unknown"),
            }
        return result

    def chat(
        self,
        prompt: str = "",
        messages: Optional[List[Dict[str, str]]] = None,
        system_prompt: Optional[str] = None,
        provider: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        **kwargs,
    ) -> ProviderResult:
        """
        Send a chat request, routing to best available provider.

        Args:
            prompt: Simple text prompt.
            messages: List of {"role": "...", "content": "..."} dicts.
            system_prompt: Optional system instruction.
            provider: Force a specific provider (e.g., 'deepseek', 'ollama').
            temperature: Override temperature.
            max_tokens: Override max tokens.

        Returns:
            ProviderResult with success, content, and metadata.
        """
        # If specific provider requested, use it directly
        if provider:
            if provider in self.providers:
                return self.providers[provider].chat(
                    prompt=prompt,
                    messages=messages,
                    system_prompt=system_prompt,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    **kwargs,
                )
            return ProviderResult(
                success=False,
                error=f"Provider '{provider}' not found. Available: {list(self.providers.keys())}",
            )

        # Route to best available provider
        available = self.get_available_providers()

        if not available:
            return ProviderResult(
                success=False,
                error="No AI providers available. Check your configuration and network.",
            )

        routing_cfg = self.config.get("routing", {})
        max_retries = routing_cfg.get("max_retries", 2)
        retry_delay = routing_cfg.get("retry_delay_seconds", 1)

        last_error = None

        # Try providers in priority order with retries
        for attempt in range(max_retries + 1):
            for provider_name in available:
                prov = self.providers.get(provider_name)
                if not prov:
                    continue

                try:
                    result = prov.chat(
                        prompt=prompt,
                        messages=messages,
                        system_prompt=system_prompt,
                        temperature=temperature,
                        max_tokens=max_tokens,
                        **kwargs,
                    )
                    if result.success:
                        logger.info(
                            f"✓ Request served by {provider_name} "
                            f"(latency: {result.latency_ms:.0f}ms)"
                        )
                        return result
                    last_error = result.error
                except Exception as e:
                    last_error = str(e)
                    logger.warning(f"Provider {provider_name} failed: {e}")

            # If we have retries left, wait and try again
            if attempt < max_retries:
                logger.info(f"Retrying... ({attempt + 1}/{max_retries})")
                time.sleep(retry_delay)

        return ProviderResult(
            success=False,
            error=f"All providers failed. Last error: {last_error}",
        )

    def chat_concurrent(
        self,
        prompt: str = "",
        provider: Optional[str] = None,
        **kwargs,
    ) -> ProviderResult:
        """
        Convenience method: send a single prompt to all available providers
        and return the fastest successful response.
        """
        import concurrent.futures

        available = self.get_available_providers()
        if provider and provider in self.providers:
            available = [provider]

        if not available:
            return ProviderResult(
                success=False,
                error="No AI providers available.",
            )

        def _call(name):
            return name, self.providers[name].chat(prompt=prompt, **kwargs)

        with concurrent.futures.ThreadPoolExecutor(max_workers=len(available)) as executor:
            futures = {executor.submit(_call, name): name for name in available}
            for future in concurrent.futures.as_completed(futures):
                name, result = future.result()
                if result.success:
                    logger.info(f"✓ Fastest response from {name} ({result.latency_ms:.0f}ms)")
                    return result

        return ProviderResult(
            success=False,
            error="All providers failed concurrently.",
        )

    def __repr__(self) -> str:
        available = self.get_available_providers()
        return (
            f"<AIMasterAgent v{self.config.get('version', '1.0')} "
            f"providers={len(self.providers)} available={available}>"
        )