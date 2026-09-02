#!/usr/bin/env python3
"""
Lean-Ctx Integration for Google Colab
Enables persistent memory for conversation context, tasks, commands, tokens, and balances
"""

import os
import json
import pickle
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional

# Memory storage paths
MEMORY_BASE = '/content/drive/MyDrive/UltimateArbitrageHFT_Memory'
CONTEXT_FILE = f'{MEMORY_BASE}/lean_ctx_cache.json'
BALANCES_FILE = f'{MEMORY_BASE}/balances.json'
TOKENS_FILE = f'{MEMORY_BASE}/tokens.json'
TASKS_FILE = f'{MEMORY_BASE}/tasks.json'
COMMANDS_FILE = f'{MEMORY_BASE}/commands.json'

class LeanCtxColab:
    """Lean-Ctx implementation for Google Colab persistent memory"""
    
    def __init__(self, memory_base: str = MEMORY_BASE):
        self.memory_base = Path(memory_base)
        self.memory_base.mkdir(parents=True, exist_ok=True)
        
        # Memory stores
        self.context: Dict[str, Any] = {}
        self.balances: Dict[str, Any] = {}
        self.tokens: Dict[str, Any] = {}
        self.tasks: List[Dict] = []
        self.commands: List[Dict] = []
        
        self._load_all()
    
    def _load_all(self):
        """Load all memory from persistent storage"""
        try:
            if Path(CONTEXT_FILE).exists():
                with open(CONTEXT_FILE, 'r') as f:
                    self.context = json.load(f)
            if Path(BALANCES_FILE).exists():
                with open(BALANCES_FILE, 'r') as f:
                    self.balances = json.load(f)
            if Path(TOKENS_FILE).exists():
                with open(TOKENS_FILE, 'r') as f:
                    self.tokens = json.load(f)
            if Path(TASKS_FILE).exists():
                with open(TASKS_FILE, 'r') as f:
                    self.tasks = json.load(f)
            if Path(COMMANDS_FILE).exists():
                with open(COMMANDS_FILE, 'r') as f:
                    self.commands = json.load(f)
            print(f"✅ Memory loaded: {len(self.context)} contexts, {len(self.balances)} balances, {len(self.tokens)} tokens")
        except Exception as e:
            print(f"⚠️ Memory load error: {e}")
    
    def save_all(self):
        """Save all memory to persistent storage"""
        try:
            with open(CONTEXT_FILE, 'w') as f:
                json.dump(self.context, f, indent=2, default=str)
            with open(BALANCES_FILE, 'w') as f:
                json.dump(self.balances, f, indent=2, default=str)
            with open(TOKENS_FILE, 'w') as f:
                json.dump(self.tokens, f, indent=2, default=str)
            with open(TASKS_FILE, 'w') as f:
                json.dump(self.tasks, f, indent=2, default=str)
            with open(COMMANDS_FILE, 'w') as f:
                json.dump(self.commands, f, indent=2, default=str)
            print("💾 Memory saved to Google Drive")
        except Exception as e:
            print(f"⚠️ Memory save error: {e}")
    
    def remember_context(self, session_id: str, context: str, tags: List[str] = None):
        """Remember conversation context with tags"""
        self.context[session_id] = {
            'context': context,
            'tags': tags or [],
            'timestamp': datetime.now().isoformat(),
            'session_length': len(context.split())
        }
        self.save_all()
        return session_id
    
    def get_context(self, session_id: str) -> Optional[Dict]:
        """Get cached context by session ID"""
        return self.context.get(session_id)
    
    def search_context(self, query: str, max_results: int = 5) -> List[Dict]:
        """Search contexts by query"""
        results = []
        for sid, data in self.context.items():
            if query.lower() in data.get('context', '').lower():
                results.append({
                    'session_id': sid,
                    'context': data['context'][:500],
                    'tags': data.get('tags', []),
                    'timestamp': data['timestamp']
                })
        return results[:max_results]
    
    def update_balance(self, key: str, data: Dict):
        """Update balance entry"""
        self.balances[key] = {
            **self.balances.get(key, {}),
            **data,
            'last_updated': datetime.now().isoformat()
        }
        self.save_all()
    
    def get_balance(self, key: str) -> Optional[Dict]:
        """Get balance by key"""
        return self.balances.get(key)
    
    def add_token(self, name: str, token_data: Dict):
        """Add or update token"""
        self.tokens[name] = {
            **self.tokens.get(name, {}),
            **token_data,
            'updated_at': datetime.now().isoformat()
        }
        self.save_all()
    
    def get_token(self, name: str) -> Optional[Dict]:
        """Get token by name"""
        return self.tokens.get(name)
    
    def add_task(self, task: Dict):
        """Add a task to track"""
        self.tasks.append({
            **task,
            'created_at': datetime.now().isoformat(),
            'status': task.get('status', 'pending')
        })
        self.save_all()
        return len(self.tasks) - 1
    
    def update_task(self, task_id: int, updates: Dict):
        """Update existing task"""
        if 0 <= task_id < len(self.tasks):
            self.tasks[task_id].update(updates)
            self.tasks[task_id]['updated_at'] = datetime.now().isoformat()
            self.save_all()
            return True
        return False
    
    def get_tasks(self, status: str = None) -> List[Dict]:
        """Get tasks, optionally filtered by status"""
        if status:
            return [t for t in self.tasks if t.get('status') == status]
        return self.tasks.copy()
    
    def add_command(self, command: str, description: str = ''):
        """Add a command to history"""
        self.commands.append({
            'command': command,
            'description': description,
            'executed_at': datetime.now().isoformat()
        })
        self.save_all()
        return len(self.commands) - 1
    
    def get_recent_commands(self, limit: int = 10) -> List[Dict]:
        """Get recent commands"""
        return self.commands[-limit:] if self.commands else []
    
    def get_summary(self) -> Dict:
        """Get memory summary"""
        return {
            'contexts': len(self.context),
            'balances': len(self.balances),
            'tokens': len(self.tokens),
            'tasks': len(self.tasks),
            'commands': len(self.commands),
            'last_updated': datetime.now().isoformat(),
            'memory_path': str(self.memory_base)
        }


# Initialize lean-ctx
lean_ctx = LeanCtxColab()
print("🧠 Lean-Ctx Colab initialized")
print(f"📊 Memory summary: {lean_ctx.get_summary()}")