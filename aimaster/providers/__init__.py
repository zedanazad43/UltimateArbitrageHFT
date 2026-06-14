"""
AIMaster AI Providers Package
Each provider wraps a different AI backend with a unified interface.
"""

from .base import BaseProvider, ProviderResult
from .ollama import OllamaProvider
from .deepseek import DeepSeekProvider
from .codegeex import CodeGeexProvider, CodeGeexLocalProvider
from .github import GitHubCopilotProvider

__all__ = [
    "BaseProvider",
    "ProviderResult",
    "OllamaProvider",
    "DeepSeekProvider",
    "CodeGeexProvider",
    "CodeGeexLocalProvider",
    "GitHubCopilotProvider",
]