# Repository Organization Index

Generated: 2026-07-02

## Canonical Roots
- arbitragebot
- hero-super-agent

## Arbitrage Family
- Canonical: arbitragebot/ArbitrageBots
  - Legacy alias: ArbitrageBots (symlink)
- Canonical: arbitragebot/CloudflareArbitrageBot
  - Legacy alias: CloudflareArbitrageBot (symlink)
- Canonical: arbitragebot/MegaArbitrageBot
  - Legacy alias: MegaArbitrageBot (symlink)
- Canonical: arbitragebot/UltimateArbitrageBot
  - Legacy alias: UltimateArbitrageBot (symlink)
- Canonical: arbitragebot/UnifiedArbitrageBot
  - Legacy alias: UnifiedArbitrageBot (symlink)
- Canonical: arbitragebot/ultimate-arbitrage-hft
  - Legacy alias: ultimate-arbitrage-hft (symlink)
- Special case: ArbitrageBot
  - Type: git submodule path at repository root
  - Canonical reference alias: arbitragebot/ArbitrageBot -> ../ArbitrageBot
  - Reason: root submodule path cannot be replaced by symlink.

## Hero Family
- Canonical: hero-super-agent/hero-agent
  - Legacy alias: hero-agent (symlink)

## Reorganization Status
- Broken symlinks: none detected
- Deploy dry-run: passing
- Hero status command: passing

## Updated Path References
- package.json hero scripts now target hero-super-agent/hero-agent/server.js
- eslint.config.js globs updated for hero-super-agent and arbitragebot canonical layout
- Deploy-All.ps1 updated for arbitragebot/UltimateArbitrageBot default paths
- arbitragebot/UltimateArbitrageBot/src/worker.js updated relative re-export path
- arbitragebot/UltimateArbitrageBot/package.json updated wrangler config path
- memory/PRD.md updated canonical worker path and deployment command
