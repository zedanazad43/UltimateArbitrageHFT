#!/usr/bin/env python3
"""
AIMaster Configuration Manager
Loads settings from aimaster-config.json and environment variables.
"""

import json
import os
from pathlib import Path
from typing import Dict, Any, Optional

# ─────────────────────────────────────────────────────────────
# Default configuration
# ─────────────────────────────────────────────────────────────

DEFAULT_CONFIG: Dict[str, Any] = {
    "agent_name": "AIMaster",
    "version": "1.0.0",
    "default_provider": "auto",  # auto | ollama | deepseek | codegeex | github
    "fallback_chain": ["local", "deepseek", "codegeex_api", "github"],
    "providers": {
        "ollama": {
            "enabled": True,
            "base_url": "http://127.0.0.1:11434",
            "default_model": "codegeex4",
            "timeout_seconds": 300,
            "num_ctx": 2048,
            "temperature": 0.7,
            "max_tokens": 512,
        },
        "deepseek": {
            "enabled": True,
            "api_key_env": "DEEPSEEK_API_KEY",
            "base_url": "https://api.deepseek.com/v1",
            "default_model": "deepseek-chat",
            "timeout_seconds": 60,
            "temperature": 0.7,
            "max_tokens": 1024,
        },
        "codegeex_api": {
            "enabled": True,
            "api_key_env": "CODEGEEX_API_KEY",
            "base_url": "https://open.bigmodel.cn/api/paas/v4",
            "default_model": "codegeex-4",
            "timeout_seconds": 60,
            "temperature": 0.7,
            "max_tokens": 1024,
        },
        "codegeex_local": {
            "enabled": True,
            "base_url": "http://127.0.0.1:8000",
            "default_model": "codegeex4",
            "timeout_seconds": 180,
            "temperature": 0.7,
            "max_tokens": 512,
        },
        "github_copilot": {
            "enabled": True,
            "api_key_env": "GITHUB_TOKEN",
            "base_url": "https://api.github.com",
            "default_model": "copilot",
            "timeout_seconds": 30,
        },
    },
    "routing": {
        "strategy": "priority",  # priority | round_robin | random | fastest
        "health_check_interval_seconds": 60,
        "max_retries": 2,
        "retry_delay_seconds": 1,
    },
    "logging": {
        "level": "INFO",
        "file": "logs/aimaster.log",
        "max_size_mb": 10,
        "backup_count": 3,
    },
}

# ─────────────────────────────────────────────────────────────
# Config file paths to search
# ─────────────────────────────────────────────────────────────

CONFIG_FILENAMES = [
    "aimaster-config.json",
    "config.json",
    ".aimaster.json",
]


def _find_config_file() -> Optional[Path]:
    """Search for config file in current directory and parents."""
    search_dir = Path.cwd()
    for _ in range(5):  # Search up to 5 levels up
        for name in CONFIG_FILENAMES:
            candidate = search_dir / name
            if candidate.exists():
                return candidate
        parent = search_dir.parent
        if parent == search_dir:
            break
        search_dir = parent
    return None


def _deep_merge(base: dict, override: dict) -> dict:
    """Recursively merge override into base dict."""
    result = base.copy()
    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def load_config(config_path: Optional[str] = None) -> Dict[str, Any]:
    """
    Load configuration from file and environment variables.

    Priority (lowest to highest):
    1. DEFAULT_CONFIG (hardcoded defaults)
    2. aimaster-config.json (file on disk)
    3. Environment variables (AIMASTER_*)

    Args:
        config_path: Optional explicit path to config file.

    Returns:
        Merged configuration dictionary.
    """
    config = DEFAULT_CONFIG.copy()

    # Load from file
    if config_path:
        file_path = Path(config_path)
    else:
        file_path = _find_config_file()

    if file_path and file_path.exists():
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                file_config = json.load(f)
            config = _deep_merge(config, file_config)
        except (json.JSONDecodeError, IOError) as e:
            import logging
            logging.warning(f"Could not load config from {file_path}: {e}")

    # Override from environment variables
    config = _apply_env_overrides(config)

    return config


def _apply_env_overrides(config: Dict[str, Any]) -> Dict[str, Any]:
    """Apply AIMASTER_* environment variable overrides."""
    env_mapping = {
        "AIMASTER_DEFAULT_PROVIDER": ("default_provider", str),
        "AIMASTER_OLLAMA_URL": ("providers.ollama.base_url", str),
        "AIMASTER_OLLAMA_MODEL": ("providers.ollama.default_model", str),
        "AIMASTER_DEEPSEEK_KEY": ("providers.deepseek.api_key_env", str),
        "AIMASTER_DEEPSEEK_MODEL": ("providers.deepseek.default_model", str),
        "AIMASTER_CODEGEEX_KEY": ("providers.codegeex_api.api_key_env", str),
        "AIMASTER_CODEGEEX_LOCAL_URL": ("providers.codegeex_local.base_url", str),
        "AIMASTER_GITHUB_TOKEN": ("providers.github_copilot.api_key_env", str),
        "AIMASTER_LOG_LEVEL": ("logging.level", str),
        "AIMASTER_TIMEOUT": ("providers.ollama.timeout_seconds", int),
    }

    for env_var, (config_path, cast) in env_mapping.items():
        value = os.environ.get(env_var)
        if value is not None:
            _set_nested(config, config_path, cast(value))

    return config


def _set_nested(d: dict, path: str, value: Any) -> None:
    """Set a nested dict value using dot-notation path."""
    keys = path.split(".")
    for key in keys[:-1]:
        d = d.setdefault(key, {})
    d[keys[-1]] = value


def get_provider_config(config: Dict[str, Any], provider_name: str) -> Dict[str, Any]:
    """Extract configuration for a specific provider."""
    return config.get("providers", {}).get(provider_name, {})


def get_api_key(provider_config: Dict[str, Any]) -> Optional[str]:
    """
    Resolve API key from environment variable specified in config.
    Example: provider_config['api_key_env'] = 'DEEPSEEK_API_KEY'
    Returns the value of os.environ['DEEPSEEK_API_KEY'] or None.
    """
    env_var = provider_config.get("api_key_env", "")
    if env_var:
        return os.environ.get(env_var)
    return None