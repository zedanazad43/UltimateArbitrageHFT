#!/usr/bin/env python3
"""
Ollama Provider for AIMaster
Connects to local Ollama server for open-source models (CodeGeeX, Llama, etc.)
"""

import logging
from typing import Dict, Any, List, Optional
import requests as _requests

from .base import BaseProvider, ProviderResult

logger = logging.getLogger(__name__)


class OllamaProvider(BaseProvider):
    """Provider for local Ollama models."""
    
    provider_name = "ollama"

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.base_url = config.get("base_url", "http://127.0.0.1:11434")
        self.model = config.get("default_model", "codegeex4")
        self.timeout = config.get("timeout_seconds", 300)
        self.num_ctx = config.get("num_ctx", 2048)

    def health_check(self) -> bool:
        """Check if Ollama server is reachable."""
        try:
            resp = _requests.get(
                f"{self.base_url}/api/tags",
                timeout=5,
            )
            if resp.ok:
                logger.info(f"✓ {self.provider_name} health check passed")
                return True
            logger.warning(f"Ollama returned status {resp.status_code}")
            return False
        except _requests.exceptions.ConnectionError:
            logger.debug(f"Ollama not reachable at {self.base_url}")
            return False
        except Exception as e:
            logger.warning(f"Ollama health check error: {e}")
            return False

    def list_models(self) -> List[str]:
        """List available models on the Ollama server."""
        try:
            resp = _requests.get(f"{self.base_url}/api/tags", timeout=10)
            if resp.ok:
                models = resp.json().get("models", [])
                return [m.get("name", "unknown") for m in models]
        except Exception:
            pass
        return []

    def _chat_impl(
        self,
        messages: List[Dict[str, str]],
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        **kwargs,
    ) -> ProviderResult:
        """Send chat request to Ollama."""
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "options": {
                "num_ctx": self.num_ctx,
                "temperature": temperature if temperature is not None else self.config.get("temperature", 0.7),
                "num_predict": max_tokens if max_tokens is not None else self.config.get("max_tokens", 512),
            },
        }

        resp = _requests.post(
            f"{self.base_url}/api/chat",
            json=payload,
            timeout=self.timeout,
        )

        if not resp.ok:
            error_text = resp.text[:500]
            logger.error(f"Ollama chat error HTTP {resp.status_code}: {error_text}")
            return ProviderResult(
                success=False,
                provider_name=self.provider_name,
                model=self.model,
                error=f"HTTP {resp.status_code}: {error_text}",
            )

        data = resp.json()
        content = (data.get("message") or {}).get("content", "")
        eval_count = data.get("eval_count", 0)
        prompt_eval_count = data.get("prompt_eval_count", 0)

        return ProviderResult(
            success=True,
            content=content.strip(),
            provider_name=self.provider_name,
            model=self.model,
            tokens_used=eval_count + prompt_eval_count,
        )