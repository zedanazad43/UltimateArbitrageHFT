You are in Advisor Mode.
1. Plan first: before writing code, analyze the whole task and produce a detailed plan (files, order, dependencies, edge cases).
2. Show the plan and wait for explicit approval.
3. Execute minimally: use file path references, output only new/changed code, compress output.
4. Prioritize token efficiency throughout.

<!--
ØªØ±Ø¬Ù…Ø© ØªÙˆØ¶ÙŠØ­ÙŠØ© (ØºÙŠØ± ØªÙ†ÙÙŠØ°ÙŠØ©) Ù„Ù„ØªØ¹Ù„ÙŠÙ…Ø§Øª Ø£Ø¹Ù„Ø§Ù‡:
Ø£Ù†Øª ØªØ¹Ù…Ù„ ÙÙŠ ÙˆØ¶Ø¹ Ø§Ù„Ù…Ø³ØªØ´Ø§Ø±.
1) Ø§Ø¨Ø¯Ø£ Ø¨Ø§Ù„ØªØ®Ø·ÙŠØ·: Ù‚Ø¨Ù„ ÙƒØªØ§Ø¨Ø© Ø£ÙŠ ÙƒÙˆØ¯ØŒ Ø­Ù„Ù‘Ù„ Ø§Ù„Ù…Ù‡Ù…Ø© Ø¨Ø§Ù„ÙƒØ§Ù…Ù„ ÙˆÙ‚Ø¯Ù‘Ù… Ø®Ø·Ø© ØªÙØµÙŠÙ„ÙŠØ© (Ø§Ù„Ù…Ù„ÙØ§ØªØŒ Ø§Ù„ØªØ±ØªÙŠØ¨ØŒ Ø§Ù„Ø§Ø¹ØªÙ…Ø§Ø¯ÙŠØ§ØªØŒ ÙˆØ§Ù„Ø­Ø§Ù„Ø§Øª Ø§Ù„Ø·Ø±ÙÙŠØ©).
2) Ø§Ø¹Ø±Ø¶ Ø§Ù„Ø®Ø·Ø© ÙˆØ§Ù†ØªØ¸Ø± Ù…ÙˆØ§ÙÙ‚Ø© ØµØ±ÙŠØ­Ø©.
3) Ù†ÙÙ‘Ø° Ø¨Ø£Ù‚Ù„ Ù‚Ø¯Ø± Ù…Ù…ÙƒÙ†: Ø§Ø³ØªØ®Ø¯Ù… Ù…Ø±Ø§Ø¬Ø¹ Ù…Ø³Ø§Ø±Ø§Øª Ø§Ù„Ù…Ù„ÙØ§ØªØŒ ÙˆØ§Ø¹Ø±Ø¶ ÙÙ‚Ø· Ø§Ù„ÙƒÙˆØ¯ Ø§Ù„Ø¬Ø¯ÙŠØ¯/Ø§Ù„Ù…Ø¹Ø¯Ù‘Ù„ØŒ ÙˆØ§Ø¶ØºØ· Ø§Ù„Ù…Ø®Ø±Ø¬Ø§Øª.
4) Ø£Ø¹Ø·Ù Ø£ÙˆÙ„ÙˆÙŠØ© Ù„ÙƒÙØ§Ø¡Ø© Ø§Ø³ØªØ®Ø¯Ø§Ù… Ø§Ù„ØªÙˆÙƒÙ†Ø§Øª Ø·ÙˆØ§Ù„ Ø§Ù„ÙˆÙ‚Øª.
-->

# lean-ctx global policy

Prefer lean-ctx tools first to reduce token usage:
- ctx_read over raw file reads
- ctx_search over broad grep scans
- ctx_tree for structure discovery
- ctx_shell for compressed shell output

When available, run these before fallbacks.

CLI (repo-local): `python3 lean-ctx/ctx.py read|search|tree|shell ...`
Canonical agent: `.github/agents/final-ai-agent.agent.md` (aimaster + Super-Agent + llm-council).
Cloud runs: `.github/workflows/agent-run.yml`.

