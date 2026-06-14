#!/usr/bin/env python3
"""
AIMaster Entry Point
Run with: python aimaster/run.py [command]
Or:       python -m aimaster.run [command]
"""

import sys
import os

# Ensure the parent directory (project root) is in the Python path
# so that 'from aimaster.xxx import ...' works when run directly.
_PARENT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)

from aimaster.cli import main

if __name__ == "__main__":
    main()
