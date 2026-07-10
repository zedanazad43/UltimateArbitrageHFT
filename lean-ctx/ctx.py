#!/usr/bin/env python3
"""
lean-ctx — token-lean context tools for AI agents (local + CI).

Implements the four tools named in .github/copilot-instructions.md:
  ctx_read   read a file (or slice) with line numbers, truncated to a budget
  ctx_search git-aware ripgrep-free search, returns matching files + lines
  ctx_tree   compact repo structure (depth-limited, ignores junk dirs)
  ctx_shell  run a shell command, returning compressed/truncated output

All commands are git-aware by default: ctx_search / ctx_tree operate on
TRACKED files unless --all is passed, so agents never burn tokens on
node_modules, .git, build artifacts, or untracked scratch.

Usage:
  python3 lean-ctx/ctx.py read  <path> [--lines 1-50] [--budget 4000]
  python3 lean-ctx/ctx.py search <pattern> [--glob '*.py'] [--limit 20]
  python3 lean-ctx/ctx.py tree  [--depth 2] [--dir <path>]
  python3 lean-ctx/ctx.py shell <command> [--budget 4000]

Exit code 0 = ok, 1 = usage/error, 2 = no matches.
"""
import argparse
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IGNORE_DIRS = {'.git', 'node_modules', '__pycache__', 'archive', 'dist', 'build',
               '.next', 'coverage', '.venv', 'venv'}


def _tracked_files(path_filter=None):
    """Return list of tracked files (relative to ROOT), git-aware."""
    r = subprocess.run(['git', 'ls-files'], cwd=ROOT, capture_output=True, text=True)
    files = [f for f in r.stdout.splitlines() if f.strip()]
    if path_filter:
        files = [f for f in files if f.startswith(path_filter.rstrip('/') + '/') or f == path_filter]
    return files


def _read_file(path, lines=None, budget=4000):
    full = os.path.join(ROOT, path)
    if not os.path.isfile(full):
        return f"ERROR: not a file: {path}", 1
    with open(full, 'r', errors='replace') as f:
        content = f.read()
    out_lines = content.splitlines()
    if lines:
        try:
            if '-' in lines:
                a, b = lines.split('-')
                a, b = int(a), int(b)
            else:
                a, b = int(lines), int(lines)
            out_lines = out_lines[a - 1:b]
        except ValueError:
            return f"ERROR: bad --lines '{lines}' (use N or N-M)", 1
    text = '\n'.join(f'{i+1}|{ln}' for i, ln in enumerate(out_lines, start=1))
    if len(text) > budget:
        text = text[:budget] + f'\n…[truncated at {budget} chars]'
    return text, 0


def _search(pattern, glob=None, limit=20, use_all=False):
    cmd = ['git', 'grep', '-nI', '--line-number', '-e', pattern]
    if glob:
        # git grep accepts a pathspec, not --glob: use ':(glob)<pat>'
        cmd += [f':(glob){glob}']
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    if r.returncode == 1:
        return f"NO MATCHES: {pattern}", 2
    if r.returncode != 0:
        return f"ERROR: {r.stderr.strip()}", 1
    matches = [m for m in r.stdout.splitlines() if m.strip()]
    if limit:
        matches = matches[:limit]
    return '\n'.join(matches), 0


def _tree(depth=2, d=None):
    base = os.path.join(ROOT, d) if d else ROOT
    prefix = (d.rstrip('/') + '/') if d else ''
    files = _tracked_files(prefix) if not d else _tracked_files(prefix)
    # build a set of directory paths present at <= depth
    shown = set()
    out = []
    for f in files:
        parts = f.split('/')
        for i in range(min(depth, len(parts))):
            node = '/'.join(parts[:i + 1])
            if node not in shown:
                shown.add(node)
                indent = '  ' * i
                name = parts[i]
                is_dir = i < len(parts) - 1
                out.append(f'{indent}{name}/' if is_dir else f'{indent}{name}')
    # prune deeper entries already covered by dirs
    return ('\n'.join(out) if out else '(no tracked files)'), 0


def _shell(command, budget=4000):
    r = subprocess.run(command, shell=True, cwd=ROOT, capture_output=True, text=True)
    text = (r.stdout or '') + (r.stderr or '')
    if len(text) > budget:
        text = text[:budget] + f'\n…[truncated at {budget} chars]'
    if not text.strip():
        text = f'(no output, exit={r.returncode})'
    return text, r.returncode


def main():
    ap = argparse.ArgumentParser(prog='ctx', description='lean-ctx token-lean context tools')
    sub = ap.add_subparsers(dest='cmd', required=True)

    pr = sub.add_parser('read', help='read a file (lean)')
    pr.add_argument('path')
    pr.add_argument('--lines', help='line range N or N-M')
    pr.add_argument('--budget', type=int, default=4000)

    ps = sub.add_parser('search', help='git-aware search')
    ps.add_argument('pattern')
    ps.add_argument('--glob')
    ps.add_argument('--limit', type=int, default=20)
    ps.add_argument('--all', action='store_true', help='search all files, not just tracked')

    pt = sub.add_parser('tree', help='compact structure')
    pt.add_argument('--depth', type=int, default=2)
    pt.add_argument('--dir')

    pl = sub.add_parser('shell', help='compressed shell output')
    pl.add_argument('command')
    pl.add_argument('--budget', type=int, default=4000)

    args = ap.parse_args()
    if args.cmd == 'read':
        out, rc = _read_file(args.path, args.lines, args.budget)
    elif args.cmd == 'search':
        out, rc = _search(args.pattern, args.glob, args.limit, args.all)
    elif args.cmd == 'tree':
        out, rc = _tree(args.depth, args.dir)
    elif args.cmd == 'shell':
        out, rc = _shell(args.command, args.budget)
    else:
        out, rc = ('unknown command', 1)
    print(out)
    sys.exit(rc)


if __name__ == '__main__':
    main()
