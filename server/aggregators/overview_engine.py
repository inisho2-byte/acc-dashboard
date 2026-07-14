"""VPS and Overview data aggregation for the ACC Dashboard Overview tab.

Provides:
  - CPU / RAM / Disk real-time metrics from /proc filesystem
  - DB sizes from filesystem stat
  - Activity by day from Hermes session logs
  - Agent response counts from agent-logs.db
  - Gateway uptime from Hermes API
  - Kanban counts from Hermes cron endpoint
"""

from __future__ import annotations

import os
import sqlite3
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger("acc-dashboard.overview")

HERMES_HOME = Path.home() / ".hermes"
SESSIONS_DIR = HERMES_HOME / "sessions"
AGENT_LOGS_DB = HERMES_HOME / "agent-logs.db"
ACC_DB = HERMES_HOME / "acc" / "acc.db"
HERMES_DB = HERMES_HOME / "hermes.db"


def _read_proc_stat() -> tuple[int, int]:
    """Read total and idle CPU ticks from /proc/stat."""
    try:
        with open("/proc/stat") as f:
            fields = f.readline().split()
        idle = int(fields[4])
        total = sum(int(x) for x in fields[1:])
        return idle, total
    except Exception:
        return 0, 1


def _read_proc_meminfo() -> dict[str, int]:
    """Read memory info from /proc/meminfo. Values in MB."""
    info: dict[str, int] = {}
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                parts = line.split()
                key = parts[0].rstrip(":")
                val = int(parts[1])  # in kB
                info[key] = val // 1024  # convert to MB
    except Exception:
        pass
    return info


def _read_disk_usage() -> dict[str, float]:
    """Read disk usage via os.statvfs. Returns used_pct, used_gb, total_gb."""
    try:
        stat = os.statvfs("/")
        total = stat.f_blocks * stat.f_frsize / (1024 ** 3)
        free = stat.f_bavail * stat.f_frsize / (1024 ** 3)
        used = total - free
        pct = round(used * 100 / max(total, 1), 1)
        return {"disk_pct": pct, "disk_used_gb": round(used, 1), "disk_total_gb": round(total, 1)}
    except Exception:
        return {"disk_pct": 0, "disk_used_gb": 0, "disk_total_gb": 0}


def _db_size_mb(path: Path) -> float:
    """Get file size in MB."""
    try:
        return round(os.path.getsize(path) / (1024 * 1024), 2) if path.is_file() else 0.0
    except Exception:
        return 0.0


async def get_vps_health() -> dict[str, Any]:
    """Collect real-time VPS health metrics."""
    import asyncio

    # CPU — we do two reads 0.5s apart for a delta percentage
    idle1, total1 = _read_proc_stat()
    await asyncio.sleep(0.5)
    idle2, total2 = _read_proc_stat()

    d_idle = idle2 - idle1
    d_total = total2 - total1
    cpu_pct = round((1 - d_idle / max(d_total, 1)) * 100, 1) if d_total > 0 else 0.0

    # RAM
    mem = _read_proc_meminfo()
    mem_total = mem.get("MemTotal", 0)
    mem_available = mem.get("MemAvailable", 0)
    mem_used = mem_total - mem_available
    mem_pct = round(mem_used * 100 / max(mem_total, 1), 1)

    # Disk
    disk = _read_disk_usage()

    # DB sizes
    db_total = (
        _db_size_mb(ACC_DB)
        + _db_size_mb(HERMES_DB)
        + _db_size_mb(AGENT_LOGS_DB)
    )

    return {
        "cpu_pct": cpu_pct,
        "mem_pct": mem_pct,
        "mem_used_mb": mem_used,
        "mem_total_mb": mem_total,
        **disk,
        "db_size_mb": db_total,
    }


def get_activity_by_day(days: int = 7) -> list[dict[str, Any]]:
    """Count Hermes sessions per day for the last N days."""
    counts: dict[str, int] = {}
    now = datetime.now(timezone.utc)

    # Initialize last N days with 0
    for i in range(days):
        d = (now - timedelta(days=i)).strftime("%Y-%m-%d")
        counts[d] = 0

    if not SESSIONS_DIR.is_dir():
        return [{"date": d, "total": c} for d, c in sorted(counts.items())]

    # Scan session files
    for sf in SESSIONS_DIR.glob("*.jsonl"):
        try:
            mtime = sf.stat().st_mtime
            dt = datetime.fromtimestamp(mtime, tz=timezone.utc)
            day = dt.strftime("%Y-%m-%d")
            if day in counts:
                counts[day] += 1
        except Exception:
            continue

    return [{"date": d, "total": counts[d]} for d in sorted(counts.keys())]


def get_agent_response_counts() -> dict[str, int]:
    """Get response counts per agent from agent-logs.db."""
    counts: dict[str, int] = {}
    if not AGENT_LOGS_DB.is_file():
        return counts

    try:
        conn = sqlite3.connect(str(AGENT_LOGS_DB))
        cur = conn.cursor()
        cur.execute(
            "SELECT agent_name, COUNT(*) FROM agent_logs WHERE status = 'completed' GROUP BY agent_name"
        )
        for row in cur.fetchall():
            counts[row[0]] = row[1]
        conn.close()
    except Exception as exc:
        logger.debug(f"agent_log_query_failed: {exc}")

    return counts


def get_recent_activity(limit: int = 20) -> list[dict[str, Any]]:
    """Get recent activity entries from agent-logs.db."""
    if not AGENT_LOGS_DB.is_file():
        return []

    try:
        conn = sqlite3.connect(str(AGENT_LOGS_DB))
        cur = conn.cursor()
        cur.execute(
            "SELECT agent_name, task_description, status, created_at FROM agent_logs ORDER BY created_at DESC LIMIT ?",
            (limit,),
        )
        rows = cur.fetchall()
        conn.close()

        results = []
        for row in rows:
            results.append({
                "agent": row[0],
                "task": row[1][:120] if row[1] else "",
                "status": row[2],
                "timestamp": row[3],
            })
        return results
    except Exception as exc:
        logger.debug(f"recent_activity_query_failed: {exc}")
        return []


def get_session_totals() -> dict[str, Any]:
    """Get total session and message counts from Hermes sessions."""
    total_sessions = 0
    if SESSIONS_DIR.is_dir():
        total_sessions = len(list(SESSIONS_DIR.glob("*.jsonl")))

    return {
        "count": total_sessions,
    }


async def get_gateway_info(hermes_url: str = "http://localhost:8642") -> dict[str, Any]:
    """Get Hermes gateway uptime and status."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            # Health check
            resp = await client.get(f"{hermes_url}/health")
            if resp.is_success:
                return {"uptime_seconds": None, "status": "online"}
            return {"uptime_seconds": None, "status": "offline"}
    except Exception:
        return {"uptime_seconds": None, "status": "offline"}