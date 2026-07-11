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



def cmd_skills_list(args) -> int:
    """List all loaded AIMaster skills."""
    from .skills.loader import SkillLoader
    loader = SkillLoader()
    skills = loader.list_skills()
    print("=" * 60)
    print(f"  AIMaster Skills ({len(skills)} loaded)")
    print("=" * 60)
    for s in skills:
        extras = []
        if s.has_scripts: extras.append("scripts")
        if s.has_references: extras.append("refs")
        if s.has_assets: extras.append("assets")
        tag = " [" + "+".join(extras) + "]" if extras else ""
        print(f"  {s.name:35s} {s.description[:60]}{tag}")
    print("=" * 60)
    return 0


def cmd_skills_show(args) -> int:
    """Show full instructions for a specific skill."""
    from .skills.loader import SkillLoader
    loader = SkillLoader()
    skill = loader.get_skill(args.name)
    if not skill:
        print(f"Skill not found: {args.name}", file=sys.stderr)
        return 1
    print(f"Name: {skill.name}")
    print(f"Description: {skill.description}")
    if skill.has_scripts: print("Scripts: yes")
    if skill.has_references: print("References: yes")
    if skill.has_assets: print("Assets: yes")
    print("=" * 60)
    print(skill.body)
    return 0


def cmd_skills_search(args) -> int:
    """Search skills by keyword."""
    from .skills.loader import SkillLoader
    loader = SkillLoader()
    results = loader.search(args.query)
    if not results:
        print(f"No skills found matching: {args.query}")
        return 0
    print(f"Found {len(results)} skill(s) matching \"{args.query}\":")
    for s in results:
        print(f"  {s.name}: {s.description[:80]}")
    return 0


def cmd_skills_run(args) -> int:
    """Run a skill with AIMaster providers."""
    from .skills.loader import SkillLoader
    loader = SkillLoader()
    skill = loader.get_skill(args.name)
    if not skill:
        print(f"Skill not found: {args.name}", file=sys.stderr)
        return 1
    prompt = args.prompt
    if not prompt and not sys.stdin.isatty():
        prompt = sys.stdin.read().strip()
    if not prompt:
        print("Error: No prompt provided.", file=sys.stderr)
        return 1
    system_prompt = f"""You are an expert AI assistant. Use the following skill instructions to complete the task:

[SKILL: {skill.name}]
{skill.body}
[/SKILL]

Follow the skill instructions above carefully."""
    agent = AIMasterAgent(args.config)
    print(f"Skill: {skill.name}")
    print(f"Q: {prompt[:100]}")
    print("-" * 50)
    result = agent.chat(prompt=prompt, provider=args.provider, system_prompt=system_prompt)
    if result.success:
        print(result.content)
        print("-" * 50)
        print(f"Provider: {result.provider_name} | {result.latency_ms:.0f}ms")
        return 0
    else:
        print(f"ERROR: {result.error}", file=sys.stderr)
        return 1


def cmd_skills_list(args) -> int:
    """List all loaded AIMaster skills."""
    from .skills.loader import SkillLoader
    loader = SkillLoader()
    skills = loader.list_skills()
    print("=" * 60)
    print(f"  AIMaster Skills ({len(skills)} loaded)")
    print("=" * 60)
    for s in skills:
        extras = []
        if s.has_scripts: extras.append("scripts")
        if s.has_references: extras.append("refs")
        if s.has_assets: extras.append("assets")
        tag = " [" + "+".join(extras) + "]" if extras else ""
        print(f"  {s.name:35s} {s.description[:60]}{tag}")
    print("=" * 60)
    return 0


def cmd_skills_show(args) -> int:
    """Show full instructions for a specific skill."""
    from .skills.loader import SkillLoader
    loader = SkillLoader()
    skill = loader.get_skill(args.name)
    if not skill:
        print(f"Skill not found: {args.name}", file=sys.stderr)
        return 1
    print(f"Name: {skill.name}")
    print(f"Description: {skill.description}")
    if skill.has_scripts: print("Scripts: yes")
    if skill.has_references: print("References: yes")
    if skill.has_assets: print("Assets: yes")
    print("=" * 60)
    import sys as _sys; print(skill.body.encode(_sys.stdout.encoding,errors="replace").decode(_sys.stdout.encoding,errors="replace"))
    return 0


def cmd_skills_search(args) -> int:
    """Search skills by keyword."""
    from .skills.loader import SkillLoader
    loader = SkillLoader()
    results = loader.search(args.query)
    if not results:
        print(f"No skills found matching: {args.query}")
        return 0
    print(f"Found {len(results)} skill(s) matching \"{args.query}\":")
    for s in results:
        print(f"  {s.name}: {s.description[:80]}")
    return 0


def cmd_skills_run(args) -> int:
    """Run a skill with AIMaster providers."""
    from .skills.loader import SkillLoader
    loader = SkillLoader()
    skill = loader.get_skill(args.name)
    if not skill:
        print(f"Skill not found: {args.name}", file=sys.stderr)
        return 1
    prompt = args.prompt
    if not prompt and not sys.stdin.isatty():
        prompt = sys.stdin.read().strip()
    if not prompt:
        print("Error: No prompt provided.", file=sys.stderr)
        return 1
    system_prompt = f"""You are an expert AI assistant. Use the following skill instructions to complete the task:

[SKILL: {skill.name}]
{skill.body}
[/SKILL]

Follow the skill instructions above carefully."""
    agent = AIMasterAgent(args.config)
    print(f"Skill: {skill.name}")
    print(f"Q: {prompt[:100]}")
    print("-" * 50)
    result = agent.chat(prompt=prompt, provider=args.provider, system_prompt=system_prompt)
    if result.success:
        print(result.content)
        print("-" * 50)
        print(f"Provider: {result.provider_name} | {result.latency_ms:.0f}ms")
        return 0
    else:
        print(f"ERROR: {result.error}", file=sys.stderr)
        return 1

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


def cmd_serve(args) -> int:
    """Start the AIMaster HTTP server."""
    from .http_server import start_http_server

    host = args.host or "127.0.0.1"
    port = args.port or 8000
    debug = args.debug

    print("=" * 60)
    print("  AIMaster HTTP Server")
    print("=" * 60)
    print(f"  Starting on http://{host}:{port}")
    print(f"  Endpoints: POST /chat, GET /health, GET /")
    print(f"  Debug: {debug}")
    print("  Press Ctrl+C to stop")
    print("=" * 60)
    print()

    try:
        start_http_server(
            config_path=args.config,
            host=host,
            port=port,
            debug=debug,
        )
        return 0
    except KeyboardInterrupt:
        print("\n" + "=" * 60)
        print("  Server stopped")
        print("=" * 60)
        return 0
    except Exception as e:
        print(f"\nERROR: {e}", file=sys.stderr)
        return 1


def cmd_orchestrator(args) -> int:
    """Universal Orchestrator - Token-efficient primary agent for all platforms."""
    from .integrations import AgentOrchestrator
    
    orch = AgentOrchestrator()
    
    if args.chat:
        print(f"\n🤖 Orchestrator Chat")
        result = orch.ai_master.chat(args.chat)
        if result.success:
            print(f"\n✅ {result.provider_name}:")
            print(result.content)
            print(f"\n📊 Latency: {result.latency_ms:.0f}ms")
        else:
            print(f"\n❌ Error: {result.error}")
        return 0 if result.success else 1
    
    elif args.action:
        print(f"\n⚙️  Orchestrator Action: {args.action}")
        # Route based on action type
        if "trade" in args.action.lower() or "arbitrage" in args.action.lower():
            print("📈 Routing to: Arbitrage Engine")
            if orch.arbitrage:
                stats = orch.arbitrage.get_stats()
                print(f"✅ {stats}")
            else:
                print("❌ Arbitrage engine not initialized")
        else:
            result = orch.ai_master.chat(args.action)
            if result.success:
                print(f"✅ {result.provider_name}:")
                print(result.content)
            else:
                print(f"❌ Error: {result.error}")
        return 0
    
    elif args.status:
        print("\n📊 Orchestrator Status")
        print("=" * 60)
        status = orch.health_report()
        print(f"📡 Providers: {len(status['available_providers'])} available")
        print(f"   {', '.join(status['available_providers']) if status['available_providers'] else 'NONE'}")
        if status['ollama_agent']['available']:
            print(f"🦙 Ollama: {status['ollama_agent']['model_count']} models")
        else:
            print(f"🦙 Ollama: offline")
        if status['arbitrage']['available']:
            print(f"📈 Arbitrage: active")
        print("=" * 60)
        return 0
    
    elif args.health:
        print("\n🏥 Agent Health Check")
        print("=" * 60)
        health = orch.ai_master.health_check()
        available = orch.ai_master.get_available_providers()
        for agent, healthy in health.items():
            status = "🟢" if healthy else "🔴"
            print(f"{status} {agent}: {'ONLINE' if healthy else 'OFFLINE'}")
        print(f"\n📊 {len(available)}/{len(health)} agents online")
        print("=" * 60)
        return 0
    
    else:
        print("\n🚀 Universal Orchestrator")
        print("=" * 60)
        print("Token-efficient primary agent (free models: Ollama, CodeGeeX, AIMaster)")
        print("\nUsage:")
        print("  --chat TEXT      Send chat message")
        print("  --action TEXT    Execute specialized action")
        print("  --status         Show orchestrator status")
        print("  --health         Check agent health")
        print("\nExamples:")
        print("  aimaster orchestrator --chat 'Hello'")
        print("  aimaster orchestrator --action 'analyze market trends'")
        print("  aimaster orchestrator --status")
        print("=" * 60)
        return 0


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
  aimaster concurrent "What is HFT?"        # Race all providers
  aimaster council "Q"                      # LLM Council
  aimaster serve                            # Start HTTP server (port 8000)
  aimaster serve --port 9000                # Start on custom port
  aimaster skills list                      # List loaded skills
  aimaster skills search "changelog"        # Search skills
  aimaster skills show changelog-generator  # Show skill details
  aimaster skills run changelog-generator "since last week"  # Run a skill
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

    # serve
    p_serve = subparsers.add_parser("serve", help="Start HTTP server")
    p_serve.add_argument("--host", help="Server host (default: 127.0.0.1)")
    p_serve.add_argument("--port", "-p", type=int, help="Server port (default: 8000)")
    p_serve.add_argument("--debug", "-d", action="store_true", help="Enable debug mode")
    p_serve.set_defaults(func=cmd_serve)

    # orchestrator
    p_orch = subparsers.add_parser("orchestrator", help="Universal token-efficient agent")
    p_orch.add_argument("--chat", help="Send chat message")
    p_orch.add_argument("--action", help="Execute specialized action")
    p_orch.add_argument("--status", action="store_true", help="Show status")
    p_orch.add_argument("--health", action="store_true", help="Check agent health")
    p_orch.set_defaults(func=cmd_orchestrator)

    # concurrent
    p_conc = subparsers.add_parser("concurrent", help="Race all providers")
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
    # skills
    p_skills = subparsers.add_parser("skills", help="Manage AIMaster skills")
    p_skills_sub = p_skills.add_subparsers(dest="skills_cmd", help="Skills subcommand")

    p_skills_list = p_skills_sub.add_parser("list", help="List all loaded skills")
    p_skills_list.set_defaults(func=cmd_skills_list)

    p_skills_show = p_skills_sub.add_parser("show", help="Show skill instructions")
    p_skills_show.add_argument("name", help="Skill name")
    p_skills_show.set_defaults(func=cmd_skills_show)

    p_skills_search = p_skills_sub.add_parser("search", help="Search skills by keyword")
    p_skills_search.add_argument("query", help="Search query")
    p_skills_search.set_defaults(func=cmd_skills_search)

    p_skills_run = p_skills_sub.add_parser("run", help="Run a skill with AI provider")
    p_skills_run.add_argument("name", help="Skill name")
    p_skills_run.add_argument("prompt", nargs="?", help="Task prompt")
    p_skills_run.add_argument("--provider", "-p", help="Force specific provider")
    p_skills_run.set_defaults(func=cmd_skills_run)

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return 1

    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())