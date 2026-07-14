"""Cron Dashboard — Execution history, forecast, and per-job success rate.

Reads cron schedule data from Hermes API and execution tracking from usage.db.
Uses croniter to compute next-run forecasts from cron expressions.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from server.db import get_connection

logger = logging.getLogger("acc-dashboard")


class CronDashboard:
    """Aggregate cron execution data with forecast and success rates."""

    def __init__(self) -> None:
        self._ensure_table()

    def _ensure_table(self) -> None:
        """Create cron_executions table if it doesn't exist."""
        try:
            with get_connection() as conn:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS cron_executions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        job_id TEXT NOT NULL,
                        executed_at TEXT NOT NULL,
                        success BOOLEAN NOT NULL DEFAULT 1,
                        error TEXT,
                        detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                conn.execute("""
                    CREATE INDEX IF NOT EXISTS idx_cron_exec_job
                    ON cron_executions(job_id, executed_at DESC)
                """)
                conn.commit()
        except Exception as exc:
            logger.warning("cron_exec_table_init_failed", extra={"error": str(exc)})

    def record_execution(self, job_id: str, success: bool, error: str | None = None) -> None:
        """Record a cron job execution."""
        try:
            with get_connection() as conn:
                conn.execute(
                    "INSERT INTO cron_executions (job_id, executed_at, success, error) VALUES (?, ?, ?, ?)",
                    (job_id, datetime.now(timezone.utc).isoformat(), success, error),
                )
                conn.commit()
        except Exception as exc:
            logger.warning("cron_exec_record_failed", extra={"error": str(exc)})

    def detect_and_record(self, previous_jobs: list[dict], current_jobs: list[dict]) -> None:
        """Detect status changes between two cron job snapshots and record executions.

        When a job transitions from 'running' or has a new last_run timestamp,
        record an execution with success/failure based on last_status.
        """
        prev_map = {j.get("id"): j for j in (previous_jobs or [])}

        for job in current_jobs:
            job_id = job.get("id", "")
            prev = prev_map.get(job_id)

            # Detect new execution: last_run changed
            current_last_run = job.get("last_run")
            prev_last_run = prev.get("last_run") if prev else None

            if current_last_run and current_last_run != prev_last_run:
                # New execution detected
                success = job.get("last_status") != "error"
                error_msg = None if success else job.get("last_status")
                self.record_execution(job_id, success, error_msg)

    def get_recent_executions(self, job_id: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
        """Get recent cron execution records."""
        try:
            with get_connection() as conn:
                if job_id:
                    cursor = conn.execute(
                        "SELECT job_id, executed_at, success, error FROM cron_executions WHERE job_id = ? ORDER BY executed_at DESC LIMIT ?",
                        (job_id, limit),
                    )
                else:
                    cursor = conn.execute(
                        "SELECT job_id, executed_at, success, error FROM cron_executions ORDER BY executed_at DESC LIMIT ?",
                        (limit,),
                    )
                return [
                    {
                        "job_id": row[0],
                        "executed_at": row[1],
                        "success": bool(row[2]),
                        "error": row[3],
                    }
                    for row in cursor.fetchall()
                ]
        except Exception:
            return []

    def get_success_rate(self, job_id: str, days: int = 7) -> float:
        """Compute success rate for a job over last N days."""
        cutoff = (datetime.now(timezone.utc) - __import__("datetime").timedelta(days=days)).isoformat()
        try:
            with get_connection() as conn:
                cursor = conn.execute(
                    "SELECT success, COUNT(*) FROM cron_executions WHERE job_id = ? AND executed_at > ? GROUP BY success",
                    (job_id, cutoff),
                )
                rows = cursor.fetchall()
                total = sum(r[1] for r in rows)
                successes = sum(r[1] for r in rows if r[0])
                return round(successes / total, 3) if total > 0 else 0.0
        except Exception:
            return 0.0

    def get_dashboard(self, current_jobs: list[dict]) -> dict[str, Any]:
        """Build full cron dashboard data.

        Args:
            current_jobs: Current cron job list from Hermes API.

        Returns:
            Dict with jobs list including forecast and success rate.
        """
        dashboard_jobs = []

        for job in current_jobs:
            job_id = job.get("id", "unknown")
            schedule = job.get("schedule", "")

            # Compute next 24h forecast using croniter
            next_runs = self._compute_forecast(schedule, hours=24)

            # Get success rate
            success_rate = self.get_success_rate(job_id)

            # Get recent executions for this job
            recent = self.get_recent_executions(job_id, limit=7)

            dashboard_jobs.append({
                "id": job_id,
                "name": job.get("name", job_id),
                "schedule": schedule,
                "status": job.get("status", "unknown"),
                "next_runs": next_runs[:6],  # Cap at 6 forecast entries
                "recent_executions": recent,
                "success_rate": success_rate,
                "last_run": job.get("last_run"),
                "last_status": job.get("last_status"),
            })

        return {
            "jobs": dashboard_jobs,
            "total": len(dashboard_jobs),
            "computed_at": datetime.now(timezone.utc).isoformat(),
        }

    @staticmethod
    def _compute_forecast(schedule: str, hours: int = 24) -> list[str]:
        """Compute next N hours of run times from a cron expression using croniter.

        Returns list of ISO timestamps for expected run times.
        """
        if not schedule:
            return []

        # Defensive: Hermes API may return schedule as a dict
        if isinstance(schedule, dict):
            schedule = schedule.get("expr") or schedule.get("display") or ""
            if not schedule:
                return []

        try:
            from croniter import croniter
            base = datetime.now(timezone.utc)
            cron = croniter(schedule, base)
            runs = []
            for _ in range(hours):
                next_time = cron.get_next(datetime)
                if next_time > base + __import__("datetime").timedelta(hours=hours):
                    break
                runs.append(next_time.isoformat())
            return runs
        except (ImportError, ValueError, KeyError) as exc:
            logger.debug("croniter_forecast_failed", extra={"schedule": schedule, "error": str(exc)})
            return []