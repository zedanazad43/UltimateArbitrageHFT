# Merlin AI Skill

Use Merlin AI for deep research, live web search, and multi-model synthesis.

## Skill Metadata
```yaml
name: merlin-ai
version: "1.0.0"
description: "Live web search and multi-model research via Merlin AI"
trigger_keywords: ["search", "research", "web", "browse", "latest", "merlin"]
api_key_env: MERLIN_API_KEY
endpoint: https://merlin.foyer.work/api/chat
free_tier: true
```

## When to use
- User explicitly asks for Merlin / web search / live research
- Task requires up-to-date information beyond the model's knowledge cutoff
- Synthesis of multiple web sources is needed
- Current agent confidence is low on a factual query

## Tool Call (Hermes / OmniRoute)
```json
{
  "tool": "merlin_chat",
  "args": {
    "prompt": "<user query>",
    "model": "auto",
    "web_search": true
  }
}
```

## HTTP API (direct)
```
POST https://merlin.foyer.work/api/chat
Authorization: ******
Content-Type: application/json

{ "message": "<prompt>", "model": "auto" }
```

## Notes
- Do NOT expose `MERLIN_API_KEY` to the user
- Fall back to `/api/ai/chat` (local) if Merlin fails
- Prefer `web_search: true` for research tasks

