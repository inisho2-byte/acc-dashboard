"""Persistent session and message storage for the chat subsystem.

Uses the existing server.db.get_connection() context manager to store
chat_sessions and chat_messages in the shared ACC SQLite database.
All methods are synchronous (matching the existing db module pattern).
"""

from __future__ import annotations

import uuid
import logging
from datetime import datetime, timezone
from typing import Any

from server.db import get_connection

logger = logging.getLogger("acc-dashboard.chat.session_store")

# ── SQL DDL ──────────────────────────────────────────────────────────────────

_CREATE_SESSIONS_TABLE = """
CREATE TABLE IF NOT EXISTS chat_sessions (
    id          TEXT PRIMARY KEY,
    agent       TEXT NOT NULL,
    model       TEXT NOT NULL DEFAULT '',
    external_id TEXT,
    created_at  TEXT NOT NULL,
    last_active_at TEXT NOT NULL,
    turns       INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1
)
"""

_CREATE_MESSAGES_TABLE = """
CREATE TABLE IF NOT EXISTS chat_messages (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL,
    role        TEXT NOT NULL,
    content     TEXT NOT NULL DEFAULT '',
    tool_name   TEXT,
    tool_input  TEXT,
    tool_output TEXT,
    created_at  TEXT NOT NULL,
    cost_usd    REAL,
    duration_ms INTEGER,
    metadata    TEXT,
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id)
)
"""

_CREATE_IDX_SESSIONS_AGENT = """
CREATE INDEX IF NOT EXISTS idx_chat_sessions_agent
ON chat_sessions(agent, is_active, last_active_at DESC)
"""

_CREATE_IDX_MESSAGES_SESSION = """
CREATE INDEX IF NOT EXISTS idx_chat_messages_session
ON chat_messages(session_id, created_at ASC)
"""


class ChatSessionStore:
    """Synchronous chat session and message persistence layer.

    Creates the chat_sessions and chat_messages tables on first
    instantiation. All dict returns use snake_case keys matching
    column names.
    """

    def __init__(self) -> None:
        self._ensure_tables()

    def _ensure_tables(self) -> None:
        """Create chat_sessions and chat_messages tables + indexes if absent."""
        with get_connection() as conn:
            conn.execute(_CREATE_SESSIONS_TABLE)
            conn.execute(_CREATE_MESSAGES_TABLE)
            conn.execute(_CREATE_IDX_SESSIONS_AGENT)
            conn.execute(_CREATE_IDX_MESSAGES_SESSION)
            conn.commit()
        logger.debug("Chat session tables ensured")

    # ── Session CRUD ──────────────────────────────────────────────────────

    def create_session(self, agent: str, model: str = "") -> dict[str, Any]:
        """Create a new chat session and return it as a dict.

        Args:
            agent: Agent identifier (e.g. "arete", "claude", "shu").
            model: Optional model name for the session.

        Returns:
            Dict with all session columns.
        """
        session_id = uuid.uuid4().hex
        now = datetime.now(timezone.utc).isoformat()
        row = {
            "id": session_id,
            "agent": agent,
            "model": model,
            "external_id": None,
            "created_at": now,
            "last_active_at": now,
            "turns": 0,
            "is_active": 1,
        }
        with get_connection() as conn:
            conn.execute(
                """
                INSERT INTO chat_sessions
                    (id, agent, model, external_id, created_at, last_active_at, turns, is_active)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    row["id"],
                    row["agent"],
                    row["model"],
                    row["external_id"],
                    row["created_at"],
                    row["last_active_at"],
                    row["turns"],
                    row["is_active"],
                ),
            )
            conn.commit()
        logger.info("Created chat session %s for agent=%s", session_id, agent)
        return row

    def get_session(self, session_id: str) -> dict[str, Any] | None:
        """Retrieve a session by ID.

        Args:
            session_id: The session UUID.

        Returns:
            Dict with session columns, or None if not found.
        """
        with get_connection() as conn:
            cursor = conn.execute(
                """
                SELECT id, agent, model, external_id, created_at,
                       last_active_at, turns, is_active
                FROM chat_sessions
                WHERE id = ?
                """,
                (session_id,),
            )
            row = cursor.fetchone()
        if row is None:
            return None
        return {
            "id": row[0],
            "agent": row[1],
            "model": row[2],
            "external_id": row[3],
            "created_at": row[4],
            "last_active_at": row[5],
            "turns": row[6],
            "is_active": row[7],
        }

    def get_active_session(self, agent: str) -> dict[str, Any] | None:
        """Get the most recent active session for a given agent.

        Args:
            agent: Agent identifier to filter by.

        Returns:
            Dict with session columns, or None if no active session.
        """
        with get_connection() as conn:
            cursor = conn.execute(
                """
                SELECT id, agent, model, external_id, created_at,
                       last_active_at, turns, is_active
                FROM chat_sessions
                WHERE agent = ? AND is_active = 1
                ORDER BY last_active_at DESC
                LIMIT 1
                """,
                (agent,),
            )
            row = cursor.fetchone()
        if row is None:
            return None
        return {
            "id": row[0],
            "agent": row[1],
            "model": row[2],
            "external_id": row[3],
            "created_at": row[4],
            "last_active_at": row[5],
            "turns": row[6],
            "is_active": row[7],
        }

    def update_session(self, session_id: str, **fields: Any) -> None:
        """Update one or more columns on a chat session.

        Only whitelisted column names are accepted to prevent injection.

        Args:
            session_id: The session UUID.
            **fields: Column=value pairs to update.
        """
        allowed = {
            "model", "external_id", "last_active_at", "turns", "is_active",
        }
        updates = {k: v for k, v in fields.items() if k in allowed}
        if not updates:
            return
        # Always bump last_active_at when updating
        if "last_active_at" not in updates:
            updates["last_active_at"] = datetime.now(timezone.utc).isoformat()

        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [session_id]

        with get_connection() as conn:
            conn.execute(
                f"UPDATE chat_sessions SET {set_clause} WHERE id = ?",
                values,
            )
            conn.commit()

    def deactivate_session(self, session_id: str) -> None:
        """Mark a session as inactive (is_active = 0).

        Args:
            session_id: The session UUID.
        """
        self.update_session(session_id, is_active=0)
        logger.info("Deactivated chat session %s", session_id)

    # ── Message CRUD ──────────────────────────────────────────────────────

    def add_message(
        self,
        session_id: str,
        role: str,
        content: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Add a message to a chat session and return it as a dict.

        Args:
            session_id: The session this message belongs to.
            role: Message role ("user", "assistant", "system", "tool").
            content: Message text content.
            **kwargs: Optional fields — tool_name, tool_input, tool_output,
                      cost_usd, duration_ms, metadata.

        Returns:
            Dict with all message columns.
        """
        msg_id = uuid.uuid4().hex
        now = datetime.now(timezone.utc).isoformat()
        row: dict[str, Any] = {
            "id": msg_id,
            "session_id": session_id,
            "role": role,
            "content": content,
            "tool_name": kwargs.get("tool_name"),
            "tool_input": kwargs.get("tool_input"),
            "tool_output": kwargs.get("tool_output"),
            "created_at": now,
            "cost_usd": kwargs.get("cost_usd"),
            "duration_ms": kwargs.get("duration_ms"),
            "metadata": kwargs.get("metadata"),
        }
        with get_connection() as conn:
            conn.execute(
                """
                INSERT INTO chat_messages
                    (id, session_id, role, content, tool_name, tool_input,
                     tool_output, created_at, cost_usd, duration_ms, metadata)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    row["id"],
                    row["session_id"],
                    row["role"],
                    row["content"],
                    row["tool_name"],
                    row["tool_input"],
                    row["tool_output"],
                    row["created_at"],
                    row["cost_usd"],
                    row["duration_ms"],
                    row["metadata"],
                ),
            )
            conn.commit()
        return row

    def get_messages(
        self,
        session_id: str,
        limit: int = 100,
        before: str | None = None,
    ) -> list[dict[str, Any]]:
        """Retrieve messages for a session ordered chronologically.

        Args:
            session_id: The session to query.
            limit: Maximum messages to return (default 100).
            before: If provided, only return messages created before this
                    ISO timestamp (for cursor-based pagination).

        Returns:
            List of message dicts ordered by created_at ASC.
        """
        query = """
            SELECT id, session_id, role, content, tool_name, tool_input,
                   tool_output, created_at, cost_usd, duration_ms, metadata
            FROM chat_messages
            WHERE session_id = ?
        """
        params: list[Any] = [session_id]

        if before is not None:
            query += " AND created_at < ?"
            params.append(before)

        query += " ORDER BY created_at ASC LIMIT ?"
        params.append(limit)

        with get_connection() as conn:
            cursor = conn.execute(query, params)
            rows = cursor.fetchall()

        return [
            {
                "id": r[0],
                "session_id": r[1],
                "role": r[2],
                "content": r[3],
                "tool_name": r[4],
                "tool_input": r[5],
                "tool_output": r[6],
                "created_at": r[7],
                "cost_usd": r[8],
                "duration_ms": r[9],
                "metadata": r[10],
            }
            for r in rows
        ]
