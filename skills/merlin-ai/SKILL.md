# Merlin AI Skill

Use Merlin AI (via Hermes Agent tool call) when deep research, multi-model reasoning, or web search is required.

## Trigger
- User explicitly asks for Merlin/Genspark/Multi-model research
- Current agent confidence is low or task requires live search + synthesis

## Tool Call
- Hermes calls `merlin_chat(prompt, model)` or `/api/merlin/chat`
- Requires `MERLIN_API_KEY` in env
- Returns synthesized answer

## Notes
- Do NOT expose `MERLIN_API_KEY` to user
- Fallback to `/api/ai/chat` if Merlin fails
