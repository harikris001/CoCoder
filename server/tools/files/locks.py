"""Thread-safe per-file locks so parallel agents cannot clobber the same path."""

from __future__ import annotations

import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

_guard = threading.Lock()
_locks: dict[str, threading.Lock] = {}


def _lock_for(path: Path) -> threading.Lock:
    key = str(path.resolve())
    with _guard:
        lock = _locks.get(key)
        if lock is None:
            lock = threading.Lock()
            _locks[key] = lock
        return lock


@contextmanager
def exclusive_path(path: Path) -> Iterator[None]:
    lock = _lock_for(path)
    lock.acquire()
    try:
        yield
    finally:
        lock.release()
