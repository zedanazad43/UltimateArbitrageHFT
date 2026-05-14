#!/usr/bin/env python3
"""
CodeGeeX Server Health Check
Tests if the local CodeGeeX server is running and responding
"""

import requests
import sys
import json
from datetime import datetime

SERVER_URL = "http://localhost:8000"
HEALTH_ENDPOINT = f"{SERVER_URL}/health"
CHAT_ENDPOINT = f"{SERVER_URL}/v1/chat/completions"

def color_text(text, color):
    """ANSI color codes"""
    colors = {
        'green': '\033[92m',
        'red': '\033[91m',
        'yellow': '\033[93m',
        'cyan': '\033[96m',
        'reset': '\033[0m'
    }
    return f"{colors.get(color, '')}{text}{colors['reset']}"

def check_health():
    """Check if server is alive"""
    try:
        response = requests.get(HEALTH_ENDPOINT, timeout=5)
        data = response.json()
        status = data.get('status', 'unknown')
        model = data.get('model', 'unknown')
        
        print(f"✓ Server is {color_text(status, 'green')}")
        print(f"  Model: {color_text(model, 'cyan')}")
        print(f"  Endpoint: {SERVER_URL}")
        return True
    except requests.exceptions.ConnectionError:
        print(color_text("✗ Cannot connect to server", 'red'))
        print(f"  Is the server running? Start with: .\\start-codegeex-server.ps1")
        return False
    except Exception as e:
        print(color_text(f"✗ Health check failed: {e}", 'red'))
        return False

def test_inference():
    """Test if model can actually generate text"""
    try:
        payload = {
            "messages": [
                {
                    "role": "user",
                    "content": "Select the best arbitrage opportunity. Reply with ONLY '1' or '2':\n1. CEX swap: +0.5%\n2. DEX swap: +0.3%"
                }
            ],
            "max_tokens": 4,
            "temperature": 0.3
        }
        
        print("\nTesting inference...")
        response = requests.post(CHAT_ENDPOINT, json=payload, timeout=30)
        
        if response.status_code != 200:
            print(color_text(f"✗ Inference failed (HTTP {response.status_code})", 'red'))
            return False
        
        data = response.json()
        generated = data.get('choices', [{}])[0].get('message', {}).get('content', '').strip()
        
        print(color_text(f"✓ Inference successful", 'green'))
        print(f"  Response: {repr(generated)}")
        print(f"  Time: {datetime.now().isoformat()}")
        return True
        
    except requests.exceptions.Timeout:
        print(color_text("✗ Inference timeout (model still loading?)", 'yellow'))
        return False
    except Exception as e:
        print(color_text(f"✗ Inference test failed: {e}", 'red'))
        return False

def main():
    print(color_text("=" * 50, 'cyan'))
    print(color_text("  CodeGeeX Server Health Check", 'cyan'))
    print(color_text("=" * 50, 'cyan'))
    print()
    
    # Check connectivity
    health_ok = check_health()
    
    if not health_ok:
        print()
        print(color_text("Cannot proceed without server running", 'red'))
        sys.exit(1)
    
    # Test inference
    print()
    inference_ok = test_inference()
    
    # Summary
    print()
    print(color_text("=" * 50, 'cyan'))
    if health_ok and inference_ok:
        print(color_text("✓ All checks passed! Server is ready.", 'green'))
        print("  You can now start your HFT application with:")
        print("  $env:AI_BACKEND = 'local'")
        sys.exit(0)
    else:
        print(color_text("✗ Some checks failed. See above for details.", 'red'))
        sys.exit(1)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n" + color_text("Interrupted by user", 'yellow'))
        sys.exit(0)
