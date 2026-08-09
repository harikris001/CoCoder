"""In-process pub/sub for run event websockets."""

from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Any


class EventBus:
    def __init__(self) -> None:
        self._subscribers: dict[int, set[asyncio.Queue]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def subscribe(self, run_id: int) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        async with self._lock:
            self._subscribers[run_id].add(queue)
        return queue

    async def unsubscribe(self, run_id: int, queue: asyncio.Queue) -> None:
        async with self._lock:
            self._subscribers[run_id].discard(queue)
            if not self._subscribers[run_id]:
                del self._subscribers[run_id]

    async def publish(self, run_id: int, event: dict[str, Any]) -> None:
        async with self._lock:
            queues = list(self._subscribers.get(run_id, set()))
        for queue in queues:
            await queue.put(event)


event_bus = EventBus()
