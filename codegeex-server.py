#!/usr/bin/env python3
"""
CodeGeeX Local Server - Runs CodeGeeX locally via vLLM
Exposes an OpenAI-compatible API for use by ai-client.js
"""

import json
import logging
from flask import Flask, request, jsonify
from vllm import LLM, SamplingParams
import os
from datetime import datetime

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

MODEL_NAME = "THUDM/codegeex4-all-9b"  # CodeGeeX 4 model (9B, good for trading logic)
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

# Load model with vLLM (GPU acceleration if available)
try:
    logger.info(f"Loading model: {MODEL_NAME}")
    llm = LLM(
        model=MODEL_NAME,
        gpu_memory_utilization=0.8,  # Use 80% of GPU if available
        max_model_len=2048,  # Context window
    )
    logger.info("✓ Model loaded successfully")
except Exception as e:
    logger.error(f"Failed to load model: {e}")
    llm = None

# ─────────────────────────────────────────────────────────────────────────────
# API Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        "status": "healthy" if llm else "model_not_loaded",
        "model": MODEL_NAME,
        "timestamp": datetime.now().isoformat()
    })

@app.route('/v1/completions', methods=['POST'])
def completions():
    """OpenAI-compatible completions endpoint"""
    if not llm:
        return jsonify({"error": "Model not loaded"}), 503

    try:
        data = request.json
        prompt = data.get("prompt", "")
        max_tokens = data.get("max_tokens", MAX_TOKENS)
        temperature = data.get("temperature", TEMPERATURE)

        if not prompt:
            return jsonify({"error": "Missing 'prompt' field"}), 400

        # Generate response
        sampling_params = SamplingParams(
            temperature=temperature,
            max_tokens=max_tokens,
            top_p=0.9,
        )
        
        outputs = llm.generate([prompt], sampling_params)
        generated_text = outputs[0].outputs[0].text

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
    if not llm:
        return jsonify({"error": "Model not loaded"}), 503

    try:
        data = request.json
        messages = data.get("messages", [])
        max_tokens = data.get("max_tokens", MAX_TOKENS)
        temperature = data.get("temperature", TEMPERATURE)

        if not messages:
            return jsonify({"error": "Missing 'messages' field"}), 400

        # Convert chat format to prompt
        prompt = ""
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            prompt += f"{role}: {content}\n"
        prompt += "assistant:"

        # Generate response
        sampling_params = SamplingParams(
            temperature=temperature,
            max_tokens=max_tokens,
            top_p=0.9,
        )
        
        outputs = llm.generate([prompt], sampling_params)
        generated_text = outputs[0].outputs[0].text.strip()

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
                "prompt_tokens": len(prompt.split()),
                "completion_tokens": len(generated_text.split()),
                "total_tokens": len(prompt.split()) + len(generated_text.split())
            }
        })

    except Exception as e:
        logger.error(f"Error in chat_completions: {e}")
        return jsonify({"error": str(e)}), 500

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if llm:
        logger.info(f"Starting CodeGeeX server on {HOST}:{PORT}")
        logger.info(f"API endpoints:")
        logger.info(f"  - Health: http://{HOST}:{PORT}/health")
        logger.info(f"  - Completions: http://{HOST}:{PORT}/v1/completions")
        logger.info(f"  - Chat: http://{HOST}:{PORT}/v1/chat/completions")
        app.run(host=HOST, port=PORT, debug=False, threaded=True)
    else:
        logger.error("Cannot start server: model failed to load")
        exit(1)
