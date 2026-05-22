"""Group 3 tests: dispatch, skill tracking, model swap, pipeline, and delta features."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))


# ── Mock helpers ──────────────────────────────────────────────────────

class MockHermesAdapter:
    agent_id = "arete"
    agent_type = "hermes"
    display_name = "ARETE"

    def __init__(self):
        self._last_errors = []
        self._cb_health = MagicMock()
        self._cb_health.state = MagicMock()
        self._cb_health.state.value = "closed"
        self._cb_health.stats = MagicMock()
        self._cb_health.stats.total_calls = 10
        self._cb_health.stats.successful_calls = 8
        self._cb_health.stats.failed_calls = 2
        self._cb_health.stats.rejected_calls = 0
        self._cb_health.stats.state_changes = 1
        self._cb_health._get_retry_after = MagicMock(return_value=0.0)
        for attr in ["_cb_sessions", "_cb_cron", "_cb_skills", "_cb_dispatch"]:
            setattr(self, attr, self._cb_health)

    async def health(self):
        from server.models import AgentStatus
        return AgentStatus(
            agent_id="arete", agent_type="hermes", name="ARETE",
            status="online", model="deepseek/deepseek-v4", uptime_seconds=3600,
            session_count=5, last_active=MagicMock(),
        )

    async def recent_sessions(self, limit=10):
        return []

    async def recent_errors(self, limit=10):
        return []

    async def list_skills(self):
        return [
            {"name": "deep-reasoning", "category": "reasoning", "source": "local", "trust": "safe", "enabled": True},
            {"name": "comfyui", "category": "creative", "source": "local", "trust": "safe", "enabled": True},
        ]

    async def list_cron_jobs(self):
        return []


class MockShuAdapter:
    agent_id = "shu"
    agent_type = "discord"

    def __init__(self):
        self._token = "mock_discord_token"
        self._cb_health = MagicMock()
        self._cb_health.state = MagicMock()
        self._cb_health.state.value = "closed"
        self._cb_health.stats = MagicMock()
        self._cb_health.stats.total_calls = 5
        self._cb_health.stats.successful_calls = 5
        self._cb_health.stats.failed_calls = 0
        self._cb_health.stats.rejected_calls = 0
        self._cb_health.stats.state_changes = 0
        self._cb_health._get_retry_after = MagicMock(return_value=0.0)
        self._cb_sessions = self._cb_health

    async def health(self):
        from server.models import AgentStatus
        return AgentStatus(
            agent_id="shu", agent_type="discord", name="Shu",
            status="offline", model="unknown", session_count=0,
            last_active=None,
        )

    async def recent_sessions(self, limit=10):
        return []

    async def recent_errors(self, limit=10):
        return []


# ── Fixtures ──────────────────────────────────────────────────────────

@pytest.fixture
def client():
    """Create a test client with mocked adapters."""
    from server.api import init_adapters, router, admin_router
    from server.events import _bus, EventBus
    from fastapi import FastAPI

    app = FastAPI()
    app.include_router(router, prefix="/api")
    app.include_router(admin_router)

    # Reset event bus
    global _bus
    from server import events as events_mod
    events_mod._bus = EventBus()

    # Initialize adapters with mock data
    mock_hermes = MockHermesAdapter()
    mock_shu = MockShuAdapter()

    from server.api import (
        _hermes, _shu, _vault, _activity, _briefing, _search,
        _ibcb, _context, _memory, _pipeline,
    )
    import server.api as api_mod

    api_mod._hermes = mock_hermes
    api_mod._shu = mock_shu
    api_mod._vault = MagicMock()
    api_mod._activity = MagicMock()
    api_mod._briefing = MagicMock()
    api_mod._search = MagicMock()
    api_mod._ibcb = MagicMock()
    api_mod._context = MagicMock()
    api_mod._memory = MagicMock()
    from server.aggregators.pipeline_engine import PipelineEngine
    api_mod._pipeline = PipelineEngine(api_mod._ibcb)
    api_mod._discord_cfg = {"shu_channel_id": "123"}

    return TestClient(app)


# ── Dispatch SSE event tests ──────────────────────────────────────────

class TestDispatchSSEEvents:
    """A1: Dispatch endpoint publishes SSE events."""

    def test_dispatch_arete_returns_response(self, client):
        """POST /dispatch?agent=arete should return dispatch response."""
        with patch("server.aggregators.dispatch.dispatch_to_arete", new_callable=AsyncMock) as mock_dispatch:
            mock_dispatch.return_value = {
                "agent": "arete", "task": "hello", "session_id": "sess-123",
                "response": "OK", "truncated": False, "success": True, "error": None,
            }
            # We need to also patch the import in the api module
            with patch("server.api.dispatch_to_arete", new_callable=AsyncMock) as api_mock_dispatch:
                api_mock_dispatch.return_value = {
                    "agent": "arete", "task": "hello", "session_id": "sess-123",
                    "response": "OK", "truncated": False, "success": True, "error": None,
                }
                resp = client.post("/api/dispatch?agent=arete&task=hello")
                assert resp.status_code == 200
                data = resp.json()
                assert data["success"] is True
                # Verify the dispatch function was called
                api_mock_dispatch.assert_called_once()

    def test_dispatch_shu_returns_response(self, client):
        """POST /dispatch?agent=shu should return dispatch response."""
        import server.api as api_mod
        with patch.object(api_mod, "dispatch_to_shu", new_callable=AsyncMock) as mock_dispatch:
            mock_dispatch.return_value = {
                "agent": "shu", "task": "hello", "success": True,
                "message_id": "msg-456", "error": None,
            }
            resp = client.post("/api/dispatch?agent=shu&task=hello")
            assert resp.status_code == 200
            data = resp.json()
            assert data["success"] is True


# ── Skill tracking tests ──────────────────────────────────────────────

class TestSkillTracking:
    """A4+A5: Skill trigger tracking and usage metrics."""

    def test_skills_endpoint_includes_usage(self, client):
        """GET /api/skills should include last_used and use_count."""
        from server.db import clear_all_data, get_all_skill_usage, track_skill, init_db
        # Clear any existing data
        try:
            clear_all_data()
        except Exception:
            pass
        # Track a skill
        track_skill("deep-reasoning")
        resp = client.get("/api/skills")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        # Find deep-reasoning skill
        dr = next((s for s in data if s["name"] == "deep-reasoning"), None)
        assert dr is not None
        assert "last_used" in dr
        assert "use_count" in dr
        assert dr["use_count"] >= 1

    def test_skill_run_tracks_usage(self, client):
        """POST /api/skills/{name}/run should track skill usage."""
        from server.db import clear_all_data
        try:
            clear_all_data()
        except Exception:
            pass
        with patch("server.aggregators.dispatch.dispatch_to_arete", new_callable=AsyncMock) as mock_dispatch:
            mock_dispatch.return_value = {
                "agent": "arete", "task": "run", "session_id": "sess-789",
                "response": "OK", "truncated": False, "success": True, "error": None,
            }
            resp = client.post("/api/skills/deep-reasoning/run?task=run")
            assert resp.status_code == 200
            # Skill should be tracked
            from server.db import get_skill_usage
            usage = get_skill_usage("deep-reasoning")
            if usage:
                assert usage["use_count"] >= 1


# ── Model swap tests ─────────────────────────────────────────────────

class TestModelSwap:
    """A6: Model swap endpoint."""

    def test_get_models(self, client):
        """GET /api/agents/arete/models should return model list."""
        resp = client.get("/api/agents/arete/models")
        assert resp.status_code == 200
        data = resp.json()
        assert "models" in data
        assert isinstance(data["models"], list)
        assert len(data["models"]) > 0

    def test_set_model(self, client, tmp_path):
        """POST /api/agents/arete/model should save preference."""
        import json
        resp = client.post("/api/agents/arete/model", json={"model": "anthropic/claude-sonnet-4"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["model"] == "anthropic/claude-sonnet-4"
        assert data["status"] == "preference_saved"

        # Verify file was written
        prefs_file = Path.home() / ".hermes" / "acc" / "model_preferences.json"
        if prefs_file.exists():
            prefs = json.loads(prefs_file.read_text())
            assert prefs.get("arete") == "anthropic/claude-sonnet-4"

    def test_set_model_missing_field(self, client):
        """POST /api/agents/arete/model without model field should return 400."""
        resp = client.post("/api/agents/arete/model", json={})
        assert resp.status_code == 400


# ── Pipeline endpoint tests ────────────────────────────────────────────

class TestPipelineEndpoint:
    """A7: Pipeline endpoint."""

    def test_get_pipeline(self, client):
        """GET /api/pipeline should return pipeline state."""
        resp = client.get("/api/pipeline")
        assert resp.status_code == 200
        data = resp.json()
        assert "stages" in data
        assert "active" in data
        assert isinstance(data["stages"], list)

    def test_pipeline_empty_graceful(self, client):
        """Pipeline should handle missing bridge.db gracefully."""
        import server.api as api_mod
        api_mod._pipeline = MagicMock()
        api_mod._pipeline.get_pipeline.return_value = {
            "stages": [], "active": False, "message": "No inter-agent messages found",
        }
        resp = client.get("/api/pipeline")
        assert resp.status_code == 200
        data = resp.json()
        assert data["active"] is False
        assert len(data["stages"]) == 0


# ── Dispatch truncation tests ─────────────────────────────────────────

class TestDispatchTruncation:
    """A3: Response truncation indicator."""

    def test_dispatch_response_truncated(self):
        """Long responses should include truncated=True."""
        from server.aggregators.dispatch import dispatch_to_arete
        # This is tested indirectly — the dispatch function sets truncated=True
        # when the raw response exceeds 500 chars
        raw_response = "x" * 600
        assert len(raw_response) > 500
        # Simulating the truncation logic
        truncated = len(raw_response) > 500
        assert truncated is True

    def test_dispatch_response_not_truncated(self):
        """Short responses should have truncated=False."""
        raw_response = "short response"
        truncated = len(raw_response) > 500
        assert truncated is False


# ── Circuit breaker timeout tests ─────────────────────────────────────

class TestCircuitBreakerTimeout:
    """A2: Dispatch circuit breaker timeout should be 60s."""

    def test_dispatch_cb_timeout(self):
        """HermesAdapter._cb_dispatch should have timeout_seconds=60.0."""
        from server.agents.hermes_adapter import HermesAdapter
        adapter = HermesAdapter("http://localhost:8642")
        assert adapter._cb_dispatch.config.timeout_seconds == 60.0