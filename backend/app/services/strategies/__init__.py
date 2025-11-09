from __future__ import annotations

"""
Strategy implementations and registry helpers.

Importing this package ensures all built-in strategies register themselves
with the shared `STRATEGY_REGISTRY`.
"""

from .base import STRATEGY_REGISTRY, Strategy
from . import moving_average  # noqa: F401  # Ensure registration side-effects

__all__ = ["STRATEGY_REGISTRY", "Strategy"]


