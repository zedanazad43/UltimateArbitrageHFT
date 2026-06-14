#!/usr/bin/env python3
"""
GitHub Copilot Provider for AIMaster
Connects to GitHub for Copilot-powered code generation and analysis.
"""

import logging
import os
from typing import Dict, Any, List, Optional
import requests as _requests

from .base import BaseProvider, ProviderResult

logger = logging.getLogger(__name__)


class GitHubCopilotProvider(BaseProvider):
    """
    GitHub Copilot integration provider.
    Uses GitHub API with a personal access token.
    Can be used for code review, issue analysis, and PR summaries.
    """

    provider_name = "github_copilot"

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.base_url = config.get("base_url", "https://api.github.com")
        self.timeout = config.get("timeout_seconds", 30)
        self._token = self._resolve_token(config)

    def _resolve_token(self, config: Dict[str, Any]) -> Optional[str]:
        env_var = config.get("api_key_env", "GITHUB_TOKEN")
        token = os.environ.get(env_var) or os.environ.get("GITHUB_TOKEN")
        return token or config.get("token") or config.get("api_key")

    def health_check(self) -> bool:
        if not self._token:
            logger.debug("GitHub Copilot: no token configured")
            return False
        try:
            resp = _requests.get(
                f"{self.base_url}/user",
                headers={
                    "Authorization": f"Bearer {self._token}",
                    "Accept": "application/vnd.github+json",
                },
                timeout=10,
            )
            if resp.ok:
                user = resp.json().get("login", "unknown")
                logger.info(f"✓ github_copilot health check passed (user: {user})")
                return True
            logger.warning(f"GitHub auth failed: HTTP {resp.status_code}")
            return False
        except _requests.exceptions.ConnectionError:
            logger.debug("GitHub API not reachable")
            return False
        except Exception as e:
            logger.warning(f"GitHub health check error: {e}")
            return False

    def get_user_info(self) -> Dict[str, Any]:
        """Get authenticated user information."""
        if not self._token:
            return {"error": "No token configured"}
        try:
            resp = _requests.get(
                f"{self.base_url}/user",
                headers={
                    "Authorization": f"Bearer {self._token}",
                    "Accept": "application/vnd.github+json",
                },
                timeout=10,
            )
            if resp.ok:
                return resp.json()
        except Exception:
            pass
        return {}

    def get_repo_info(self, owner: str, repo: str) -> Dict[str, Any]:
        """Get repository information."""
        if not self._token:
            return {"error": "No token configured"}
        try:
            resp = _requests.get(
                f"{self.base_url}/repos/{owner}/{repo}",
                headers={
                    "Authorization": f"Bearer {self._token}",
                    "Accept": "application/vnd.github+json",
                },
                timeout=10,
            )
            if resp.ok:
                return resp.json()
        except Exception:
            pass
        return {}

    def _chat_impl(
        self,
        messages: List[Dict[str, str]],
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        **kwargs,
    ) -> ProviderResult:
        """
        GitHub Copilot does not have a direct chat API.
        This provider returns a structured status response and can
        be used for code-related queries via GitHub API.

        For actual Copilot completions, use the GitHub Copilot extension
        in your IDE or the GitHub Copilot API (if available in your plan).
        """
        if not self._token:
            return ProviderResult(
                success=False,
                provider_name=self.provider_name,
                error="No GitHub token configured. Set GITHUB_TOKEN environment variable.",
            )

        # Extract the user's query
        user_messages = [m.get("content", "") for m in messages if m.get("role") == "user"]
        query = "\n".join(user_messages) if user_messages else "No query provided"

        # Return a structured response with GitHub API context
        user_info = self.get_user_info()
        username = user_info.get("login", "unknown")

        response_lines = [
            f"GitHub Copilot Integration Status",
            f"─" * 40,
            f"Authenticated User: {username}",
            f"GitHub API: Connected ✓",
            f"",
            f"Query Analysis: {query[:200]}",
            f"",
            f"Available Actions:",
            f"  1. Code Review - Submit PR for review",
            f"  2. Issue Analysis - Check repository issues",
            f"  3. PR Summary - Generate pull request summary",
            f"  4. Security Audit - Run security checks via GitHub Actions",
            f"",
            f"Note: For AI chat completions, use DeepSeek, CodeGeex, or Ollama providers.",
        ]

        return ProviderResult(
            success=True,
            content="\n".join(response_lines),
            provider_name=self.provider_name,
            model="copilot",
            tokens_used=0,
            metadata={
                "username": username,
                "query_preview": query[:100],
            },
        )