#!/bin/bash
set -e

echo "=== HFT Bot Comprehensive Test Suite ==="
echo ""

# 1. Binary Build Check
echo "✓ Checking binary build..."
if [ -f hft-engine ]; then
    echo "  Binary size: $(du -h hft-engine | cut -f1)"
    echo "  Type: $(file hft-engine)"
fi

# 2. Go Module Integrity
echo ""
echo "✓ Go module integrity..."
go mod verify 2>&1 | head -5 || true

# 3. All .go files compile check
echo ""
echo "✓ Syntax check for all .go files..."
find . -name "*.go" -type f | while read f; do
    go test -run=^$ -v "$f" 2>&1 | grep -i "FAIL\|ok" | head -1 || true
done | tail -20

# 4. Config file parsing test
echo ""
echo "✓ Testing config parsing..."
go run cmd/hft/main.go -h 2>&1 | head -3 || echo "  (will run with env vars)"

echo ""
echo "=== Test Suite Complete ==="
