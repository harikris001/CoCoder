"""Quality-gate retry decisions for tester and reviewer."""

from __future__ import annotations

from typing import Literal

GateAction = Literal["proceed", "retry_develop", "needs_human"]


def after_quality_gate(*, passed: bool, retries: int, max_retries: int) -> GateAction:
    """Decide what to do after tester or reviewer returns.

    ``retries`` is the attempt index *before* incrementing (0 on first failure).
    """
    if passed:
        return "proceed"
    if retries + 1 > max_retries:
        return "needs_human"
    return "retry_develop"
