#!/usr/bin/env python3
"""
AIMaster Command Line Interface
Interactive and scriptable access to the multi-provider AI agent.
"""

import argparse
import sys
from typing import Optional

from .master import AIMasterAgent
from .config import load_config


def cmd_health(args) -> int:
    """Check health of all providers."""
    agent = AIMasterAgent(args.config)
    health = agent.health_check()
    available = agent.get_available_providers()

    print("=" * 60)
    print("  AIMaster Health Check")
    print("=" * 60)
    for name, healthy in health.items():
        status = "[OK]" if healthy else "[OFF]"
        icon = "[+]" if healthy else "[-]"
        print(f"  {icon} {name:20s} {status}")
    print("-" * 60)
    print(f"  Available: {len(available)}/{len(health)} providers")
    if available:
        print(f"  Priority:  {' -> '.join(available)}")
    print("=" * 60)
    return 0


def cmd_chat(args) -> int:
    """Send a chat prompt to the best available provider."""
    agent = AIMasterAgent(args.config)

    prompt = args.prompt
    if not prompt:
        if not sys.stdin.isatty():
            prompt = sys.stdin.read().strip()

    if not prompt:
        print("Error: No prompt provided. Use --prompt or pipe input.", file=sys.stderr)
        return 1

    print(f"\n>> Asking: {prompt[:80]}{'...' if len(prompt) > 80 else ''}")
    print("-" * 50)

    result = agent.chat(
        prompt=prompt,
        provider=args.provider,
        system_prompt=args.system,
        temperature=args.temperature,
        max_tokens=args.max_tokens,
    )

    if result.success:
        print(result.content)
        print("-" * 50)
        print(f"OK Provider: {result.provider_name} | Model: {result.model} | "
              f"Latency: {result.latency_ms:.0f}ms | Tokens: {result.tokens_used}")
        return 0
    else:
        print(f"ERROR: {result.error}", file=sys.stderr)
        return 1


def cmd_list(args) -> int:
    """List all configured providers and their status."""
    agent = AIMasterAgent(args.config)
    providers = agent.list_providers()

    print("=" * 60)
    print("  AIMaster Providers")
    print("=" * 60)
    for name, info in providers.items():
        status = "[+] HEALTHY" if info["healthy"] else "[-] OFFLINE"
        enabled = "ENABLED" if info["enabled"] else "DISABLED"
        print(f"  {name:20s} {info['type']:25s} {info['model']:15s} {status:14s} {enabled}")
    print("=" * 60)
    return 0


def cmd_interactive(args) -> int:
    """Start interactive chat session."""
    agent = AIMasterAgent(args.config)

    available = agent.get_available_providers()
    print("=" * 60)
    print("  AIMaster Interactive Chat")
    print(f"  Version: {agent.config.get('version', '1.0')}")
    print(f"  Available: {', '.join(available) if available else 'NONE'}")
    print("  Commands: /quit, /help, /providers, /health, /switch <provider>")
    print("=" * 60)
    print()

    current_provider = args.provider

    while True:
        try:
            prompt = input(">> You: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nGoodbye!")
            break

        if not prompt:
            continue

        if prompt.startswith("/"):
            cmd = prompt.lower()
            if cmd in ("/quit", "/exit", "/q"):
                print("Goodbye!")
                break
            elif cmd in ("/help", "/h"):
                print("Commands:")
                print("  /quit, /exit    - Exit chat")
                print("  /help           - Show this help")
                print("  /providers      - List providers")
                print("  /health         - Health check")
                print("  /switch <name>  - Switch provider")
                print()
                continue
            elif cmd in ("/providers", "/p"):
                provs = agent.list_providers()
                for name, info in provs.items():
                    status = "[+]" if info["healthy"] else "[-]"
                    print(f"  {status} {name}: {info['model']} ({info['type']})")
                print(f"  Current: {current_provider or 'auto'}")
                continue
            elif cmd in ("/health", "/hc"):
                health = agent.health_check()
                for name, healthy in health.items():
                    print(f"  {'[+]' if healthy else '[-]'} {name}: {'HEALTHY' if healthy else 'OFFLINE'}")
                continue
            elif cmd.startswith("/switch "):
                new_provider = cmd.split(" ", 1)[1].strip()
                if new_provider == "auto":
                    current_provider = None
                    print("  OK Switched to auto-routing")
                elif new_provider in agent.providers:
                    current_provider = new_provider
                    print(f"  OK Switched to {new_provider}")
                else:
                    print(f"  ERROR Unknown provider: {new_provider}")
                    print(f"  Available: {list(agent.providers.keys())}")
                continue
            else:
                print(f"  Unknown command: {prompt}. Type /help for available commands.")
                continue

        print(">> ", end="", flush=True)
        result = agent.chat(
            prompt=prompt,
            provider=current_provider,
        )

        if result.success:
            print(result.content)
            print(f"     [{result.provider_name} | {result.latency_ms:.0f}ms]")
        else:
            print(f"ERROR: {result.error}")
        print()

    return 0


def cmd_council(args) -> int:
    """Run LLM Council - multi-provider parallel reasoning."""
    from .skills.llm_council import run_council
    prompt = args.prompt
    if not prompt and not sys.stdin.isatty():
        prompt = sys.stdin.read().strip()
    if not prompt:
        print("Error: No prompt provided.", file=sys.stderr)
        return 1
    print("=" * 60)
    print("  LLM Council - Multi-Provider Parallel Reasoning")
    print("=" * 60)
    print(f"  Mode: {args.mode}  |  Max peers: {args.max_peers}")
    print(f"  Q: {prompt[:120]}")
    result = run_council(question=prompt, mode=args.mode, max_peers=args.max_peers)
    if args.json:
        import json
        print(json.dumps(result.to_dict(), indent=2, ensure_ascii=False))
        return 0
    print(f"\nProviders: {result.providers_used} ({chr(44).join(result.provider_names)})")
    print(f"Latency: {result.total_latency_ms:.0f}ms\n")
    print("CONFIRMED:"); print(result.confirmed_conclusions); print()
    print("ASSUMPTION-DEPENDENT:"); print(result.assumption_dependent); print()
    print("UNCERTAINTY:"); print(result.remaining_uncertainty); print()
    for v in result.verdicts:
        print(f"  [{v.provider}/{v.model}] {v.confidence} | {v.latency_ms:.0f}ms")
    return 0


def cmd_concurrent(args) -> int:
    """Send prompt to all providers concurrently, get fastest response."""
    agent = AIMasterAgent(args.config)

    prompt = args.prompt
    if not prompt and not sys.stdin.isatty():
        prompt = sys.stdin.read().strip()

    if not prompt:
        print("Error: No prompt provided.", file=sys.stderr)
        return 1

    print("\n== Concurrent query to all providers...")
    result = agent.chat_concurrent(
        prompt=prompt,
        temperature=args.temperature,
        max_tokens=args.max_tokens,
    )

    if result.success:
        print(f"OK Provider: {result.provider_name} ({result.latency_ms:.0f}ms)")
        print("-" * 50)
        print(result.content)
        return 0
    else:
        print(f"ERROR: {result.error}", file=sys.stderr)
        return 1


def main():
    parser = argparse.ArgumentParser(
        description="AIMaster - Multi-Provider AI Agent",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  aimaster health                           # Check all providers
  aimaster chat "Explain arbitrage"         # Send chat prompt
  aimaster chat --provider deepseek "..."   # Use specific provider
  aimaster list                             # List providers
  aimaster interactive                      # Interactive chat mode
  aimaster concurrent "What is HFT?"        # Race all providers\n  aimaster council \"Q\"           # LLM Council
  echo "Hello" | aimaster chat              # Pipe input
        """,
    )
    parser.add_argument(
        "--config", "-c",
        help="Path to aimaster-config.json",
    )

    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    # health
    p_health = subparsers.add_parser("health", help="Check provider health")
    p_health.set_defaults(func=cmd_health)

    # chat
    p_chat = subparsers.add_parser("chat", help="Send chat prompt")
    p_chat.add_argument("prompt", nargs="?", help="The prompt text")
    p_chat.add_argument("--provider", "-p", help="Force specific provider")
    p_chat.add_argument("--system", "-s", help="System prompt")
    p_chat.add_argument("--temperature", "-t", type=float, help="Temperature (0-2)")
    p_chat.add_argument("--max-tokens", "-m", type=int, help="Max output tokens")
    p_chat.set_defaults(func=cmd_chat)

    # list
    p_list = subparsers.add_parser("list", help="List all providers")
    p_list.set_defaults(func=cmd_list)

    # interactive
    p_int = subparsers.add_parser("interactive", help="Interactive chat mode")
    p_int.add_argument("--provider", "-p", help="Force specific provider")
    p_int.set_defaults(func=cmd_interactive)

    # concurrent
    p_conc = subparsers.add_parser("concurrent", help="Race all providers\n  aimaster council \"Q\"           # LLM Council")
    p_conc.add_argument("prompt", nargs="?", help="The prompt text")
    p_conc.add_argument("--temperature", "-t", type=float, help="Temperature")
    p_conc.add_argument("--max-tokens", "-m", type=int, help="Max output tokens")
    p_conc.set_defaults(func=cmd_concurrent)

    # council
    pc = subparsers.add_parser("council", help="LLM Council")
    pc.add_argument("prompt", nargs="?")
    pc.add_argument("--mode","-M",choices=["balanced","debate"],default="balanced")
    pc.add_argument("--max-peers","-n",type=int,default=3)
    pc.add_argument("--json","-j",action="store_true")
    pc.set_defaults(func=cmd_council)

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return 1

    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())