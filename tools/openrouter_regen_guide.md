# OpenRouter Key Regeneration Guide

## Current Status
- OpenRouter API token location: `C:/Users/azadz/.openrouter_key`
- Credits status: **EXHAUSTED** (-0.0772)
- Management Key: CANNOT create usable API keys (Admin API limitation)

## Steps to Regenerate
1. Open https://openrouter.ai/keys in browser
2. Click **Create API Key**
3. Name: `UAHFT-Bot-Primary`
4. Copy the new key (starts with `sk-or-v1-...`)
5. Save to: `C:/Users/azadz/.openrouter_key`

## After Regeneration
```bash
node or_team.cjs "test connectivity"
```

## Fallback
GitHub Models (gpt-4o-mini) is already working as fallback.
