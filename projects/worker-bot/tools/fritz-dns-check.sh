#!/bin/bash
# Check FRITZ!Box DNS from local network
echo "=== FRITZ!Box DNS Status ==="
curl -s --max-time 5 http://192.168.178.1/ > /dev/null && echo "Router: ONLINE" || echo "Router: OFFLINE"
curl -s --max-time 5 https://api.cloudflare.com > /dev/null && echo "Cloudflare DNS: REACHABLE" || echo "Cloudflare DNS: BLOCKED"
curl -s --max-time 5 https://huggingface.co > /dev/null && echo "HuggingFace: REACHABLE" || echo "HuggingFace: BLOCKED"
echo "=== Current DNS ==="
nslookup api.openrouter.com 2>/dev/null | grep Server || echo "nslookup not available"
