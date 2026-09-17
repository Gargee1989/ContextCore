"""Pytest configuration to ensure sys.path includes the project root."""

import sys
from pathlib import Path

# Add project root (ContextCore) to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
