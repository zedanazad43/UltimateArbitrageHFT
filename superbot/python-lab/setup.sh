#!/bin/sh
# SuperBot Python lab setup — installs freqtrade, backtrader, NautilusTrader and OpenBB into an isolated venv.
# Run from this directory:  sh ./setup.sh
set -e
cd "$(dirname "$0")"

python3 -m venv .venv
PY=".venv/bin/python"
[ -x "$PY" ] || PY=".venv/Scripts/python.exe"   # Windows

"$PY" -m pip install --upgrade pip wheel
"$PY" -m pip install -r requirements.txt

echo
echo "✅ Python lab ready: $PY"
"$PY" lab.py status
