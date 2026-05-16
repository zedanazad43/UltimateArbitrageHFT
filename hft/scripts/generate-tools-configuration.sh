#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_FILE="$ROOT_DIR/# Tools Configuration.md"

go_bin_path="$(command -v go 2>/dev/null || true)"

tool_line() {
  local name="$1"
  local path
  path="$(command -v "$name" 2>/dev/null || true)"

  if [[ -z "$path" ]]; then
    printf "%s: not found\n" "$name"
    return
  fi

  if [[ "$name" == "go" ]]; then
    printf "%s: %s: %s\n" "$name" "$path" "$(go version 2>/dev/null || echo unknown)"
    return
  fi

  local version_output
  case "$name" in
    gotests)
      version_output="$($name -version 2>/dev/null | head -n 1 || true)"
      ;;
    impl)
      version_output="$($name -version 2>/dev/null | head -n 1 || true)"
      ;;
    goplay)
      version_output=""
      ;;
    dlv)
      version_output="$($name version 2>/dev/null | head -n 1 || true)"
      ;;
    gopls)
      version_output="$($name version 2>/dev/null | head -n 1 || true)"
      ;;
    *)
      version_output="$($name version 2>/dev/null | head -n 1 || true)"
      ;;
  esac

  if [[ -n "$version_output" ]]; then
    printf "%s: %s (%s)\n" "$name" "$path" "$version_output"
  else
    printf "%s: %s\n" "$name" "$path"
  fi
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
  printf "gopath: %s\n" "$(go env GOPATH 2>/dev/null || true)"
  printf "GOROOT: %s\n" "$(go env GOROOT 2>/dev/null || true)"
  printf "PATH: %s\n" "${PATH:-}"
  printf "PATH (shell launched with): %s\n" "${PATH:-}"

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

  printf "Workspace Folder (UltimateArbitrageHFT): %s\n\n" "$ROOT_DIR"

  cat <<'EOF'
```text
EOF

  if [[ -n "$go_bin_path" ]]; then
    go env
  else
    echo "go command not found"
  fi

  cat <<'EOF'
```
EOF
} > "$OUT_FILE"

echo "Generated: $OUT_FILE"
