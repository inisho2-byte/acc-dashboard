"""
Unit tests for HermesAdapter — HTTP-based agent adapter with circuit breakers.

Coverage: health (online/offline), sessions parsing, skills parsing,
circuit breaker open/closed, retry backoff, error recording.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from server.agents.hermes_adapter import HermesAdapter
from server.models import AgentOfflineError, ConnectionError, ParseError
from server.utils.circuit_breaker import CircuitOpenError


# ── Helpers ────────────────────────────────────────────────────────────────


def _make_resp(status: int = 200, json_data: dict | list | None = None) -> MagicMock:
    """Create a mock httpx.Response with the given status and json payload."""
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status
    resp.is_error = status >= 400
    resp.is_success = status < 400
    resp.json.return_value = json_data or {}
    resp.headers = {}
    if status < 400:
        resp.raise_for_status.return_value = None
    else:
        resp.raise_for_status.side_effect = httpx.HTTPStatusError(
            f"HTTP {status}", request=MagicMock(), response=resp
        )
    return resp


def _make_client(resp: MagicMock | None = None) -> AsyncMock:
    """Create an AsyncMock client with the given response as default."""
    client = AsyncMock(spec=httpx.AsyncClient)
    client.get = AsyncMock(return_value=resp or _make_resp())
    client.post = AsyncMock(return_value=resp or _make_resp())
    return client


async def _noop_cb(name: str = "test_cb"):
    """Return a no-op circuit breaker that passes through the wrapped function."""
    cb = AsyncMock(spec=["call", "state"])
    cb.state = MagicMock()
    cb.state.value = "closed"

    async def _passthrough(fn):
        if asyncio.iscoroutinefunction(fn):
            return await fn()
        return fn()

    cb.call = _passthrough
    return cb


# ── Health Tests ──────────────────────────────────────────────────────────


class TestHermesHealth:
    """Tests for HermesAdapter.health()."""

    @pytest.mark.asyncio
    async def test_returns_online_status(self):
        """Health endpoint returning status='ok' should produce online AgentStatus."""
        resp = _make_resp(json_data={
            "status": "ok",
            "model": "deepseek/deepseek-v4-flash",
            "session_count": 3,
            "uptime_seconds": 3600,
        })
        adapter = HermesAdapter()
        adapter._client = _make_client(resp)

        status = await adapter.health()

        assert status.status == "online"
        assert status.agent_id == "arete"
        assert status.agent_type == "hermes"
        assert status.name == "ARETE"
        assert status.model == "deepseek/deepseek-v4-flash"
        assert status.session_count == 3
        assert status.uptime_seconds == 3600
        assert status.last_active is not None

    @pytest.mark.asyncio
    async def test_returns_online_via_online_field(self):
        """Fallback: 'online' field true should also produce online status."""
        resp = _make_resp(json_data={"online": True, "model": "hermes-v3"})
        adapter = HermesAdapter()
        adapter._client = _make_client(resp)

        status = await adapter.health()
        assert status.status == "online"

    @pytest.mark.asyncio
    async def test_returns_offline_when_not_ok(self):
        """When status is not 'ok' and online is False, status should be offline."""
        resp = _make_resp(json_data={"status": "error", "online": False})
        adapter = HermesAdapter()
        adapter._client = _make_client(resp)

        status = await adapter.health()
        assert status.status == "offline"
        assert status.last_active is None

    @pytest.mark.asyncio
    async def test_raises_on_http_500(self):
        """HTTP 500 from health endpoint should raise AgentOfflineError."""
        resp = _make_resp(status=500)
        adapter = HermesAdapter()
        adapter._client = _make_client(resp)

        with pytest.raises(AgentOfflineError, match="unavailable"):
            await adapter.health()

    @pytest.mark.asyncio
    async def test_circuit_breaker_opens_after_3_failures(self):
        """After 3 failures, circuit breaker opens and rejects calls."""
        resp = _make_resp(status=500)
        adapter = HermesAdapter()
        adapter._client = _make_client(resp)

        # Exhaust failure threshold (3)
        for _ in range(3):
            with pytest.raises(AgentOfflineError):
                await adapter.health()

        # Circuit should be open — call rejected immediately
        with pytest.raises(CircuitOpenError, match="OPEN"):
            await adapter.health()

    @pytest.mark.asyncio
    async def test_circuit_breaker_closed_after_success(self):
        """A successful call should keep/cause circuit breaker closed."""
        resp = _make_resp(json_data={"status": "ok"})
        adapter = HermesAdapter()
        adapter._client = _make_client(resp)

        status = await adapter.health()
        assert status.status == "online"
        assert adapter._cb_health.state.value == "closed"

    @pytest.mark.asyncio
    async def test_raises_on_connect_error(self):
        """ConnectError should raise ConnectionError after retries."""
        client = _make_client()
        client.get.side_effect = [
            httpx.ConnectError("conn refused"),
            httpx.ConnectError("conn refused"),
            httpx.ConnectError("conn refused"),
        ]
        adapter = HermesAdapter()
        adapter._client = client

        with pytest.raises(AgentOfflineError, match="unreachable after retries"):
            await adapter.health()

    @pytest.mark.asyncio
    async def test_raises_on_timeout_exhausted(self):
        """Timeout after all retries should raise AgentOfflineError (wrapped by health)."""
        client = _make_client()
        client.get.side_effect = [
            httpx.TimeoutException("timeout"),
            httpx.TimeoutException("timeout"),
            httpx.TimeoutException("timeout"),
        ]
        adapter = HermesAdapter()
        adapter._client = client

        with pytest.raises(AgentOfflineError, match="timeout after retries"):
            await adapter.health()

    @pytest.mark.asyncio
    async def test_retry_then_succeeds(self):
        """After transient timeouts, retry should succeed on third attempt."""
        success_resp = _make_resp(json_data={"status": "ok"})
        client = _make_client()
        client.get.side_effect = [
            httpx.TimeoutException("timeout 1"),
            httpx.TimeoutException("timeout 2"),
            success_resp,
        ]
        adapter = HermesAdapter()
        adapter._client = client

        status = await adapter.health()
        assert status.status == "online"
        assert client.get.call_count == 3

    @pytest.mark.asyncio
    async def test_raises_on_invalid_json(self):
        """Non-JSON response should raise AgentOfflineError (wrapped by health)."""
        resp = _make_resp()
        resp.json.side_effect = ValueError("Expecting value")
        adapter = HermesAdapter()
        adapter._client = _make_client(resp)

        with pytest.raises(AgentOfflineError, match="Invalid JSON"):
            await adapter.health()


# ── Sessions Tests ──────────────────────────────────────────────────────────


class TestHermesSessions:
    """Tests for HermesAdapter.recent_sessions() — reads from filesystem."""

    @pytest.fixture
    def sessions_dir(self, tmp_path: Path) -> Path:
        """Create a temp directory with sample session files."""
        sd = tmp_path / "sessions"
        sd.mkdir()
        files = {
            "20260520_120000.jsonl": json.dumps({"content": "Hello World", "timestamp": "20260520_120000"}),
            "20260520_110000.jsonl": json.dumps({"content": "Second chat", "timestamp": "20260520_110000"}),
        }
        for name, content in files.items():
            (sd / name).write_text(content + "\n", encoding="utf-8")
        return sd

    @pytest.mark.asyncio
    async def test_parses_sessions_from_list(self, sessions_dir: Path):
        """Sessions should be parsed from filesystem jsonl files."""
        import json
        from server.agents.hermes_adapter import SESSIONS_DIR, HermesAdapter

        adapter = HermesAdapter()
        with patch.object(adapter, "_cb_sessions", new=await _noop_cb("cb_ses")):
            with patch("server.agents.hermes_adapter.SESSIONS_DIR", sessions_dir):
                sessions = await adapter.recent_sessions(limit=10)

        assert len(sessions) == 2
        assert sessions[0].id == "20260520_110000"
        assert "Second" in sessions[0].title
        assert sessions[0].agent_id == "arete"
        assert sessions[1].id == "20260520_120000"

    @pytest.mark.asyncio
    async def test_respects_limit(self):
        """Should only return up to 'limit' sessions."""
        from server.agents.hermes_adapter import SESSIONS_DIR, HermesAdapter
        import tempfile

        with tempfile.TemporaryDirectory() as td:
            sd = Path(td) / "sessions"
            sd.mkdir()
            for i in range(20):
                (sd / f"session_{i:04d}.jsonl").write_text(
                    json.dumps({"content": f"Chat {i}", "timestamp": "20260520_120000"}) + "\n",
                    encoding="utf-8",
                )
            adapter = HermesAdapter()
            with patch.object(adapter, "_cb_sessions", new=await _noop_cb("cb_ses")):
                with patch("server.agents.hermes_adapter.SESSIONS_DIR", sd):
                    sessions = await adapter.recent_sessions(limit=5)

        assert len(sessions) == 5

    @pytest.mark.asyncio
    async def test_skips_non_dict_items(self):
        """Non-dict items in the jsonl file should be skipped gracefully."""
        import tempfile

        with tempfile.TemporaryDirectory() as td:
            sd = Path(td) / "sessions"
            sd.mkdir()
            (sd / "valid.jsonl").write_text(
                json.dumps({"content": "Valid session", "timestamp": "20260520_120000"}) + "\n",
                encoding="utf-8",
            )
            (sd / "invalid.jsonl").write_text("not json\n", encoding="utf-8")
            adapter = HermesAdapter()
            with patch.object(adapter, "_cb_sessions", new=await _noop_cb("cb_ses")):
                with patch("server.agents.hermes_adapter.SESSIONS_DIR", sd):
                    sessions = await adapter.recent_sessions(limit=10)

        assert len(sessions) == 1
        assert sessions[0].id == "valid"


# ── Skills Tests ──────────────────────────────────────────────────────────


class TestHermesSkills:
    """Tests for HermesAdapter.list_skills() — reads from filesystem."""

    @pytest.mark.asyncio
    async def test_parses_skills(self):
        """Skills should be parsed from filesystem skill files."""
        from server.agents.hermes_adapter import SKILLS_DIR, HermesAdapter
        import tempfile

        with tempfile.TemporaryDirectory() as td:
            sd = Path(td) / "skills"
            sd.mkdir()
            # Create a skill directory with SKILL.md
            skill_dir = sd / "web_search"
            skill_dir.mkdir()
            (skill_dir / "SKILL.md").write_text(
                "---\nname: web_search\ncategory: search\nsource: local\ntrust: medium\nenabled: true\n---\n",
                encoding="utf-8",
            )
            # Create a flat skill .md file
            (sd / "code_exec.md").write_text(
                "---\nname: code_exec\ncategory: dev\nsource: local\ntrust: high\nenabled: false\n---\n",
                encoding="utf-8",
            )
            adapter = HermesAdapter()
            with patch.object(adapter, "_cb_skills", new=await _noop_cb("cb_sk")):
                with patch("server.agents.hermes_adapter.SKILLS_DIR", sd):
                    skills = await adapter.list_skills()

        assert len(skills) == 2
        names = {s["name"] for s in skills}
        assert "web_search" in names
        assert "code_exec" in names
        ws = next(s for s in skills if s["name"] == "web_search")
        assert ws["enabled"] is True
        assert ws["category"] == "search"
        ce = next(s for s in skills if s["name"] == "code_exec")
        assert ce["enabled"] is False

    @pytest.mark.asyncio
    async def test_returns_empty_when_dir_missing(self):
        """When skills directory doesn't exist, returns empty list."""
        from server.agents.hermes_adapter import SKILLS_DIR, HermesAdapter
        import tempfile

        with tempfile.TemporaryDirectory() as td:
            # No skills dir created — SKILLS_DIR patched to a non-existent dir
            missing = Path(td) / "nope"
            adapter = HermesAdapter()
            with patch.object(adapter, "_cb_skills", new=await _noop_cb("cb_sk")):
                with patch("server.agents.hermes_adapter.SKILLS_DIR", missing):
                    skills = await adapter.list_skills()

        assert skills == []

    @pytest.mark.asyncio
    async def test_skips_invalid_entries(self):
        """Files without YAML frontmatter should still be parsed with defaults."""
        from server.agents.hermes_adapter import SKILLS_DIR, HermesAdapter
        import tempfile

        with tempfile.TemporaryDirectory() as td:
            sd = Path(td) / "skills"
            sd.mkdir()
            # Valid skill file
            (sd / "valid_skill.md").write_text(
                "---\nname: valid_skill\n---\n",
                encoding="utf-8",
            )
            # Invalid file — no frontmatter, just raw text
            (sd / "notes.md").write_text("Just some notes\n", encoding="utf-8")
            adapter = HermesAdapter()
            with patch.object(adapter, "_cb_skills", new=await _noop_cb("cb_sk")):
                with patch("server.agents.hermes_adapter.SKILLS_DIR", sd):
                    skills = await adapter.list_skills()

        assert len(skills) == 2
        names = {s["name"] for s in skills}
        assert "valid_skill" in names

    @pytest.mark.asyncio
    async def test_defaults_for_missing_fields(self):
        """Missing frontmatter fields should fall back to defaults."""
        from server.agents.hermes_adapter import SKILLS_DIR, HermesAdapter
        import tempfile

        with tempfile.TemporaryDirectory() as td:
            sd = Path(td) / "skills"
            sd.mkdir()
            (sd / "minimal.md").write_text(
                "---\nname: minimal\n---\n",
                encoding="utf-8",
            )
            adapter = HermesAdapter()
            with patch.object(adapter, "_cb_skills", new=await _noop_cb("cb_sk")):
                with patch("server.agents.hermes_adapter.SKILLS_DIR", sd):
                    skills = await adapter.list_skills()

        assert skills[0]["category"] is None
        assert skills[0]["source"] == "local"
        assert skills[0]["trust"] == "unknown"
        assert skills[0]["enabled"] is True


# ── Cron Jobs Tests ──────────────────────────────────────────────────────


class TestHermesCron:
    """Tests for HermesAdapter.list_cron_jobs()."""

    @pytest.mark.asyncio
    async def test_parses_cron_jobs(self):
        """Cron jobs should be parsed from API response."""
        resp = _make_resp(json_data={
            "jobs": [
                {"id": "c1", "status": "active", "name": "daily-summary",
                 "schedule": "0 8 * * *"},
            ]
        })
        adapter = HermesAdapter()
        adapter._client = _make_client(resp)

        jobs = await adapter.list_cron_jobs()

        assert len(jobs) == 1
        assert jobs[0]["id"] == "c1"
        assert jobs[0]["status"] == "active"

    @pytest.mark.asyncio
    async def test_returns_empty_on_error(self):
        """On HTTP error, list_cron_jobs should return empty list."""
        resp = _make_resp(status=500)
        adapter = HermesAdapter()
        adapter._client = _make_client(resp)

        jobs = await adapter.list_cron_jobs()
        assert jobs == []


# ── Dispatch Tests ────────────────────────────────────────────────────────


class TestHermesDispatch:
    """Tests for HermesAdapter.dispatch()."""

    @pytest.mark.asyncio
    async def test_dispatches_task(self):
        """Dispatch should POST to /chat and return success response."""
        resp = _make_resp(json_data={
            "id": "sess-123",
            "choices": [{"message": {"content": "Task completed"}}],
        })
        adapter = HermesAdapter()
        adapter._client = _make_client(resp)

        result = await adapter.dispatch("do something", skills="bash")

        assert result["success"] is True
        assert result["agent"] == "arete"
        assert result["task"] == "do something"
        assert result["session_id"] == "sess-123"

    @pytest.mark.asyncio
    async def test_dispatch_unreachable_returns_error(self):
        """When Hermes is offline, dispatch returns error dict."""
        client = _make_client()
        client.post.side_effect = AgentOfflineError("unreachable")
        adapter = HermesAdapter()
        adapter._client = client

        result = await adapter.dispatch("task")

        assert result["success"] is False
        assert result["error"] == "Hermes API unreachable"

    @pytest.mark.asyncio
    async def test_dispatch_generic_error_captured(self):
        """Generic exceptions in dispatch are captured."""
        client = _make_client()
        client.post.side_effect = ValueError("something broke")
        adapter = HermesAdapter()
        adapter._client = client

        result = await adapter.dispatch("task")

        assert result["success"] is False
        assert "something broke" in result["error"]


# ── Error Buffer Tests ────────────────────────────────────────────────────


class TestHermesErrorBuffer:
    """Tests for HermesAdapter.recent_errors()."""

    @pytest.mark.asyncio
    async def test_records_errors(self):
        """recent_errors should return errors from the buffer without draining."""
        resp = _make_resp(status=500)
        adapter = HermesAdapter()
        adapter._client = _make_client(resp)

        with pytest.raises(AgentOfflineError):
            await adapter.health()

        errors = await adapter.recent_errors()
        assert len(errors) == 1
        assert "Hermes API error 500" in errors[0].message

        # Buffer is NOT cleared after read (idempotent)
        errors2 = await adapter.recent_errors()
        assert len(errors2) == 1

    @pytest.mark.asyncio
    async def test_respects_limit(self):
        """recent_errors should cap at the limit."""
        adapter = HermesAdapter()
        for i in range(10):
            adapter._record_error(f"error {i}")
        assert len(await adapter.recent_errors(limit=3)) == 3


# ── Retry Logic Tests ─────────────────────────────────────────────────────


class TestHermesRetry:
    """Tests for HermesAdapter._retry_request internal logic."""

    @pytest.mark.asyncio
    async def test_http_status_error_no_retry(self):
        """HTTP 4xx/5xx should raise ConnectionError immediately (no retry)."""
        resp = _make_resp(status=404)
        client = _make_client(resp)
        adapter = HermesAdapter()
        adapter._client = client

        with pytest.raises(ConnectionError, match="Hermes API error 404"):
            await adapter._get("/health")
        assert client.get.call_count == 1

    @pytest.mark.asyncio
    async def test_timeout_retries_exactly_3_times(self):
        """Timeout triggers all 3 retries then raises."""
        client = _make_client()
        client.get.side_effect = [
            httpx.TimeoutException("t1"),
            httpx.TimeoutException("t2"),
            httpx.TimeoutException("t3"),
        ]
        adapter = HermesAdapter()
        adapter._client = client

        with pytest.raises(ConnectionError, match="timeout after retries"):
            await adapter._get("/health")
        assert client.get.call_count == 3

    @pytest.mark.asyncio
    async def test_succeeds_on_second_retry(self):
        """After timeout + timeout, third call succeeds."""
        success = _make_resp(json_data={"status": "ok"})
        client = _make_client()
        client.get.side_effect = [
            httpx.TimeoutException("t1"),
            httpx.TimeoutException("t2"),
            success,
        ]
        adapter = HermesAdapter()
        adapter._client = client

        data = await adapter._get("/health")
        assert data["status"] == "ok"
        assert client.get.call_count == 3

    @pytest.mark.asyncio
    async def test_post_sends_json(self):
        """POST requests should include JSON payload."""
        resp = _make_resp(json_data={"result": "ok"})
        client = _make_client(resp)
        adapter = HermesAdapter()
        adapter._client = client

        data = await adapter._post("/chat", json={"task": "hello"})
        assert data["result"] == "ok"
        client.post.assert_called_once()
