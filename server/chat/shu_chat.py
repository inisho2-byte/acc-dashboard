"""Shu chat engine — sends messages to the Shu agent over HTTP.

Communicates with Shu via a Tailscale-hosted HTTP endpoint and
reads inbound messages from a shared JSONL mailbox file.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

import httpx

from server.chat.session_store import ChatSessionStore

logger = logging.getLogger("acc-dashboard.chat.shu")

# Shu's HTTP message endpoint (Tailscale network)
SHU_URL = "http://100.85.6.14:8765/msg"

# Shared JSONL inbox file for Shu messages
INBOX_PATH = Path.home() / "from_shu.jsonl"


class ShuChatEngine:
    """Async chat engine that communicates with Shu over HTTP.

    Messages are POSTed to Shu's endpoint and outbound records are
    appended to the shared JSONL inbox. Inbound messages are read
    from the same file.
    """

    def __init__(
        self,
        session_store: ChatSessionStore,
        http_client: httpx.AsyncClient,
    ) -> None:
        self._store = session_store
        self._client = http_client

    async def send(self, message: str) -> dict:
        """Send a chat message to Shu and log the outbound record.

        Args:
            message: The message text to send.

        Returns:
            Dict with success status and timestamp or error details.
        """
        timestamp = datetime.now(timezone.utc).isoformat()
        payload = {
            "from": "arete",
            "content": message,
            "type": "chat",
            "timestamp": timestamp,
        }

        try:
            response = await self._client.post(
                SHU_URL,
                json=payload,
                timeout=15.0,
            )
            response.raise_for_status()
        except httpx.ConnectError as exc:
            logger.warning("Shu unreachable (connect): %s", exc)
            return {"success": False, "error": f"Shu unreachable: {exc}"}
        except httpx.TimeoutException as exc:
            logger.warning("Shu unreachable (timeout): %s", exc)
            return {"success": False, "error": f"Shu unreachable: {exc}"}
        except httpx.HTTPStatusError as exc:
            logger.warning("Shu HTTP error: %s", exc)
            return {
                "success": False,
                "error": f"Shu returned {exc.response.status_code}",
            }

        # Append outbound record to the shared JSONL inbox
        outbound = {
            "from": "arete",
            "to": "shu",
            "type": "chat_out",
            "content": message,
            "timestamp": timestamp,
        }
        try:
            INBOX_PATH.parent.mkdir(parents=True, exist_ok=True)
            with open(INBOX_PATH, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(outbound) + "\n")
        except OSError as exc:
            logger.warning("Failed to append to %s: %s", INBOX_PATH, exc)

        return {"success": True, "sent_at": timestamp}

    @staticmethod
    def get_messages(
        since: str | None = None,
        limit: int = 50,
    ) -> list[dict]:
        """Read chat messages from the shared JSONL inbox.

        Filters for lines where from=="shu" (not "shu-trading") and
        type is "chat" or "chat_out". Results are ordered by timestamp
        ascending.

        Args:
            since: If provided, only return messages with timestamp > since.
            limit: Maximum number of messages to return.

        Returns:
            List of dicts with role, content, timestamp, and type.
        """
        if not INBOX_PATH.exists():
            return []

        messages: list[dict] = []
        try:
            with open(INBOX_PATH, "r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                    except (json.JSONDecodeError, ValueError):
                        continue

                    sender = entry.get("from", "")
                    msg_type = entry.get("type", "")

                    # Only include messages from "shu" (not "shu-trading")
                    # and only chat/chat_out types
                    if sender != "shu" or msg_type not in ("chat", "chat_out"):
                        continue

                    ts = entry.get("timestamp", "")
                    if since and ts <= since:
                        continue

                    # Determine role: messages from shu are "assistant",
                    # outbound messages are "user"
                    role = "assistant" if sender == "shu" else "user"

                    messages.append({
                        "role": role,
                        "content": entry.get("content", ""),
                        "timestamp": ts,
                        "type": msg_type,
                    })
        except OSError as exc:
            logger.warning("Failed to read %s: %s", INBOX_PATH, exc)
            return []

        # Sort by timestamp ascending, then limit
        messages.sort(key=lambda m: m.get("timestamp", ""))
        return messages[:limit]

    async def check_reachable(self) -> bool:
        """Check if Shu's HTTP endpoint is reachable.

        Performs a lightweight HEAD request with a short timeout.

        Returns:
            True if Shu responds, False otherwise.
        """
        try:
            response = await self._client.head(SHU_URL, timeout=3.0)
            return response.status_code < 500
        except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPError):
            return False
