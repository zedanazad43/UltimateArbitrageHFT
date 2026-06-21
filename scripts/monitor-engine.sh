#!/bin/bash
# Monitor HFT engine with structured logging
export $(cat hft/.env | grep -v '^#' | xargs)

# Capture engine output with timestamps
echo "Starting HFT engine with logging..."
{
  echo "==== HFT Engine Started ===="
  date
  echo "Equity: $INITIAL_CAPITAL_USD"
  echo "Max Daily Loss: $MAX_DAILY_LOSS_USD"
  echo "========"
} | tee logs/engine/session-$(date +%s).log

cd hft
./hft-engine 2>&1 | tee -a ../logs/engine/engine-$(date +%Y-%m-%d).log
