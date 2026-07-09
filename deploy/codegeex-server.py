#!/usr/bin/env python3
"""
CodeGeeX Local Server - Runs CodeGeeX locally via vLLM
Exposes an OpenAI-compatible API for use by ai-client.js
"""

import json
import logging
from flask import Flask, request, jsonify
import os
from datetime import datetime
import requests

try:
    from vllm import LLM, SamplingParams
    VLLM_IMPORT_ERROR = None
except Exception as exc:
    LLM = None
    SamplingParams = None
    VLLM_IMPORT_ERROR = exc

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

MODEL_NAME = "THUDM/codegeex4-all-9b"  # CodeGeeX 4 model (9B, good for trading logic)
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "codegeex4")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
OLLAMA_TIMEOUT_SEC = int(os.getenv("OLLAMA_TIMEOUT_SEC", "300"))
OLLAMA_NUM_CTX = int(os.getenv("OLLAMA_NUM_CTX", "1024"))
BACKEND_MODE = os.getenv("LOCAL_AI_ENGINE", "auto").lower()  # auto | vllm | ollama
PORT = 8000
HOST = "127.0.0.1"
MAX_TOKENS = 512
TEMPERATURE = 0.7

# Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - CodeGeeX - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# Initialize Flask & vLLM
# ─────────────────────────────────────────────────────────────────────────────

app = Flask(__name__)

active_backend = None


def _ollama_is_available():
    try:
        resp = requests.get(f"{OLLAMA_URL}/api/tags", timeout=2)
        return resp.ok
    except Exception:
        return False


def _generate_with_ollama_chat(messages, max_tokens, temperature):
    payload = {
        "model": OLLAMA_MODEL,
        "messages": messages,
        "stream": False,
        "options": {
            "temperature": temperature,
            "num_predict": max_tokens,
            "num_ctx": OLLAMA_NUM_CTX,
        },
    }
    resp = requests.post(f"{OLLAMA_URL}/api/chat", json=payload, timeout=OLLAMA_TIMEOUT_SEC)
    if not resp.ok:
        raise RuntimeError(f"Ollama chat error HTTP {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    return (data.get("message") or {}).get("content", "")


def _generate_with_ollama_completion(prompt, max_tokens, temperature):
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": temperature,
            "num_predict": max_tokens,
            "num_ctx": OLLAMA_NUM_CTX,
        },
    }
    resp = requests.post(f"{OLLAMA_URL}/api/generate", json=payload, timeout=OLLAMA_TIMEOUT_SEC)
    if not resp.ok:
        raise RuntimeError(f"Ollama generate error HTTP {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    return data.get("response", "")

# Load model with vLLM (GPU acceleration if available)
if BACKEND_MODE in ("auto", "vllm") and not VLLM_IMPORT_ERROR:
    try:
        logger.info(f"Loading model: {MODEL_NAME}")
        llm = LLM(
            model=MODEL_NAME,
            gpu_memory_utilization=0.8,  # Use 80% of GPU if available
            max_model_len=2048,  # Context window
        )
        logger.info("✓ Model loaded successfully")
        active_backend = "vllm"
    except Exception as e:
        logger.error(f"Failed to load model: {e}")
        llm = None
else:
    llm = None

if active_backend is None and BACKEND_MODE in ("auto", "ollama"):
    if _ollama_is_available():
        active_backend = "ollama"
        logger.info("✓ Using Ollama backend at %s with model %s", OLLAMA_URL, OLLAMA_MODEL)
    else:
        logger.warning("Ollama backend not available at %s", OLLAMA_URL)

if active_backend is None and VLLM_IMPORT_ERROR:
    logger.error(
        "vLLM is not available: %s. "
        "Install vllm in a compatible environment (Linux/WSL2 Python 3.10-3.12) "
        "or run Ollama and set LOCAL_AI_ENGINE=ollama.",
        VLLM_IMPORT_ERROR,
    )

# ─────────────────────────────────────────────────────────────────────────────
# API Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        "status": "healthy" if active_backend else "model_not_loaded",
        "backend": active_backend,
        "model": MODEL_NAME,
        "ollama_model": OLLAMA_MODEL,
        "timestamp": datetime.now().isoformat()
    })

@app.route('/v1/completions', methods=['POST'])
def completions():
    """OpenAI-compatible completions endpoint"""
    if not active_backend:
        return jsonify({"error": "Model not loaded"}), 503

    try:
        data = request.json
        prompt = data.get("prompt", "")
        max_tokens = data.get("max_tokens", MAX_TOKENS)
        temperature = data.get("temperature", TEMPERATURE)

        if not prompt:
            return jsonify({"error": "Missing 'prompt' field"}), 400

        if active_backend == "vllm":
            sampling_params = SamplingParams(
                temperature=temperature,
                max_tokens=max_tokens,
                top_p=0.9,
            )
            outputs = llm.generate([prompt], sampling_params)
            generated_text = outputs[0].outputs[0].text
        else:
            generated_text = _generate_with_ollama_completion(prompt, max_tokens, temperature)

        logger.info(f"Generated response ({len(generated_text)} chars)")

        return jsonify({
            "object": "text_completion",
            "model": MODEL_NAME,
            "choices": [
                {
                    "text": generated_text,
                    "finish_reason": "length" if len(generated_text) >= max_tokens else "stop",
                    "index": 0
                }
            ],
            "usage": {
                "prompt_tokens": len(prompt.split()),
                "completion_tokens": len(generated_text.split()),
                "total_tokens": len(prompt.split()) + len(generated_text.split())
            }
        })

    except Exception as e:
        logger.error(f"Error in completions: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/v1/chat/completions', methods=['POST'])
def chat_completions():
    """OpenAI-compatible chat completions endpoint"""
    if not active_backend:
        return jsonify({"error": "Model not loaded"}), 503

    try:
        data = request.json
        messages = data.get("messages", [])
        max_tokens = data.get("max_tokens", MAX_TOKENS)
        temperature = data.get("temperature", TEMPERATURE)

        if not messages:
            return jsonify({"error": "Missing 'messages' field"}), 400

        if active_backend == "vllm":
            # Convert chat format to prompt for vLLM text-generation interface
            prompt = ""
            for msg in messages:
                role = msg.get("role", "user")
                content = msg.get("content", "")
                prompt += f"{role}: {content}\n"
            prompt += "assistant:"

            sampling_params = SamplingParams(
                temperature=temperature,
                max_tokens=max_tokens,
                top_p=0.9,
            )
            outputs = llm.generate([prompt], sampling_params)
            generated_text = outputs[0].outputs[0].text.strip()
            prompt_tokens = len(prompt.split())
        else:
            generated_text = _generate_with_ollama_chat(messages, max_tokens, temperature).strip()
            prompt_tokens = sum(len((m.get("content") or "").split()) for m in messages)

        logger.info(f"Chat response generated ({len(generated_text)} chars)")

        return jsonify({
            "object": "chat.completion",
            "model": MODEL_NAME,
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": generated_text
                    },
                    "finish_reason": "stop",
                    "index": 0
                }
            ],
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": len(generated_text.split()),
                "total_tokens": prompt_tokens + len(generated_text.split())
            }
        })

    except Exception as e:
        logger.error(f"Error in chat_completions: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/v1/models', methods=['GET'])
def list_models():
    """OpenAI-compatible models list endpoint"""
    if not active_backend:
        return jsonify({"error": "Model not loaded"}), 503
    
    model_id = OLLAMA_MODEL if active_backend == "ollama" else MODEL_NAME
    return jsonify({
        "object": "list",
        "data": [
            {
                "id": model_id,
                "object": "model",
                "created": int(datetime.now().timestamp()),
                "owned_by": "local",
                "permission": [],
                "root": model_id,
                "parent": None
            }
        ]
    })

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if active_backend:
        logger.info(f"Starting CodeGeeX server on {HOST}:{PORT}")
        logger.info(f"Active backend: {active_backend}")
        logger.info(f"API endpoints:")
        logger.info(f"  - Health: http://{HOST}:{PORT}/health")
        logger.info(f"  - Models: http://{HOST}:{PORT}/v1/models")
        logger.info(f"  - Completions: http://{HOST}:{PORT}/v1/completions")
        logger.info(f"  - Chat: http://{HOST}:{PORT}/v1/chat/completions")
        app.run(host=HOST, port=PORT, debug=False, threaded=True)
    else:
        logger.error("Cannot start server: no backend available (vLLM/Ollama)")
        exit(1)
