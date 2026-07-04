#!/usr/bin/env python3
"""
Universal Orchestrator CLI - Simple token-efficient orchestration
Usage:
  orch chat "prompt"                    - Send chat to best agent
  orch run-action "action"              - Execute action (trading, analysis, etc)
  orch status                           - Show orchestrator status
  orch batch "task1" "task2"            - Batch execute with priority
  orch health                           - Check all agent health
"""

import sys
import json
import subprocess
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Any, Optional

# Add project root to path
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from aimaster.master import AIMasterAgent
from aimaster.integrations import AgentOrchestrator


class OrchestratorCLI:
    """CLI interface for Universal Orchestrator"""

    def __init__(self):
        self.orch = AgentOrchestrator()
        self.request_count = 0

    def cmd_chat(self, prompt: str) -> Dict[str, Any]:
        """Execute chat request through orchestrator"""
        self.request_count += 1
        
        print(f"\n🤖 Orchestrator Request #{self.request_count}")
        print(f"📝 Prompt: {prompt[:100]}{'...' if len(prompt) > 100 else ''}")
        
        # Get available providers
        available = self.orch.ai_master.get_available_providers()
        print(f"📡 Available providers: {', '.join(available) if available else 'NONE'}")
        
        # Execute through AIMaster
        result = self.orch.ai_master.chat(prompt)
        
        response = {
            "request_id": self.request_count,
            "success": result.success,
            "content": result.content if result.success else result.error,
            "provider": result.provider_name,
            "latency_ms": result.latency_ms,
            "tokens_estimated": len(prompt) // 4 + 50,
        }
        
        print(f"✅ Response from: {result.provider_name} ({result.latency_ms:.0f}ms)")
        print(f"📄 Content: {result.content[:200]}{'...' if len(result.content) > 200 else ''}")
        
        return response

    def cmd_run_action(self, action: str) -> Dict[str, Any]:
        """Execute specialized action (trading, analysis, etc)"""
        self.request_count += 1
        
        print(f"\n⚙️  Orchestrator Action #{self.request_count}")
        print(f"🎯 Action: {action[:100]}{'...' if len(action) > 100 else ''}")
        
        # Determine action type
        action_lower = action.lower()
        
        if "trade" in action_lower or "arbitrage" in action_lower:
            print("📊 Routing to: Arbitrage Engine")
            if self.orch.arbitrage:
                stats = self.orch.arbitrage.get_stats()
                return {"success": True, "action": "trading", "stats": stats}
            else:
                return {"success": False, "error": "Arbitrage engine not initialized"}
        
        elif "analysis" in action_lower or "analyze" in action_lower:
            print("🔍 Routing to: AIMaster (multi-model analysis)")
            result = self.orch.ai_master.chat(f"Analyze: {action}")
            return {
                "success": result.success,
                "action": "analysis",
                "provider": result.provider_name,
                "content": result.content,
            }
        
        else:
            print("🔄 Routing to: Available AI providers")
            result = self.orch.ai_master.chat(action)
            return {
                "success": result.success,
                "action": "general",
                "provider": result.provider_name,
                "content": result.content,
            }

    def cmd_status(self) -> Dict[str, Any]:
        """Show orchestrator status and health"""
        print("\n📊 Orchestrator Status")
        print("=" * 60)
        
        status = self.orch.health_report()
        
        print(f"⏰ Timestamp: {status['timestamp']}")
        print(f"📡 AI Providers: {len(status['ai_master'])} available")
        print(f"   Available: {', '.join(status['available_providers']) if status['available_providers'] else 'NONE'}")
        
        if status['ollama_agent']['available']:
            print(f"🦙 Ollama: {status['ollama_agent']['model_count']} models")
        else:
            print(f"🦙 Ollama: offline")
        
        if status['arbitrage']['available']:
            print(f"📈 Arbitrage: active")
        else:
            print(f"📈 Arbitrage: unavailable")
        
        print(f"📋 Requests processed: {self.request_count}")
        print("=" * 60)
        
        return status

    def cmd_batch(self, tasks: List[str]) -> List[Dict[str, Any]]:
        """Execute batch of tasks with priority"""
        print(f"\n🔄 Batch Execute ({len(tasks)} tasks)")
        print("=" * 60)
        
        results = []
        for i, task in enumerate(tasks, 1):
            print(f"\n[{i}/{len(tasks)}] {task[:80]}...")
            result = self.cmd_chat(task)
            results.append(result)
        
        print("\n✅ Batch complete")
        return results

    def cmd_health(self) -> Dict[str, Any]:
        """Check all agent health"""
        print("\n🏥 Agent Health Check")
        print("=" * 60)
        
        health = self.orch.ai_master.health_check()
        available = self.orch.ai_master.get_available_providers()
        
        for agent, healthy in health.items():
            status = "🟢 HEALTHY" if healthy else "🔴 OFFLINE"
            print(f"{status} {agent}")
        
        print(f"\n📊 Summary: {len(available)}/{len(health)} agents online")
        print("=" * 60)
        
        return {"health": health, "available_count": len(available), "total_count": len(health)}

    def run(self):
        """Main CLI loop"""
        if len(sys.argv) < 2:
            print(__doc__)
            return
        
        cmd = sys.argv[1]
        args = sys.argv[2:] if len(sys.argv) > 2 else []
        
        try:
            if cmd == "chat" and args:
                result = self.cmd_chat(" ".join(args))
                print(f"\n📤 JSON Response:\n{json.dumps(result, indent=2)}")
            
            elif cmd == "run-action" and args:
                result = self.cmd_run_action(" ".join(args))
                print(f"\n📤 JSON Response:\n{json.dumps(result, indent=2)}")
            
            elif cmd == "status":
                result = self.cmd_status()
                print(f"\n📤 JSON Response:\n{json.dumps(result, indent=2, default=str)}")
            
            elif cmd == "batch" and args:
                results = self.cmd_batch(args)
                print(f"\n📤 JSON Response:\n{json.dumps(results, indent=2)}")
            
            elif cmd == "health":
                result = self.cmd_health()
                print(f"\n📤 JSON Response:\n{json.dumps(result, indent=2)}")
            
            else:
                print(f"❌ Unknown command: {cmd}")
                print(__doc__)
                return 1
            
            return 0
        
        except Exception as e:
            print(f"❌ Error: {e}")
            import traceback
            traceback.print_exc()
            return 1


if __name__ == "__main__":
    cli = OrchestratorCLI()
    sys.exit(cli.run())
