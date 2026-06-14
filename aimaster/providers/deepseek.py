#!/usr/bin/env python3
"""
DeepSeek Provider for AIMaster
Connects to DeepSeek cloud API for reasoning and code generation.
"""

import logging
import os
from typing import Dict, Any, List, Optional
import requests as _requests

from .base import BaseProvider, ProviderResult

logger = logging.getLogger(__name__)


class DeepSeekProvider(BaseProvider):
    """Provider for DeepSeek cloud API (deepseek-chat, deepseek-reasoner)."""

    provider_name = "deepseek"

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.base_url = config.get("base_url", "https://api.deepseek.com/v1")
        self.model = config.get("default_model", "deepseek-chat")
        self.timeout = config.get("timeout_seconds", 60)
        self._api_key = self._resolve_api_key(config)

    def _resolve_api_key(self, config: Dict[str, Any]) -> Optional[str]:
        """Resolve API key from environment or config."""
        # Check config's env var name
        env_var = config.get("api_key_env", "DEEPSEEK_API_KEY")
        key = os.environ.get(env_var)
        if key:
            return key
        # Fallback: direct key in config (not recommended for production)
        return config.get("api_key") or config.get("apiKey")

    def health_check(self) -> bool:
        """Check if DeepSeek API is reachable with valid credentials."""
        if not self._api_key:
            logger.debug("DeepSeek: no API key configured")
            return False
        try:
            resp = _requests.get(
                f"{self.base_url}/models",
                headers={"Authorization": f"Bearer {self._api_key}"},
                timeout=10,
            )
            if resp.ok:
                logger.info("✓ deepseek health check passed")
                return True
            logger.warning(f"DeepSeek health check failed: HTTP {resp.status_code}")
            return False
        except _requests.exceptions.ConnectionError:
            logger.debug(f"DeepSeek not reachable at {self.base_url}")
            return False
        except Exception as e:
            logger.warning(f"DeepSeek health check error: {e}")
            return False

    def _chat_impl(
        self,
        messages: List[Dict[str, str]],
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        **kwargs,
    ) -> ProviderResult:
        """Send chat request to DeepSeek API (OpenAI-compatible)."""
        if not self._api_key:
            return ProviderResult(
                success=False,
                provider_name=self.provider_name,
                error="No API key configured. Set DEEPSEEK_API_KEY environment variable.",
            )

        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature if temperature is not None else self.config.get("temperature", 0.7),
            "max_tokens": max_tokens if max_tokens is not None else self.config.get("max_tokens", 1024),
        }
        # Add reasoning-specific param if using reasoner model
        if "reasoner" in self.model:
            payload.pop("temperature", None)

        resp = _requests.post(
            f"{self.base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=self.timeout,
        )

        if not resp.ok:
            error_text = resp.text[:500]
            logger.error(f"DeepSeek chat error HTTP {resp.status_code}: {error_text}")
            return ProviderResult(
                success=False,
                provider_name=self.provider_name,
                model=self.model,
                error=f"HTTP {resp.status_code}: {error_text}",
            )

        data = resp.json()
        choices = data.get("choices", [])
        if not choices:
            return ProviderResult(
                success=False,
                provider_name=self.provider_name,
                model=self.model,
                error="No choices returned from DeepSeek",
            )

        content = choices[0].get("message", {}).get("content", "")
        usage = data.get("usage", {})
        tokens = usage.get("total_tokens", 0)

        return ProviderResult(
            success=True,
            content=content.strip(),
            provider_name=self.provider_name,
            model=self.model,
            tokens_used=tokens,
            metadata={"usage": usage},
        )