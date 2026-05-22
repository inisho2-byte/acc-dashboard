"""Integration tests for ACC Dashboard API routes with mocked adapters."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))

# Patch adapter imports BEFORE importing server modules
import server.agents.hermes_adapter as ha_mod
import server.agents.shu_adapter as sa_mod


# ── Mock helpers ─────────────────────────────────────────────────────────

class MockHermesAdapter:
    """Mock HermesAdapter that returns predefined data."""

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
        from server.models import AgentSession
        from datetime import datetime
        return [
            AgentSession(id="s1", agent_id="arete", title="Test Session",
                         preview="Hello", last_active=datetime.utcnow()),
        ]

    async def recent_errors(self, limit=10):
        return self._last_errors[-limit:]

    async def list_skills(self):
        return [
            {"name": "test-skill", "category": "dev", "source": "local",
             "trust": "safe", "enabled": True},
        ]

    async def list_cron_jobs(self):
        return [{"id": "c1", "status": "active", "name": "test-cron"}]

    async def dispatch(self, task, skills=None):
        return {"agent": "arete", "task": task, "success": True, "error": None}


class MockOfflineHermesAdapter(MockHermesAdapter):
    """Hermes adapter that is offline."""

    async def health(self):
        from server.models import AgentOfflineError
        raise AgentOfflineError("Hermes API unreachable")

    async def recent_sessions(self, limit=10):
        raise ConnectionError("Hermes unavailable")

    async def list_skills(self):
        return []

    async def list_cron_jobs(self):
        return []


class MockShuAdapter:
    """Mock ShuDiscordAdapter."""

    agent_id = "shu"
    agent_type = "discord"
    display_name = "Shu"
    _token = "mock-token"

    def __init__(self):
        self._last_errors = []
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
        for attr in ["_cb_sessions"]:
            setattr(self, attr, self._cb_health)

    async def health(self):
        from server.models import AgentStatus
        return AgentStatus(
            agent_id="shu", agent_type="discord", name="Shu",
            status="online", last_active=MagicMock(),
        )

    async def recent_sessions(self, limit=10):
        from server.models import AgentSession
        from datetime import datetime
        return [
            AgentSession(id="s2", agent_id="shu", title="Shu Message",
                         preview="Hi", last_active=datetime.utcnow()),
        ]

    async def recent_errors(self, limit=10):
        return self._last_errors[-limit:]

    def _record_error(self, message, severity="error"):
        from server.models import AgentError
        from datetime import datetime
        self._last_errors.append(
            AgentError(id="err1", agent_id="shu", timestamp=datetime.utcnow(),
                       message=message, severity=severity)
        )


class MockOfflineShuAdapter(MockShuAdapter):
    """Shu adapter that is offline (no token)."""

    _token = ""

    async def health(self):
        from server.models import AuthenticationError
        raise AuthenticationError("No Discord bot token configured")


class MockVaultReader:
    """Mock VaultReader."""

    def __init__(self):
        self._cache = {}
        self._cache_ts = 0.0
        self._cache_ttl = 300
        self._file_signatures = {}

    def get_all_projects(self):
        from server.models import ProjectStatus
        return [
            ProjectStatus(name="Test Project", slug="test-project", status="active",
                          phase_count=3, phases_complete=1, tags=["dev"],
                          updated="2026-05-19", path="04-projects/test-project/",
                          last_action="Setup repo", next_step="Configure CI"),
        ]


# ── Test class ──────────────────────────────────────────────────────────

class TestAPIRoutes:
    """Integration tests for all Group 1 API endpoints."""

    @pytest.fixture(autouse=True)
    def setup_mocks(self):
        """Patch adapters into the API module before each test."""
        import server.api as api_module

        self._hermes_patch = MagicMock()
        self._shu_patch = MagicMock()
        self._vault_patch = MagicMock()

        api_module._hermes = MockHermesAdapter()
        api_module._shu = MockShuAdapter()
        api_module._vault = MockVaultReader()

        # Import the app only after patching
        from server.main import app
        self.client = TestClient(app)
        yield

    # ── /healthz ────────────────────────────────────────────────

    def test_healthz_returns_200(self):
        """Basic health check should always return 200."""
        resp = self.client.get("/healthz")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert "timestamp" in data

    # ── /readyz ─────────────────────────────────────────────────

    def test_readyz_returns_200_when_hermes_ready(self):
        """Ready probe should return 200 when Hermes is initialized."""
        resp = self.client.get("/readyz")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ready"

    def test_readyz_degraded_when_shu_missing(self):
        """Ready probe should return degraded when Shu is uninitialized."""
        import server.api as api_module
        api_module._shu = None
        resp = self.client.get("/readyz")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ready"
        assert "shu_uninitialized" in (data.get("degraded") or [])

    def test_readyz_503_when_hermes_missing(self):
        """Ready probe should return 503 when Hermes is not initialized."""
        import server.api as api_module
        api_module._hermes = None
        resp = self.client.get("/readyz")
        assert resp.status_code == 503
        data = resp.json()
        assert data["status"] == "not_ready"

    # ── /api/health ─────────────────────────────────────────────

    def test_health_both_online(self):
        """Health should show both agents online."""
        resp = self.client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["agents"]["arete"]["status"] == "online"
        assert data["agents"]["shu"]["status"] == "online"
        assert data["total_skills"] == 1
        assert data["total_sessions"] == 5

    def test_health_hermes_offline_shows_degraded(self):
        """Health should return 200 with offline ARETE when Hermes is down."""
        import server.api as api_module
        api_module._hermes = MockOfflineHermesAdapter()
        resp = self.client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["agents"]["arete"]["status"] == "offline"
        assert data["agents"]["shu"]["status"] == "online"  # Shu unaffected

    def test_health_shu_offline_shows_degraded(self):
        """Health should return 200 with offline Shu when Discord is unavail."""
        import server.api as api_module
        api_module._shu = MockOfflineShuAdapter()
        resp = self.client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["agents"]["arete"]["status"] == "online"
        assert data["agents"]["shu"]["status"] == "offline"

    def test_health_both_offline_still_200(self):
        """Health should return 200 even when both agents are offline."""
        import server.api as api_module
        api_module._hermes = MockOfflineHermesAdapter()
        api_module._shu = MockOfflineShuAdapter()
        resp = self.client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["agents"]["arete"]["status"] == "offline"
        assert data["agents"]["shu"]["status"] == "offline"

    # ── /api/health/{agent_id} ──────────────────────────────────

    def test_agent_health_arete(self):
        """Individual agent health for ARETE."""
        resp = self.client.get("/api/health/arete")
        assert resp.status_code == 200
        data = resp.json()
        assert data["agent_id"] == "arete"
        assert data["status"] == "online"

    def test_agent_health_shu(self):
        """Individual agent health for Shu."""
        resp = self.client.get("/api/health/shu")
        assert resp.status_code == 200
        data = resp.json()
        assert data["agent_id"] == "shu"

    def test_agent_health_unknown(self):
        """Unknown agent returns error."""
        resp = self.client.get("/api/health/unknown")
        assert resp.status_code == 200
        data = resp.json()
        assert "error" in data

    # ── /api/sessions ───────────────────────────────────────────

    def test_sessions_returns_merged_list(self):
        """Sessions from both agents should be merged and sorted."""
        resp = self.client.get("/api/sessions?limit=10")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        agent_ids = {s["agent_id"] for s in data}
        assert "arete" in agent_ids
        assert "shu" in agent_ids

    def test_sessions_arete_only(self):
        """Sessions filtered by agent_id=arete."""
        resp = self.client.get("/api/sessions/arete?limit=10")
        assert resp.status_code == 200
        data = resp.json()
        assert all(s["agent_id"] == "arete" for s in data)

    # ── /api/skills ─────────────────────────────────────────────

    def test_skills_returns_list(self):
        """Skills endpoint should return skill list."""
        resp = self.client.get("/api/skills")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["name"] == "test-skill"
        assert data[0]["source"] == "local"
        assert data[0]["trust"] == "safe"

    # ── /api/errors ─────────────────────────────────────────────

    def test_errors_returns_merged_list(self):
        """Errors from both agents should be merged."""
        import server.api as api_module
        # Add an error to Shu
        api_module._shu._record_error("test error")
        resp = self.client.get("/api/errors?limit=10")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)

    # ── /api/projects ───────────────────────────────────────────

    def test_projects_returns_list(self):
        """Projects endpoint should return project list."""
        resp = self.client.get("/api/projects")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["slug"] == "test-project"
        assert data[0]["name"] == "Test Project"

    # ── /api/cron ───────────────────────────────────────────────

    def test_cron_returns_list(self):
        """Cron jobs endpoint should return job list."""
        resp = self.client.get("/api/cron")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["id"] == "c1"

    # ── /api/monitoring ─────────────────────────────────────────

    def test_monitoring_returns_circuit_breakers(self):
        """Monitoring endpoint should include circuit breaker stats."""
        resp = self.client.get("/api/monitoring")
        assert resp.status_code == 200
        data = resp.json()
        assert "circuit_breakers" in data
        assert "hermes_health" in data["circuit_breakers"]
        assert "shu_health" in data["circuit_breakers"]
        assert "adapters" in data
        assert "error_summary" in data
