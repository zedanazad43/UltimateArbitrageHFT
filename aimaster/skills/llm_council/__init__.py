"""LLM Council — Multi-provider parallel reasoning for AIMaster."""
from .council import run_council, CouncilResult, CouncilVerdict
__all__ = ["run_council", "CouncilResult", "CouncilVerdict"]
