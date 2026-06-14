#!/usr/bin/env python3
"""
AIMaster Complete Launcher
===========================
Single entry point for ALL AI agents and tools.
Run: python aimaster_launcher.py [command]

Integrates:
  - AIMaster multi-provider AI (DeepSeek, CodeGeeX, Ollama, GitHub)
  - Ollama Agent wrapper (multi-model + web search)
  - Arbitrage Engine (ultra_fast_arbitrage.py)
  - Agent Orchestrator (full hub)
"""

import sys
import os

# Ensure project root is in path
_PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)


def cmd_start():
    """Start the full AIMaster orchestrator and show health report."""
    from aimaster.integrations.agent_orchestrator import AgentOrchestrator

    print("Loading AIMaster Agent Ecosystem...")
    print("(This may take a few seconds while checking all providers)")
    print()

    orch = AgentOrchestrator()
    orch.print_health()
    print()
    print("AIMaster is ready!")
    print(f"Orchestrator: {repr(orch)}")


def cmd_health():
    """Quick health check of all systems."""
    from aimaster.integrations.agent_orchestrator import AgentOrchestrator

    orch = AgentOrchestrator()
    orch.print_health()


def cmd_scan():
    """Scan for arbitrage opportunities."""
    from aimaster.integrations.agent_orchestrator import AgentOrchestrator

    orch = AgentOrchestrator(enable_ollama_agent=False)
    result = orch.scan_arbitrage()

    print("=" * 60)
    print("  Arbitrage Scan Results")
    print("=" * 60)
    print(f"  Time: {result['timestamp']}")
    print(f"  Opportunities: {result['count']}")
    for o in result["opportunities"]:
        print(f"    [{o['type']}] {o['symbol']}: "
              f"{o['buy_exchange']} -> {o['sell_exchange']} "
              f"+{o['profit_percent']:.2f}% (${o['net_profit_usd']:.2f})")
    if result["count"] == 0:
        print("    No opportunities found in this scan.")
    print("=" * 60)


def cmd_chat():
    """Interactive AI chat session."""
    from aimaster.integrations.agent_orchestrator import AgentOrchestrator

    orch = AgentOrchestrator(enable_arbitrage=False)
    print("=" * 60)
    print("  AIMaster Chat Mode")
    print(f"  Providers: {orch.ai_master.get_available_providers()}")
    print("  Type /quit to exit, /health for status, /help for commands")
    print("=" * 60)
    print()

    while True:
        try:
            prompt = input(">> You: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nGoodbye!")
            break

        if not prompt:
            continue

        if prompt.lower() in ("/quit", "/exit", "/q"):
            print("Goodbye!")
            break
        if prompt.lower() in ("/help", "/h"):
            print("Commands: /quit, /help, /health, /providers")
            continue
        if prompt.lower() in ("/health", "/hc"):
            orch.print_health()
            continue
        if prompt.lower() in ("/providers", "/p"):
            provs = orch.ai_master.list_providers()
            for n, i in provs.items():
                s = "[+]" if i["healthy"] else "[-]"
                print(f"  {s} {n}: {i['model']}")
            continue

        resp = orch.chat_ai(prompt)
        print()
        print(resp.get("content", "No response"))
        print(f"  [{resp.get('provider_name', '?')} | {resp.get('latency_ms', 0):.0f}ms]")
        print()


def cmd_query():
    """Unified query: AI + web search + arbitrage."""
    import sys as _sys

    prompt = " ".join(_sys.argv[2:]) if len(_sys.argv) > 2 else ""
    if not prompt:
        print("Usage: python aimaster_launcher.py query <your question>")
        return

    from aimaster.integrations.agent_orchestrator import AgentOrchestrator

    orch = AgentOrchestrator()
    result = orch.query(prompt, use_arbitrage=True)

    print("=" * 60)
    print(f"  Query: {prompt[:80]}")
    print("=" * 60)
    ai = result.get("ai_response", {})
    print(f"\n[AI Response - {ai.get('provider_name', 'unknown')}]")
    print(ai.get("content", "No response"))
    arb = result.get("arbitrage", {})
    if arb and arb.get("opportunities"):
        print(f"\n[Arbitrage Opportunities: {arb['count']}]")
        for o in arb["opportunities"][:3]:
            print(f"  {o['symbol']}: +{o['profit_percent']:.2f}%")
    web = result.get("web_search", "")
    if web:
        print(f"\n[Web Search]")
        print(web[:300])
    print("=" * 60)


def cmd_providers():
    """List all configured AI providers and their status."""
    from aimaster.integrations.agent_orchestrator import AgentOrchestrator

    orch = AgentOrchestrator(enable_arbitrage=False, enable_ollama_agent=False)
    providers = orch.ai_master.list_providers()

    print("=" * 60)
    print("  AIMaster AI Providers")
    print("=" * 60)
    for name, info in providers.items():
        status = "[+] HEALTHY" if info["healthy"] else "[-] OFFLINE"
        print(f"  {name:20s} {info['model']:15s} {status}")
    print("=" * 60)


def cmd_interactive():
    """Full interactive mode with all features."""
    from aimaster.integrations.agent_orchestrator import AgentOrchestrator

    orch = AgentOrchestrator()
    orch.print_health()
    print()
    print("Interactive mode. Commands:")
    print("  chat <text>  - AI chat")
    print("  scan         - Arbitrage scan")
    print("  search <q>   - Web search")
    print("  health       - Health check")
    print("  live on/off  - Toggle live trading")
    print("  /quit        - Exit")
    print()

    while True:
        try:
            cmd = input(">> ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nGoodbye!")
            break

        if not cmd:
            continue
        if cmd in ("/quit", "/exit", "/q"):
            print("Goodbye!")
            break
        if cmd == "health":
            orch.print_health()
            continue
        if cmd == "scan":
            result = orch.scan_arbitrage()
            print(f"  [{result['count']} opportunities found]")
            for o in result["opportunities"]:
                print(f"    {o['symbol']}: +{o['profit_percent']:.2f}%")
            continue
        if cmd.startswith("search "):
            query_text = cmd[7:]
            result = orch.web_search(query_text)
            print(f"  {result[:500]}")
            continue
        if cmd.startswith("chat "):
            prompt = cmd[5:]
            resp = orch.chat_ai(prompt)
            print(f"\n  {resp.get('content', 'No response')}")
            print(f"  [{resp.get('provider_name', '?')}]")
            continue
        if cmd == "live on":
            orch.set_live_trading(True)
            continue
        if cmd == "live off":
            orch.set_live_trading(False)
            continue

        # Default: treat as chat
        resp = orch.chat_ai(cmd)
        print(f"\n  {resp.get('content', 'No response')}")
        print(f"  [{resp.get('provider_name', '?')}]")


def show_help():
    """Show available commands."""
    print("""
AIMaster - Complete AI Agent Ecosystem
=======================================
Usage: python aimaster_launcher.py [command]

Commands:
  start         - Start full orchestrator and show health
  health        - Quick health check of all systems
  scan          - Scan for arbitrage opportunities
  chat          - Interactive AI chat (multi-provider)
  query <text>  - Unified query (AI + arbitrage + search)
  providers     - List all AI providers and status
  interactive   - Full interactive mode with all features
  help          - Show this help

Examples:
  python aimaster_launcher.py start
  python aimaster_launcher.py chat
  python aimaster_launcher.py scan
  python aimaster_launcher.py query "Best arbitrage strategy today?"
  python aimaster_launcher.py providers
""")

# ─────────────────────────────────────────────────────────
# Main dispatcher
# ─────────────────────────────────────────────────────────

COMMANDS = {
    "start": cmd_start,
    "health": cmd_health,
    "scan": cmd_scan,
    "chat": cmd_chat,
    "query": cmd_query,
    "providers": cmd_providers,
    "interactive": cmd_interactive,
    "help": show_help,
    "--help": show_help,
    "-h": show_help,
}

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "start"
    func = COMMANDS.get(cmd)
    if func:
        func()
    else:
        print(f"Unknown command: {cmd}")
        show_help()
        sys.exit(1)