"""Schedule independent develop tasks into parallel waves."""

from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path
from typing import Any


def normalize_relpath(path: str) -> str:
    return str(Path(str(path).strip())).replace("\\", "/").lstrip("./")


def task_id(task: dict[str, Any]) -> str:
    return str(task.get("id") or "").strip()


def task_owner(task: dict[str, Any]) -> str:
    return str(task.get("owner") or "backend").strip().lower() or "backend"


def task_files(task: dict[str, Any]) -> set[str]:
    raw = task.get("target_files") or []
    if isinstance(raw, str):
        raw = [raw]
    return {normalize_relpath(p) for p in raw if str(p).strip()}


def tasks_conflict(left: dict[str, Any], right: dict[str, Any]) -> bool:
    """True when two tasks must not edit the workspace at the same time."""
    left_files = task_files(left)
    right_files = task_files(right)
    if left_files and right_files:
        return bool(left_files & right_files)
    # Unknown file sets: only parallelize across different owners.
    return task_owner(left) == task_owner(right)


def iter_task_waves(
    tasks: Iterable[dict[str, Any]],
    completed: Iterable[str] | None = None,
) -> list[list[dict[str, Any]]]:
    """Partition remaining tasks into waves with disjoint file edits.

    Ready tasks (dependencies done) that do not conflict run together.
    Overlapping files wait for the next wave. Cycles are broken by running
    one remaining task alone.
    """
    remaining = [
        t for t in tasks if not task_id(t) or task_id(t) not in set(completed or [])
    ]
    all_ids = {task_id(t) for t in remaining if task_id(t)}
    done = {str(x) for x in (completed or [])}
    waves: list[list[dict[str, Any]]] = []

    while remaining:
        ready = [
            t
            for t in remaining
            if all(
                dep in done or dep not in all_ids
                for dep in (t.get("depends_on") or [])
            )
        ]
        if not ready:
            ready = [remaining[0]]

        wave: list[dict[str, Any]] = []
        for task in ready:
            if any(tasks_conflict(task, other) for other in wave):
                continue
            wave.append(task)
        if not wave:
            wave = [ready[0]]

        waves.append(wave)
        wave_ids = {task_id(t) for t in wave}
        done.update(i for i in wave_ids if i)
        remaining = [t for t in remaining if t not in wave]

    return waves
