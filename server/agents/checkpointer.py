"""Shared LangGraph checkpointer so agent conversations persist across tasks and restarts.

Each agent graph compiles against this one process-wide SQLite-backed
``SqliteSaver``. Threads are isolated by ``thread_id`` (e.g. ``run5-frontend-0``),
so the pipeline keeps full checkpoint history per run/stage/attempt for
time-travel debugging, and state survives server restarts.
"""

from __future__ import annotations

import sqlite3
import threading

from langgraph.checkpoint.sqlite import SqliteSaver

from config import get_settings

_lock = threading.Lock()
_instances: dict[str, SqliteSaver] = {}


def get_checkpointer(db_path: str | None = None) -> SqliteSaver:
    """Return the process-wide checkpointer, opening the SQLite DB once.

    Safe to share across agents: SQLite handles concurrent access (WAL mode),
    the saver serializes writes internally, and threads are namespaced by
    ``thread_id``.
    """
    path = db_path or get_settings().agent_checkpoint_db
    with _lock:
        existing = _instances.get(path)
        if existing is not None:
            return existing
        conn = sqlite3.connect(path, check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        saver = SqliteSaver(conn)
        saver.setup()
        _instances[path] = saver
        return saver
