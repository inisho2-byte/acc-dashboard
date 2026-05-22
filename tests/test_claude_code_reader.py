"""Unit tests for ClaudeCodeReader — filesystem reader for Claude Code data.

Coverage: normalize_windows_path, safe_claude_path sandboxing,
get_health_info with no data dir, list_sessions parsing,
list_skills frontmatter extraction.
"""

from __future__ import annotations

import json
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from server.aggregators.claude_code_reader import (
    ClaudeCodeReader,
    normalize_windows_path,
    safe_claude_path,
    DENIED_SUBPATHS,
    DENIED_FILES,
)


# ── normalize_windows_path ───────────────────────────────────────────────────


class TestNormalizeWindowsPath:
    def test_empty_string(self):
        assert normalize_windows_path("") == ""

    def test_unix_path_unchanged(self):
        assert normalize_windows_path("/home/user/project") == "/home/user/project"

    def test_windows_drive_to_wsl(self):
        assert normalize_windows_path("C:\\Users\\Iniolu") == "/mnt/c/Users/Iniolu"

    def test_windows_drive_lowercase(self):
        assert normalize_windows_path("d:\\projects") == "/mnt/d/projects"

    def test_mixed_slashes(self):
        assert normalize_windows_path("C:/Users/Iniolu") == "/mnt/c/Users/Iniolu"

    def test_already_wsl_path(self):
        assert normalize_windows_path("/mnt/c/Users/Iniolu") == "/mnt/c/Users/Iniolu"

    def test_unc_path(self):
        result = normalize_windows_path("\\\\server\\share\\path")
        assert "server" in result


# ── safe_claude_path ────────────────────────────────────────────────────────


class TestSafeClaudePath:
    def test_allows_simple_path(self, tmp_path):
        result = safe_claude_path("sessions/123.json", tmp_path)
        assert result is not None
        assert str(result).startswith(str(tmp_path))

    def test_blocks_traversal(self, tmp_path):
        assert safe_claude_path("../../etc/passwd", tmp_path) is None

    def test_blocks_backslash(self, tmp_path):
        assert safe_claude_path("sessions\\123.json", tmp_path) is None

    def test_blocks_denied_subpath(self, tmp_path):
        for denied in DENIED_SUBPATHS:
            assert safe_claude_path(f"{denied}/data", tmp_path) is None

    def test_blocks_denied_file(self, tmp_path):
        for denied in DENIED_FILES:
            assert safe_claude_path(f"dir/{denied}", tmp_path) is None

    def test_allows_content_path(self, tmp_path):
        result = safe_claude_path("skills/my-skill/SKILL.md", tmp_path)
        assert result is not None

    def test_allows_plans_path(self, tmp_path):
        result = safe_claude_path("plans/my-plan.md", tmp_path)
        assert result is not None


# ── get_health_info with no data dir ─────────────────────────────────────────


class TestHealthNoDataDir:
    @pytest.mark.asyncio
    async def test_offline_when_empty_dir(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            reader = ClaudeCodeReader(data_dir=tmpdir)
            health = await reader.get_health_info()
            assert health["status"] == "offline"
            assert health["total_sessions"] == 0

    @pytest.mark.asyncio
    async def test_discover_falls_back_to_home_claude(self):
        """When given an invalid path, _discover_data_dir falls back to ~/.claude."""
        reader = ClaudeCodeReader(data_dir="/nonexistent/path/that/does/not/exist")
        d = reader.data_dir
        # Either None (no ~/.claude found) or a valid path
        if d is not None:
            assert ".claude" in str(d)

    @pytest.mark.asyncio
    async def test_online_with_sessions(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            sessions_dir = Path(tmpdir) / "sessions"
            sessions_dir.mkdir()
            now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
            session_data = {
                "sessionId": "live-sess",
                "updatedAt": now_ms,
            }
            (sessions_dir / "live.json").write_text(json.dumps(session_data))

            reader = ClaudeCodeReader(data_dir=tmpdir)
            health = await reader.get_health_info()
            assert health["status"] == "online"
            assert health["total_sessions"] == 1
            assert health["active_sessions"] == 1


# ── list_sessions parsing ───────────────────────────────────────────────────


class TestListSessions:
    @pytest.mark.asyncio
    async def test_empty_sessions_dir(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            sessions_dir = Path(tmpdir) / "sessions"
            sessions_dir.mkdir()
            reader = ClaudeCodeReader(data_dir=tmpdir)
            sessions = await reader.list_sessions()
            assert sessions == []

    @pytest.mark.asyncio
    async def test_parses_session_json(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            sessions_dir = Path(tmpdir) / "sessions"
            sessions_dir.mkdir()

            session_data = {
                "sessionId": "sess-001",
                "pid": 12345,
                "cwd": "C:\\Users\\Iniolu\\project",
                "version": "1.0.0",
                "kind": "cli",
                "updatedAt": 1700000000000,
                "startedAt": 1699999999000,
            }
            (sessions_dir / "12345.json").write_text(json.dumps(session_data))

            reader = ClaudeCodeReader(data_dir=tmpdir)
            sessions = await reader.list_sessions()
            assert len(sessions) == 1
            s = sessions[0]
            assert s.id == "sess-001"
            assert s.pid == 12345
            assert s.cwd == "/mnt/c/Users/Iniolu/project"
            assert s.version == "1.0.0"
            assert s.kind == "cli"

    @pytest.mark.asyncio
    async def test_skips_invalid_json(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            sessions_dir = Path(tmpdir) / "sessions"
            sessions_dir.mkdir()
            (sessions_dir / "bad.json").write_text("not json{")

            reader = ClaudeCodeReader(data_dir=tmpdir)
            sessions = await reader.list_sessions()
            assert sessions == []

    @pytest.mark.asyncio
    async def test_skips_non_json_files(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            sessions_dir = Path(tmpdir) / "sessions"
            sessions_dir.mkdir()
            (sessions_dir / "notes.txt").write_text("ignore me")

            reader = ClaudeCodeReader(data_dir=tmpdir)
            sessions = await reader.list_sessions()
            assert sessions == []

    @pytest.mark.asyncio
    async def test_session_status_active(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            sessions_dir = Path(tmpdir) / "sessions"
            sessions_dir.mkdir()

            now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
            session_data = {
                "sessionId": "active-sess",
                "updatedAt": now_ms,
            }
            (sessions_dir / "active.json").write_text(json.dumps(session_data))

            reader = ClaudeCodeReader(data_dir=tmpdir)
            sessions = await reader.list_sessions()
            assert sessions[0].status == "active"

    @pytest.mark.asyncio
    async def test_session_status_idle(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            sessions_dir = Path(tmpdir) / "sessions"
            sessions_dir.mkdir()

            old_ms = int(datetime(2020, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
            session_data = {
                "sessionId": "idle-sess",
                "updatedAt": old_ms,
            }
            (sessions_dir / "idle.json").write_text(json.dumps(session_data))

            reader = ClaudeCodeReader(data_dir=tmpdir)
            sessions = await reader.list_sessions()
            assert sessions[0].status == "idle"


# ── list_skills frontmatter extraction ───────────────────────────────────────


class TestListSkills:
    @pytest.mark.asyncio
    async def test_no_skills_dir(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            reader = ClaudeCodeReader(data_dir=tmpdir)
            skills = await reader.list_skills()
            assert skills == []

    @pytest.mark.asyncio
    async def test_parses_skill_with_frontmatter(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            skills_dir = Path(tmpdir) / "skills"
            skill_dir = skills_dir / "deep-reasoning"
            skill_dir.mkdir(parents=True)

            skill_content = """---
name: deep-reasoning
description: Universal engineering methodology
tags: [reasoning, analysis]
allowed-tools: [Bash, Read]
---

# Deep Reasoning Skill
Body content here.
"""
            (skill_dir / "SKILL.md").write_text(skill_content)

            reader = ClaudeCodeReader(data_dir=tmpdir)
            skills = await reader.list_skills()
            assert len(skills) == 1
            s = skills[0]
            assert s["name"] == "deep-reasoning"
            assert s["description"] == "Universal engineering methodology"
            assert "tags" in s

    @pytest.mark.asyncio
    async def test_skill_without_frontmatter(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            skills_dir = Path(tmpdir) / "skills"
            skill_dir = skills_dir / "simple-skill"
            skill_dir.mkdir(parents=True)
            (skill_dir / "SKILL.md").write_text("# Just a heading\nNo frontmatter here.")

            reader = ClaudeCodeReader(data_dir=tmpdir)
            skills = await reader.list_skills()
            assert len(skills) == 1
            assert skills[0]["name"] == "simple-skill"
            assert skills[0]["description"] == ""

    @pytest.mark.asyncio
    async def test_skips_skill_dir_without_skill_md(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            skills_dir = Path(tmpdir) / "skills"
            empty_dir = skills_dir / "no-skill-file"
            empty_dir.mkdir(parents=True)

            reader = ClaudeCodeReader(data_dir=tmpdir)
            skills = await reader.list_skills()
            assert skills == []

    @pytest.mark.asyncio
    async def test_multiple_skills(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            skills_dir = Path(tmpdir) / "skills"

            for name in ["skill-a", "skill-b"]:
                d = skills_dir / name
                d.mkdir(parents=True)
                (d / "SKILL.md").write_text(f"---\nname: {name}\ndescription: Test\n---\n")

            reader = ClaudeCodeReader(data_dir=tmpdir)
            skills = await reader.list_skills()
            assert len(skills) == 2