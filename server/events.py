"""Async event bus for Server-Sent Events (SSE) real-time updates.

Architecture:
- EventBus: singleton async pub/sub channel
- Publishers: adapters push events when data changes
- Consumers: SSE endpoint subscribes and streams to clients
- Event types: agent_status, session, error, circuit, project, monitoring

Event flow:
  Adapter change → bus.publish(event_type, payload) → SSE stream → browser EventSource

Event format (matches SSE spec):
  event: <type>
  data: <json payload>
  id: <sequential id for Last-Event-ID recovery>
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger("acc-dashboard.events")


class Event:
    """A single SSE event with type, payload, and sequential ID."""

    __slots__ = ("event_type", "payload", "timestamp", "event_id")
    _counter = 0

    def __init__(self, event_type: str, payload: dict[str, Any]) -> None:
        Event._counter += 1
        self.event_type = event_type
        self.payload = payload
        self.timestamp = datetime.now(timezone.utc)
        self.event_id = Event._counter

    def to_sse(self) -> str:
        """Format as SSE text/event-stream message."""
        data = json.dumps(
            {**self.payload, "timestamp": self.timestamp.isoformat()},
            default=str,
        )
        return f"id: {self.event_id}\nevent: {self.event_type}\ndata: {data}\n\n"


class EventBus:
    """Async fan-out event bus for SSE.

    Multiple consumers can subscribe. Each consumer gets its own
    asyncio.Queue. When a consumer falls behind (queue full), oldest
    events are dropped to prevent memory leaks.

    Usage:
        bus = EventBus()
        await bus.publish("agent_status", {"agent_id": "arete", "status": "online"})
        async for event in bus.subscribe():
            yield event.to_sse()
    """

    def __init__(self, max_queues: int = 10, queue_size: int = 64) -> None:
        self._subscribers: list[asyncio.Queue[Event]] = []
        self._max_queues = max_queues
        self._queue_size = queue_size

    async def publish(self, event_type: str, payload: dict[str, Any]) -> None:
        """Broadcast an event to all subscribers."""
        event = Event(event_type, payload)
        logger.debug(
            f"SSE event published: {event_type} (id={event.event_id})",
            extra={"event_type": event_type, "event_id": event.event_id},
        )
        dead: list[asyncio.Queue[Event]] = []
        for q in self._subscribers:
            try:
                # Non-blocking put; drop oldest if full
                if q.full():
                    try:
                        q.get_nowait()  # Drop oldest
                    except asyncio.QueueEmpty:
                        pass
                q.put_nowait(event)
            except asyncio.CancelledError:
                dead.append(q)
        for q in dead:
            self._subscribers.remove(q)

    def subscribe(self) -> asyncio.Queue[Event]:
        """Create a new subscriber queue. Caller should async-iterate."""
        if len(self._subscribers) >= self._max_queues:
            raise RuntimeError(
                f"Max SSE subscribers reached ({self._max_queues})"
            )
        q: asyncio.Queue[Event] = asyncio.Queue(maxsize=self._queue_size)
        self._subscribers.append(q)
        logger.info(f"SSE subscriber added (total: {len(self._subscribers)})")
        return q

    def unsubscribe(self, q: asyncio.Queue[Event]) -> None:
        """Remove a subscriber queue."""
        if q in self._subscribers:
            self._subscribers.remove(q)
            logger.info(f"SSE subscriber removed (total: {len(self._subscribers)})")

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)


# ── Global singleton ──────────────────────────────────────────────

_bus: EventBus | None = None


def get_event_bus() -> EventBus:
    """Get or create the global event bus singleton."""
    global _bus
    if _bus is None:
        _bus = EventBus()
    return _bus


async def publish_state_update() -> None:
    """Periodically publish full state updates to SSE subscribers.
    
    Should be started as an asyncio task in the app lifespan.
    Gathers dashboard state every 30 seconds and broadcasts to
    all connected SSE clients.
    """
    bus = get_event_bus()
    while True:
        try:
            import asyncio
            await asyncio.sleep(30)
            # Import here to avoid circular imports
            from server.api import _gather_state
            state = await _gather_state()
            await bus.publish("state", {"snapshot": state})
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning(f"SSE publish error: {exc}")