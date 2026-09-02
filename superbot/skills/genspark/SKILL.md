# Genspark AI Skill

Use Genspark as a browser-based deep research fallback when LLM providers are unavailable or insufficient.

## Skill Metadata
```yaml
name: genspark
version: "1.0.0"
description: "Browser-based AI research agent via Genspark"
trigger_keywords: ["genspark", "spark", "deep research", "agent research"]
endpoint: https://www.genspark.ai/
free_tier: true
requires_browser: true
```

## When to use
- User mentions "genspark" or "spark"
- All cloud LLM providers (OpenRouter / Merlin / Hermes) are unavailable
- Deep multi-source research is required with autonomous browsing

## Actions (via Manus or browser automation)
1. Open `https://www.genspark.ai/` in a controlled browser
2. Submit the user prompt in the search/input field
3. Wait for the Genspark agent to complete its research
4. Extract the synthesized result from the page
5. Return the result to the calling agent

## Notes
- Requires either Manus (automation agent) or a Playwright/Puppeteer browser environment
- Do not use when Merlin or OmniRoute are available (prefer API over browser)
- Fallback priority: Merlin → OmniRoute → Genspark

