#!/usr/bin/env python3
"""
CodeGeeX Provider for AIMaster
Supports both local (vLLM/Ollama bridge) and cloud API (Zhipu AI).
"""

import logging
import os
from typing import Dict, Any, List, Optional
import requests as _requests

from .base import BaseProvider, ProviderResult

logger = logging.getLogger(__name__)


class CodeGeexProvider(BaseProvider):
    """
    CodeGeeX Cloud API provider (Zhipu AI platform).
    Uses OpenAI-compatible endpoint at open.bigmodel.cn.
    """

    provider_name = "codegeex_api"

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.base_url = config.get("base_url", "https://open.bigmodel.cn/api/paas/v4")
        self.model = config.get("default_model", "codegeex-4")
        self.timeout = config.get("timeout_seconds", 60)
        self._api_key = self._resolve_api_key(config)

    def _resolve_api_key(self, config: Dict[str, Any]) -> Optional[str]:
        env_var = config.get("api_key_env", "CODEGEEX_API_KEY")
        return os.environ.get(env_var) or config.get("api_key")

    def health_check(self) -> bool:
        if not self._api_key:
            logger.debug("CodeGeex API: no API key configured")
            return False
        try:
            resp = _requests.get(
                f"{self.base_url}/models",
                headers={"Authorization": f"Bearer {self._api_key}"},
                timeout=10,
            )
            if resp.ok:
                logger.info("✓ codegeex_api health check passed")
                return True
            logger.warning(f"CodeGeex API health check failed: HTTP {resp.status_code}")
            return False
        except _requests.exceptions.ConnectionError:
            logger.debug(f"CodeGeex API not reachable at {self.base_url}")
            return False
        except Exception as e:
            logger.warning(f"CodeGeex API health check error: {e}")
            return False

    def _chat_impl(
        self,
        messages: List[Dict[str, str]],
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        **kwargs,
    ) -> ProviderResult:
        if not self._api_key:
            return ProviderResult(
                success=False,
                provider_name=self.provider_name,
                error="No API key configured. Set CODEGEEX_API_KEY environment variable.",
            )

        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature if temperature is not None else self.config.get("temperature", 0.7),
            "max_tokens": max_tokens if max_tokens is not None else self.config.get("max_tokens", 1024),
        }

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
            logger.error(f"CodeGeex API chat error HTTP {resp.status_code}: {error_text}")
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
                error="No choices returned from CodeGeex API",
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


class CodeGeexLocalProvider(BaseProvider):
    """
    Local CodeGeeX provider via codegeex-server.py bridge (vLLM or Ollama backend).
    Communicates with http://127.0.0.1:8000 (OpenAI-compatible API).
    """

    provider_name = "codegeex_local"

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.base_url = config.get("base_url", "http://127.0.0.1:8000")
        self.model = config.get("default_model", "codegeex4")
        self.timeout = config.get("timeout_seconds", 180)

    def health_check(self) -> bool:
        try:
            resp = _requests.get(
                f"{self.base_url}/health",
                timeout=5,
            )
            if resp.ok:
                data = resp.json()
                if data.get("status") == "healthy":
                    logger.info("✓ codegeex_local health check passed")
                    return True
            logger.warning(f"CodeGeex local not healthy: {resp.text[:200]}")
            return False
        except _requests.exceptions.ConnectionError:
            logger.debug(f"CodeGeex local not reachable at {self.base_url}")
            return False
        except Exception as e:
            logger.warning(f"CodeGeex local health check error: {e}")
            return False

    def _chat_impl(
        self,
        messages: List[Dict[str, str]],
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        **kwargs,
    ) -> ProviderResult:
        payload = {
            "messages": messages,
            "temperature": temperature if temperature is not None else self.config.get("temperature", 0.7),
            "max_tokens": max_tokens if max_tokens is not None else self.config.get("max_tokens", 512),
        }

        resp = _requests.post(
            f"{self.base_url}/v1/chat/completions",
            json=payload,
            timeout=self.timeout,
        )

        if not resp.ok:
            error_text = resp.text[:500]
            logger.error(f"CodeGeex local chat error HTTP {resp.status_code}: {error_text}")
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
                error="No choices returned from CodeGeex local",
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