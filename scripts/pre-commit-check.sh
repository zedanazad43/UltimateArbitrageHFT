#!/usr/bin/env bash
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

echo "[pre-commit] 🔍 Running security checks..."

# Semgrep SAST scan
echo "[pre-commit] 🔐 Semgrep SAST analysis..."
if command -v semgrep &> /dev/null; then
  semgrep --config .semgrep.yml --quiet --error || {
    echo "[pre-commit] ⚠️  Semgrep found potential issues (non-blocking)"
  }
else
  echo "[pre-commit] ⚠️  Semgrep not installed (install: pip install semgrep)"
fi

echo "[pre-commit] 🔗 Running ESLint"
npm run lint

echo "[pre-commit] 🐹 Running Go vet + tests (hft)"
cd "$repo_root/hft"
go vet ./...
go test ./...

echo "[pre-commit] ✅ All checks passed"
