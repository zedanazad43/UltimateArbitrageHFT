#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_FILE="$ROOT_DIR/# Tools Configuration.md"

tool_line() {
  local name="$1"
  printf "%s: redacted (environment-dependent)\n" "$name"
}

{
  cat <<'EOF'
# Tools Configuration

Note: Empty or undefined fields such as GOBIN and toolsGopath can be normal depending on shell startup behavior and Go extension defaults.

## Refresh This Report

Run from hft folder:

    bash scripts/generate-tools-configuration.sh

## Environment

```text
EOF

  printf "GOBIN: %s\n" "${GOBIN:-undefined}"
  printf "toolsGopath: %s\n" "${toolsGopath:-}"
  printf "gopath: %s\n" "redacted (environment-dependent)"
  printf "GOROOT: %s\n" "redacted (environment-dependent)"
  printf "PATH: %s\n" "redacted (environment-dependent)"
  printf "PATH (shell launched with): %s\n" "redacted (environment-dependent)"

  cat <<'EOF'
```

## Tools

```text
EOF

  tool_line "go"
  tool_line "gotests"
  tool_line "impl"
  tool_line "goplay"
  tool_line "dlv"
  tool_line "gopls"

  cat <<'EOF'
```

## Go env

EOF

  printf "Workspace Folder (UltimateArbitrageHFT): %s\n\n" "redacted (environment-dependent)"

  cat <<'EOF'
```text
EOF

  echo "redacted (environment-dependent)"

  cat <<'EOF'
```
EOF
} > "$OUT_FILE"

echo "Generated: $OUT_FILE"
