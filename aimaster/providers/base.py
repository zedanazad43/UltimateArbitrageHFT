#!/usr/bin/env python3
"""
Base Provider Interface for AIMaster
All AI providers implement this abstract interface.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, Any, Optional, List


@dataclass
class ProviderResult:
    """Unified result from any AI provider."""

    success: bool
    content: str = ""
    provider_name: str = "unknown"
    model: str = "unknown"
    error: Optional[str] = None
    tokens_used: int = 0
    latency_ms: float = 0.0
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "success": self.success,
            "content": self.content,
            "provider_name": self.provider_name,
            "model": self.model,
            "error": self.error,
            "tokens_used": self.tokens_used,
            "latency_ms": self.latency_ms,
            "timestamp": self.timestamp,
            "metadata": self.metadata,
        }


class BaseProvider(ABC):
    """
    Abstract base class for all AI providers.

    Each provider must implement:
    - provider_name: str identifier
    - _chat_impl(messages, **kwargs) -> ProviderResult
    - health_check() -> bool
    """

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Unique provider identifier (e.g. 'ollama', 'deepseek')."""
        ...

    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self._enabled = config.get("enabled", True)

    @property
    def enabled(self) -> bool:
        return self._enabled

    @enabled.setter
    def enabled(self, value: bool):
        self._enabled = value

    def is_available(self) -> bool:
        """Check if provider is configured and reachable."""
        if not self.enabled:
            return False
        return self.health_check()

    @abstractmethod
    def health_check(self) -> bool:
        """Check if the backend is reachable/healthy."""
        ...

    @abstractmethod
    def _chat_impl(
        self,
        messages: List[Dict[str, str]],
        **kwargs,
    ) -> ProviderResult:
        """Internal chat implementation."""
        ...

    def chat(
        self,
        prompt: str = "",
        messages: Optional[List[Dict[str, str]]] = None,
        system_prompt: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        **kwargs,
    ) -> ProviderResult:
        """
        Send a chat request to the provider.

        Args:
            prompt: Simple text prompt (will be wrapped in messages).
            messages: List of {"role": "...", "content": "..."} dicts.
            system_prompt: Optional system-level instruction.
            temperature: Override default temperature.
            max_tokens: Override default max tokens.

        Returns:
            ProviderResult with success, content, and metadata.
        """
        import time

        if not self.enabled:
            return ProviderResult(
                success=False,
                provider_name=self.provider_name,
                error=f"Provider '{self.provider_name}' is disabled",
            )

        # Build messages list
        if messages is None:
            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.append({"role": "user", "content": prompt})
        elif system_prompt and not any(m.get("role") == "system" for m in messages):
            messages.insert(0, {"role": "system", "content": system_prompt})

        start_time = time.time()
        try:
            result = self._chat_impl(
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                **kwargs,
            )
        except Exception as e:
            elapsed = (time.time() - start_time) * 1000
            return ProviderResult(
                success=False,
                provider_name=self.provider_name,
                error=str(e),
                latency_ms=elapsed,
            )

        # Ensure provider metadata is set
        if not result.provider_name or result.provider_name == "unknown":
            result.provider_name = self.provider_name
        if result.latency_ms == 0.0:
            result.latency_ms = (time.time() - start_time) * 1000
        return result

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__}(enabled={self.enabled})>"