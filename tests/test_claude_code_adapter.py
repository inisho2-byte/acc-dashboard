"""Unit tests for ClaudeCodeAdapter — AgentAdapter implementation for Claude Code.

Coverage: health(), recent_sessions(), recent_errors() non-draining,
list_skills() delegation, error recording.
"""

from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from server.agents.claude_code_adapter import ClaudeCodeAdapter
from server.aggregators.claude_code_reader import ClaudeCodeReader
from server.models import AgentError, AgentSession, ClaudeSession


# ── Fixtures ────────────────────────────────────────────────────────────────


def _make_session(
    session_id: str = "sess-001",
    status: str = "idle",
    cwd: str = "/mnt/c/Users/test/project",
    display_cwd: str = "C:\\Users\\test\\project",
    version: str = "1.0.0",
    kind: str = "cli",
    pid: int = 12345,
    updated_at: datetime | None = None,
    started_at: datetime | None = None,
) -> ClaudeSession:
    return ClaudeSession(
        id=session_id,
        pid=pid,
        cwd=cwd,
        display_cwd=display_cwd,
        version=version,
        kind=kind,
        status=status,
        started_at=started_at,
        updated_at=updated_at,
        last_prompt=None,
        task_count=0,
        has_plan=False,
    )


@pytest.fixture
def mock_reader():
    reader = AsyncMock(spec=ClaudeCodeReader)
    return reader


@pytest.fixture
def adapter(mock_reader):
    return ClaudeCodeAdapter(reader=mock_reader)


# ── health() ────────────────────────────────────────────────────────────────


class TestHealth:
    @pytest.mark.asyncio
    async def test_online_with_sessions(self, adapter, mock_reader):
        mock_reader.get_health_info.return_value = {
            "status": "online",
            "active_sessions": 2,
            "total_sessions": 5,
            "version": "1.0.0",
            "last_activity": "2026-05-21T12:00:00+00:00",
        }
        result = await adapter.health()
        assert result.agent_id == "claude-code"
        assert result.agent_type == "filesystem"
        assert result.name == "Claude Code"
        assert result.status == "online"
        assert result.session_count == 5
        assert result.model == "1.0.0"

    @pytest.mark.asyncio
    async def test_offline_with_error_message(self, adapter, mock_reader):
        mock_reader.get_health_info.return_value = {
            "status": "offline",
            "error_message": "Claude Code data directory not found",
        }
        result = await adapter.health()
        assert result.status == "offline"
        assert result.error_message == "Claude Code data directory not found"

    @pytest.mark.asyncio
    async def test_idle_status(self, adapter, mock_reader):
        mock_reader.get_health_info.return_value = {
            "status": "online",
            "active_sessions": 0,
            "total_sessions": 3,
            "version": None,
            "last_activity": None,
        }
        result = await adapter.health()
        assert result.session_count == 3
        assert result.model is None
        assert result.last_active is None


# ── recent_sessions() ───────────────────────────────────────────────────────


class TestRecentSessions:
    @pytest.mark.asyncio
    async def test_returns_sessions(self, adapter, mock_reader):
        sessions = [
            _make_session("sess-1", status="active"),
            _make_session("sess-2", status="idle"),
        ]
        mock_reader.list_sessions.return_value = sessions

        result = await adapter.recent_sessions(limit=10)
        assert len(result) == 2
        assert result[0].id == "sess-1"
        assert result[0].agent_id == "claude-code"

    @pytest.mark.asyncio
    async def test_respects_limit(self, adapter, mock_reader):
        sessions = [_make_session(f"s-{i}") for i in range(5)]
        mock_reader.list_sessions.return_value = sessions

        result = await adapter.recent_sessions(limit=3)
        assert len(result) == 3

    @pytest.mark.asyncio
    async def test_returns_empty_on_exception(self, adapter, mock_reader):
        mock_reader.list_sessions.side_effect = Exception("read error")
        result = await adapter.recent_sessions()
        assert result == []

    @pytest.mark.asyncio
    async def test_records_error_on_exception(self, adapter, mock_reader):
        mock_reader.list_sessions.side_effect = Exception("read error")
        await adapter.recent_sessions()
        errors = await adapter.recent_errors()
        assert len(errors) == 1
        assert "read error" in errors[0].message


# ── recent_errors() non-draining ─────────────────────────────────────────────


class TestRecentErrorsNonDraining:
    @pytest.mark.asyncio
    async def test_errors_persist_across_calls(self, adapter, mock_reader):
        """Verify recent_errors does NOT drain the buffer (unlike the old Hermes bug)."""
        mock_reader.list_sessions.side_effect = Exception("err")
        await adapter.recent_sessions()
        await adapter.recent_sessions()

        # Should have 2 errors
        errors1 = await adapter.recent_errors(limit=10)
        assert len(errors1) == 2

        # Calling again should still return the same errors (non-draining)
        errors2 = await adapter.recent_errors(limit=10)
        assert len(errors2) == 2

    @pytest.mark.asyncio
    async def test_respects_limit(self, adapter, mock_reader):
        for i in range(5):
            mock_reader.list_sessions.side_effect = Exception(f"err-{i}")
            await adapter.recent_sessions()

        errors = await adapter.recent_errors(limit=3)
        assert len(errors) == 3
        # Should return the most recent errors
        assert errors[0].message == "err-2"
        assert errors[2].message == "err-4"


# ── list_skills() ────────────────────────────────────────────────────────────


class TestListSkills:
    @pytest.mark.asyncio
    async def test_delegates_to_reader(self, adapter, mock_reader):
        expected = [{"name": "skill-1", "description": "Test"}]
        mock_reader.list_skills.return_value = expected

        result = await adapter.list_skills()
        assert result == expected
        mock_reader.list_skills.assert_called_once()

    @pytest.mark.asyncio
    async def test_returns_empty_on_exception(self, adapter, mock_reader):
        mock_reader.list_skills.side_effect = Exception("fail")
        result = await adapter.list_skills()
        assert result == []

    @pytest.mark.asyncio
    async def test_records_error_on_exception(self, adapter, mock_reader):
        mock_reader.list_skills.side_effect = Exception("skills-fail")
        await adapter.list_skills()
        errors = await adapter.recent_errors()
        assert any("skills-fail" in e.message for e in errors)


# ── ABC compliance ──────────────────────────────────────────────────────────


class TestABCCompliance:
    def test_implements_required_properties(self, adapter):
        assert adapter.agent_id == "claude-code"
        assert adapter.agent_type == "filesystem"
        assert adapter.display_name == "Claude Code"

    def test_is_subclass_of_agent_adapter(self):
        from server.agents import AgentAdapter

        assert issubclass(ClaudeCodeAdapter, AgentAdapter)