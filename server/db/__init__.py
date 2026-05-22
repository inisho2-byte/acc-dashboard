"""
ACC Dashboard — SQLite Persistence Layer

Database connection factory with WAL mode, busy timeout, and schema management.
All database operations go through this module to ensure consistent configuration.
"""

import sqlite3
import json
from pathlib import Path
from contextlib import contextmanager
from typing import Any

# Database location: ~/.hermes/acc/acc.db
DB_PATH = Path.home() / ".hermes" / "acc" / "acc.db"

# Schema version for migrations
SCHEMA_VERSION = 1


def get_db_path() -> Path:
    """Get the database path, creating parent directories if needed."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return DB_PATH


def init_db() -> sqlite3.Connection:
    """
    Initialize database with WAL mode and create tables if they don't exist.
    
    Returns:
        sqlite3.Connection: Database connection with proper configuration.
    """
    db_path = get_db_path()
    conn = sqlite3.connect(db_path, check_same_thread=False)
    
    # Enable WAL mode for better concurrent read performance
    conn.execute("PRAGMA journal_mode=WAL")
    
    # Set busy timeout to 5 seconds for write contention handling
    conn.execute("PRAGMA busy_timeout=5000")
    
    # Create tables
    conn.execute("""
        CREATE TABLE IF NOT EXISTS daily_snapshots (
            date TEXT NOT NULL,
            metric TEXT NOT NULL,
            value INTEGER NOT NULL,
            metadata TEXT,
            PRIMARY KEY (date, metric)
        )
    """)
    
    conn.execute("""
        CREATE TABLE IF NOT EXISTS skill_usage (
            skill_name TEXT PRIMARY KEY,
            last_used TEXT NOT NULL,
            use_count INTEGER NOT NULL DEFAULT 1
        )
    """)
    
    conn.execute("""
        CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY
        )
    """)
    
    # Create indexes for efficient querying
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_daily_snapshots_metric 
        ON daily_snapshots(metric, date DESC)
    """)
    
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_skill_usage_last_used 
        ON skill_usage(last_used DESC)
    """)
    
    # Record schema version
    conn.execute("""
        INSERT OR REPLACE INTO schema_version (version) VALUES (?)
    """, (SCHEMA_VERSION,))
    
    conn.commit()
    return conn


@contextmanager
def get_connection():
    """
    Get database connection with proper error handling and cleanup.
    
    Usage:
        with get_connection() as conn:
            conn.execute("SELECT ...")
    
    Yields:
        sqlite3.Connection: Configured database connection.
    
    Raises:
        sqlite3.Error: On database errors (caller must handle).
    """
    conn = init_db()
    try:
        yield conn
    except sqlite3.Error as e:
        conn.rollback()
        raise
    finally:
        conn.close()


def record_metric(metric: str, value: int, metadata: dict[str, Any] | None = None) -> None:
    """
    Record a daily snapshot metric.
    
    Args:
        metric: Metric name (e.g., "total_sessions", "error_count").
        value: Integer value to record.
        metadata: Optional JSON-serializable metadata dict.
    """
    from datetime import datetime
    
    today = datetime.now().date().isoformat()
    metadata_json = json.dumps(metadata) if metadata else None
    
    with get_connection() as conn:
        conn.execute("""
            INSERT OR REPLACE INTO daily_snapshots (date, metric, value, metadata)
            VALUES (?, ?, ?, ?)
        """, (today, metric, value, metadata_json))
        conn.commit()


def get_trend(metric: str, days: int = 7) -> list[dict[str, Any]]:
    """
    Get last N days of trend data for a metric.
    
    Args:
        metric: Metric name to query.
        days: Number of days to retrieve (default: 7).
    
    Returns:
        List of dicts with keys: date, value, metadata (or None).
    """
    with get_connection() as conn:
        cursor = conn.execute("""
            SELECT date, value, metadata
            FROM daily_snapshots
            WHERE metric = ?
            ORDER BY date DESC
            LIMIT ?
        """, (metric, days))
        
        return [
            {
                "date": row[0],
                "value": row[1],
                "metadata": json.loads(row[2]) if row[2] else None
            }
            for row in cursor.fetchall()
        ]


def track_skill(skill_name: str) -> None:
    """
    Track skill usage — upsert last_used and increment count.
    
    Args:
        skill_name: Name of the skill to track.
    """
    from datetime import datetime
    
    now = datetime.now().isoformat()
    
    with get_connection() as conn:
        conn.execute("""
            INSERT INTO skill_usage (skill_name, last_used, use_count)
            VALUES (?, ?, 1)
            ON CONFLICT(skill_name) DO UPDATE SET
                last_used = excluded.last_used,
                use_count = skill_usage.use_count + 1
        """, (skill_name, now))
        conn.commit()


def backfill_skill_usage_from_sessions() -> int:
    """Scan Hermes session logs for skill invocations and backfill skill_usage.
    
    Parses ~/.hermes/sessions/*.jsonl for skill_view/skill_manage/skills_list
    tool calls and upserts the skill_usage table with real usage data.
    
    Returns:
        Number of skills updated.
    """
    import json
    from datetime import datetime
    from pathlib import Path

    sessions_dir = Path.home() / ".hermes" / "sessions"
    if not sessions_dir.is_dir():
        return 0

    # Collect: skill_name -> {count, latest_timestamp}
    invocations: dict[str, dict] = {}

    for session_file in sessions_dir.glob("*.jsonl"):
        try:
            with open(session_file, "r", encoding="utf-8") as fh:
                for line in fh:
                    try:
                        entry = json.loads(line.strip())
                    except (json.JSONDecodeError, ValueError):
                        continue

                    # Hermes stores tool calls in tool_calls array
                    tool_calls = entry.get("tool_calls", [])
                    for tc in tool_calls:
                        fn = tc.get("function", {}).get("name", "")
                        if fn in ("skill_view", "skill_manage", "skills_list"):
                            args_str = tc.get("function", {}).get("arguments", "{}")
                            try:
                                args = json.loads(args_str) if isinstance(args_str, str) else args_str
                            except (json.JSONDecodeError, ValueError):
                                args = {}
                            sname = args.get("name", "")
                            if sname:
                                ts = entry.get("timestamp", "")
                                if sname not in invocations:
                                    invocations[sname] = {"count": 0, "latest": ""}
                                invocations[sname]["count"] += 1
                                # Keep the latest timestamp (ISO strings sort correctly)
                                if ts and ts > invocations[sname]["latest"]:
                                    invocations[sname]["latest"] = ts
        except Exception:
            continue

    if not invocations:
        return 0

    # Upsert into skill_usage, keeping the maximum of existing vs new data
    updated = 0
    with get_connection() as conn:
        for sname, data in invocations.items():
            # Get existing row
            existing = conn.execute(
                "SELECT last_used, use_count FROM skill_usage WHERE skill_name = ?",
                (sname,),
            ).fetchone()

            if existing:
                existing_last = existing[0] or ""
                existing_count = existing[1] or 0
                # Keep the later timestamp and higher count
                new_last = max(data["latest"], existing_last) if data["latest"] else existing_last
                new_count = existing_count + data["count"]  # Add discovered invocations on top
                conn.execute(
                    "UPDATE skill_usage SET last_used = ?, use_count = ? WHERE skill_name = ?",
                    (new_last, new_count, sname),
                )
            else:
                conn.execute(
                    "INSERT INTO skill_usage (skill_name, last_used, use_count) VALUES (?, ?, ?)",
                    (sname, data["latest"], data["count"]),
                )
            updated += 1
        conn.commit()

    return updated


def get_all_skill_usage() -> list[dict[str, Any]]:
    """
    Get all skill usage data, ordered by last_used descending.
    
    Returns:
        List of dicts with keys: skill_name, last_used, use_count.
    """
    with get_connection() as conn:
        cursor = conn.execute("""
            SELECT skill_name, last_used, use_count
            FROM skill_usage
            ORDER BY last_used DESC
        """)
        
        return [
            {
                "skill_name": row[0],
                "last_used": row[1],
                "use_count": row[2]
            }
            for row in cursor.fetchall()
        ]


def get_skill_usage(skill_name: str) -> dict[str, Any] | None:
    """
    Get usage data for a specific skill.
    
    Args:
        skill_name: Name of the skill to query.
    
    Returns:
        Dict with keys: skill_name, last_used, use_count; or None if not found.
    """
    with get_connection() as conn:
        cursor = conn.execute("""
            SELECT skill_name, last_used, use_count
            FROM skill_usage
            WHERE skill_name = ?
        """, (skill_name,))
        
        row = cursor.fetchone()
        if row:
            return {
                "skill_name": row[0],
                "last_used": row[1],
                "use_count": row[2]
            }
        return None


def clear_all_data() -> None:
    """
    Clear all data from all tables. Use for testing only.
    """
    with get_connection() as conn:
        conn.execute("DELETE FROM daily_snapshots")
        conn.execute("DELETE FROM skill_usage")
        conn.commit()
