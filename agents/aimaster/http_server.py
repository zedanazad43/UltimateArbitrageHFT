#!/usr/bin/env python3
"""
AIMaster HTTP Server
Exposes the AIMaster chat functionality via a simple HTTP API.

Endpoints:
  POST /chat       - Send a chat prompt and get AI response
  GET  /health     - Health check and provider status
"""

import json
import logging
from typing import Dict, Any, Optional, Tuple

logger = logging.getLogger(__name__)


class HTTPServer:
    """Minimal HTTP server wrapper for AIMaster."""

    def __init__(self, agent, host: str = "127.0.0.1", port: int = 8000):
        """
        Initialize HTTP server.

        Args:
            agent: AIMasterAgent instance
            host: Server host (default: 127.0.0.1)
            port: Server port (default: 8000)
        """
        self.agent = agent
        self.host = host
        self.port = port
        self.app = None
        self._setup_flask()

    def _setup_flask(self):
        """Set up Flask app with routes."""
        try:
            from flask import Flask, request, jsonify
        except ImportError:
            logger.error(
                "Flask not installed. Install with: pip install flask"
            )
            raise

        self.app = Flask(__name__)
        self.request = request
        self.jsonify = jsonify

        @self.app.route("/chat", methods=["POST"])
        def chat_endpoint():
            """POST /chat — Forward prompt to AIMaster and return response."""
            try:
                data = request.get_json(force=True) or {}
            except Exception:
                return self.jsonify(
                    {"error": "Invalid JSON in request body"}
                ), 400

            prompt = data.get("prompt") or data.get("message") or data.get("query")
            if not prompt:
                return self.jsonify(
                    {"error": "Missing field: prompt (or message, query)"}
                ), 400

            if not isinstance(prompt, str):
                return self.jsonify(
                    {"error": "Field 'prompt' must be a string"}
                ), 400

            if len(prompt) > 50000:
                return self.jsonify(
                    {"error": "Prompt too long (max 50000 characters)"}
                ), 400

            # Optional parameters
            provider = data.get("provider")
            system_prompt = data.get("system_prompt") or data.get("system")
            temperature = data.get("temperature")
            max_tokens = data.get("max_tokens")
            stream = data.get("stream", False)

            if stream:
                return self.jsonify(
                    {"error": "Streaming not yet supported"}
                ), 400

            try:
                logger.debug(f"[HTTP] Chat request: {prompt[:100]}")
                result = self.agent.chat(
                    prompt=prompt,
                    provider=provider,
                    system_prompt=system_prompt,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )

                if result.success:
                    response_data = {
                        "response": result.content,
                        "content": result.content,
                        "provider": result.provider_name,
                        "model": result.model,
                        "latency_ms": result.latency_ms,
                        "tokens_used": result.tokens_used,
                    }
                    logger.debug(
                        f"[HTTP] Response OK: {result.provider_name} "
                        f"({result.latency_ms:.0f}ms)"
                    )
                    return self.jsonify(response_data), 200
                else:
                    logger.warning(f"[HTTP] Chat error: {result.error}")
                    return self.jsonify(
                        {"error": result.error}
                    ), 503

            except Exception as e:
                logger.exception(f"[HTTP] Unexpected error during chat: {e}")
                return self.jsonify(
                    {"error": f"Internal server error: {str(e)}"}
                ), 500

        @self.app.route("/health", methods=["GET"])
        def health_endpoint():
            """GET /health — Return health status of all providers."""
            try:
                health = self.agent.health_check()
                available = self.agent.get_available_providers()

                response_data = {
                    "status": "healthy" if available else "degraded",
                    "providers": health,
                    "available": available,
                    "available_count": len(available),
                    "total_count": len(health),
                }
                logger.debug(
                    f"[HTTP] Health check: {len(available)}/{len(health)} providers"
                )
                return self.jsonify(response_data), 200

            except Exception as e:
                logger.exception(f"[HTTP] Error in health check: {e}")
                return self.jsonify(
                    {"error": f"Health check failed: {str(e)}"}
                ), 500

        @self.app.route("/", methods=["GET"])
        def root():
            """GET / — API info."""
            return self.jsonify({
                "name": "AIMaster HTTP Server",
                "version": self.agent.config.get("version", "1.0"),
                "endpoints": {
                    "POST /chat": "Send a chat prompt",
                    "GET /health": "Check provider health",
                },
            }), 200

        @self.app.errorhandler(404)
        def not_found(e):
            return self.jsonify(
                {"error": "Endpoint not found"}
            ), 404

        @self.app.errorhandler(500)
        def server_error(e):
            logger.exception(f"[HTTP] Unhandled server error: {e}")
            return self.jsonify(
                {"error": "Internal server error"}
            ), 500

    def run(self, debug: bool = False):
        """
        Start the HTTP server.

        Args:
            debug: Enable Flask debug mode (default: False)
        """
        if not self.app:
            raise RuntimeError("Flask app not initialized")

        logger.info(
            f"Starting AIMaster HTTP server on {self.host}:{self.port}"
        )
        logger.info(f"  POST /chat   - Send chat prompt")
        logger.info(f"  GET  /health - Provider health")
        logger.info(f"  GET  /       - API info")

        try:
            self.app.run(
                host=self.host,
                port=self.port,
                debug=debug,
                threaded=True,
                use_reloader=False,  # Prevent double-start in debug mode
            )
        except KeyboardInterrupt:
            logger.info("Server interrupted by user")
        except Exception as e:
            logger.exception(f"HTTP server error: {e}")
            raise


def start_http_server(
    config_path: Optional[str] = None,
    host: str = "127.0.0.1",
    port: int = 8000,
    debug: bool = False,
):
    """
    Initialize AIMaster and start the HTTP server.

    Args:
        config_path: Path to aimaster-config.json
        host: Server host
        port: Server port
        debug: Enable Flask debug mode
    """
    from .master import AIMasterAgent

    agent = AIMasterAgent(config_path)
    server = HTTPServer(agent, host=host, port=port)
    server.run(debug=debug)
