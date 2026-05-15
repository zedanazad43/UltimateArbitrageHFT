#!/usr/bin/env bash
set -euo pipefail

echo "[pre-commit] Running ESLint"
npm run lint

echo "[pre-commit] Running Go vet + tests (hft)"
cd hft
go vet ./...
go test ./...

echo "[pre-commit] All checks passed"
