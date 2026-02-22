from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, List, Optional

from .state import AppState


@dataclass
class Outcome:
    key: str
    title: str
    description: str
    evaluator: Callable[[AppState], List[dict]]


def list_outcomes() -> List[Outcome]:
    # Placeholder registry; we will add real outcomes next.
    return []
