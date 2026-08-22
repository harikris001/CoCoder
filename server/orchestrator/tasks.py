"""Serial develop-task helpers."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any


def task_id(task: dict[str, Any]) -> str:
    return str(task.get("id") or "").strip()


def task_owner(task: dict[str, Any]) -> str:
    return str(task.get("owner") or "backend").strip().lower() or "backend"


def remaining_tasks(
    tasks: Iterable[dict[str, Any]],
    completed: Iterable[str] | None = None,
) -> list[dict[str, Any]]:
    """Remaining tasks in serial order: planner order, dependencies first."""
    leftover = [
        t for t in tasks if not task_id(t) or task_id(t) not in set(completed or [])
    ]
    all_ids = {task_id(t) for t in leftover if task_id(t)}
    done = {str(x) for x in (completed or [])}
    ordered: list[dict[str, Any]] = []

    while leftover:
        ready = [
            t
            for t in leftover
            if all(
                dep in done or dep not in all_ids
                for dep in (t.get("depends_on") or [])
            )
        ]
        nxt = ready[0] if ready else leftover[0]
        ordered.append(nxt)
        tid = task_id(nxt)
        if tid:
            done.add(tid)
        leftover = [t for t in leftover if t is not nxt]

    return ordered
