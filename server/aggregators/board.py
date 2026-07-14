"""Task Board persistence layer for the ACC Dashboard.

Uses a standalone SQLite database at ~/.hermes/acc/board.db — independent
from the Hermes kanban system. This is the read-write store for the Tasks tab.

Schema:
  tasks table:
    id          TEXT PRIMARY KEY  — UUID
    title       TEXT NOT NULL
    priority    TEXT NOT NULL DEFAULT 'medium'  — low / medium / high
    status      TEXT NOT NULL DEFAULT 'pending'  — pending / in_progress / done
    notes       TEXT
    created_at  TEXT NOT NULL  — ISO 8601 UTC
    updated_at  TEXT NOT NULL  — ISO 8601 UTC
"""

from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BOARD_DB = Path.home() / ".hermes" / "acc" / "board.db"

_VALID_PRIORITIES = {"low", "medium", "high"}
_VALID_STATUSES = {"pending", "in_progress", "done"}
_STATUS_ORDER = ["pending", "in_progress", "done"]


def _get_conn() -> sqlite3.Connection:
    BOARD_DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(BOARD_DB), check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=3000")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS tasks (
            id          TEXT PRIMARY KEY,
            title       TEXT NOT NULL,
            priority    TEXT NOT NULL DEFAULT 'medium',
            status      TEXT NOT NULL DEFAULT 'pending',
            notes       TEXT,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, updated_at DESC)
    """)
    conn.commit()
    return conn


def list_tasks() -> list[dict[str, Any]]:
    """Return all tasks ordered by status order then created_at."""
    conn = _get_conn()
    try:
        cur = conn.execute(
            "SELECT id, title, priority, status, notes, created_at, updated_at "
            "FROM tasks ORDER BY CASE status "
            "WHEN 'pending' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'done' THEN 2 END, "
            "created_at ASC"
        )
        rows = cur.fetchall()
        return [
            {
                "id": r[0], "title": r[1], "priority": r[2],
                "status": r[3], "notes": r[4],
                "created_at": r[5], "updated_at": r[6],
            }
            for r in rows
        ]
    finally:
        conn.close()


def get_task(task_id: str) -> dict[str, Any] | None:
    """Get a single task by ID."""
    conn = _get_conn()
    try:
        cur = conn.execute(
            "SELECT id, title, priority, status, notes, created_at, updated_at "
            "FROM tasks WHERE id = ?", (task_id,)
        )
        row = cur.fetchone()
        if not row:
            return None
        return {
            "id": row[0], "title": row[1], "priority": row[2],
            "status": row[3], "notes": row[4],
            "created_at": row[5], "updated_at": row[6],
        }
    finally:
        conn.close()


def create_task(title: str, priority: str = "medium", notes: str | None = None) -> dict[str, Any]:
    """Create a new task in 'pending' status. Returns the created task."""
    if priority not in _VALID_PRIORITIES:
        raise ValueError(f"Invalid priority: {priority}")
    task_id = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).isoformat()
    conn = _get_conn()
    try:
        conn.execute(
            "INSERT INTO tasks (id, title, priority, status, notes, created_at, updated_at) "
            "VALUES (?, ?, ?, 'pending', ?, ?, ?)",
            (task_id, title, priority, notes, now, now),
        )
        conn.commit()
    finally:
        conn.close()
    return get_task(task_id)


def move_task(task_id: str, direction: int = 1) -> dict[str, Any] | None:
    """Move a task forward (+1) or backward (-1) in the status order.
    Returns the updated task, or None if task not found or already at boundary."""
    task = get_task(task_id)
    if task is None:
        return None
    current_idx = _STATUS_ORDER.index(task["status"]) if task["status"] in _STATUS_ORDER else 0
    new_idx = current_idx + direction
    if new_idx < 0 or new_idx >= len(_STATUS_ORDER):
        return task  # already at boundary, return unchanged
    new_status = _STATUS_ORDER[new_idx]
    now = datetime.now(timezone.utc).isoformat()
    conn = _get_conn()
    try:
        conn.execute(
            "UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?",
            (new_status, now, task_id),
        )
        conn.commit()
    finally:
        conn.close()
    return get_task(task_id)


def update_task(task_id: str, **kwargs) -> dict[str, Any] | None:
    """Update task fields. Accepted keys: title, priority, notes."""
    task = get_task(task_id)
    if task is None:
        return None
    now = datetime.now(timezone.utc).isoformat()
    sets = []
    vals = []
    for k in ("title", "priority", "notes"):
        if k in kwargs:
            if k == "priority" and kwargs[k] not in _VALID_PRIORITIES:
                raise ValueError(f"Invalid priority: {kwargs[k]}")
            sets.append(f"{k} = ?")
            vals.append(kwargs[k])
    if not sets:
        return task
    sets.append("updated_at = ?")
    vals.append(now)
    vals.append(task_id)
    conn = _get_conn()
    try:
        conn.execute(f"UPDATE tasks SET {', '.join(sets)} WHERE id = ?", vals)
        conn.commit()
    finally:
        conn.close()
    return get_task(task_id)


def delete_task(task_id: str) -> bool:
    """Delete a task. Returns True if deleted, False if not found."""
    conn = _get_conn()
    try:
        cur = conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def clear_all_tasks() -> int:
    """Delete all tasks. Returns count of deleted rows."""
    conn = _get_conn()
    try:
        cur = conn.execute("DELETE FROM tasks")
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()