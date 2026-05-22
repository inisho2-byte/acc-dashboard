"""Claude Code adapter following the AgentAdapter ABC pattern.

This adapter is a thin facade that delegates ALL filesystem I/O to
ClaudeCodeReader. Agent type is 'filesystem' since Claude Code has
no HTTP API — all data comes from reading local files.

Daemon liveness is derived from session updatedAt staleness:
  - active: updatedAt within last 60s
  - idle: updatedAt older than 60s
  - offline: no sessions found
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from server.agents import AgentAdapter
from server.aggregators.claude_code_reader import ClaudeCodeReader
from server.models import AgentError, AgentSession, AgentStatus

logger = logging.getLogger("acc-dashboard.claude_code_adapter")


class ClaudeCodeAdapter(AgentAdapter):
    """AgentAdapter ABC implementation for Claude Code (filesystem-only)."""

    agent_id = "claude-code"
    agent_type = "filesystem"
    display_name = "Claude Code"

    def __init__(self, reader: ClaudeCodeReader) -> None:
        self._reader = reader
        self._last_errors: list[AgentError] = []

    def _record_error(self, message: str, severity: str = "error") -> None:
        self._last_errors.append(
            AgentError(
                id=f"claude-code-{datetime.now(timezone.utc).isoformat()}",
                agent_id=self.agent_id,
                timestamp=datetime.now(timezone.utc),
                message=message,
                severity=severity,
            )
        )

    # ── AgentAdapter Interface ─────────────────────────────────────────────────

    async def health(self) -> AgentStatus:
        """Return health status based on session data availability."""
        health_info = await self._reader.get_health_info()

        if health_info.get("status") == "offline" and "error_message" in health_info:
            return AgentStatus(
                agent_id=self.agent_id,
                agent_type=self.agent_type,
                name=self.display_name,
                status="offline",
                error_message=health_info["error_message"],
            )

        status = health_info.get("status", "offline")
        active = health_info.get("active_sessions", 0)
        total = health_info.get("total_sessions", 0)
        version = health_info.get("version")
        last_activity_str = health_info.get("last_activity")

        last_active = None
        if last_activity_str:
            try:
                last_active = datetime.fromisoformat(last_activity_str)
            except (ValueError, TypeError):
                pass

        return AgentStatus(
            agent_id=self.agent_id,
            agent_type=self.agent_type,
            name=self.display_name,
            status=status,
            model=version,  # Store Claude Code version as "model"
            session_count=total,
            last_active=last_active,
            error_message=None,
        )

    async def recent_sessions(self, limit: int = 10) -> list[AgentSession]:
        """Convert ClaudeSession objects to AgentSession for the unified API."""
        try:
            claude_sessions = await self._reader.list_sessions()
        except Exception as exc:
            self._record_error(str(exc))
            return []

        sessions: list[AgentSession] = []
        for cs in claude_sessions[:limit]:
            sessions.append(
                AgentSession(
                    id=cs.id,
                    agent_id=self.agent_id,
                    title=cs.display_cwd or cs.cwd,
                    preview=f"Claude Code {cs.kind or 'session'} — {cs.version or 'unknown'}",
                    last_active=cs.updated_at or cs.started_at or datetime.now(timezone.utc),
                    status=cs.status,
                    body=f"PID: {cs.pid}, CWD: {cs.display_cwd}, Version: {cs.version}",
                    author="Claude Code",
                )
            )
        return sessions

    async def recent_errors(self, limit: int = 10) -> list[AgentError]:
        """Return the N most recent errors from the in-memory buffer."""
        return list(self._last_errors[-limit:])

    async def list_skills(self) -> list[dict]:
        """Return Claude Code skills (allowlisted frontmatter only)."""
        try:
            return await self._reader.list_skills()
        except Exception as exc:
            self._record_error(str(exc))
            return []