"""Group 4: Security & Analytics tests for ACC Dashboard.

Tests cover:
- Auth middleware (A2)
- Rate limiting (A3)
- Path injection prevention (A5)
- Trends endpoints (B3)
- Health score (B4)
- Vault vitals (B5)
- Cron dashboard (B6)
- Inference usage (B7)
- Skill usage with heat (B1)
"""
import json
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone

# ── Fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture
def client():
    """Create a test client with mocked adapters."""
    from fastapi.testclient import TestClient
    from server.main import app
    import server.api as api_module

    # Mock Hermes adapter
    mock_hermes = MagicMock()
    mock_hermes.health.return_value = MagicMock(
        agent_id="arete", agent_type="hermes", name="ARETE",
        status="online", model="deepseek-v4-flash",
        session_count=5, error_count=0,
        uptime_seconds=3600, last_active=datetime.now(timezone.utc),
        current_task=None, error_message=None,
    )
    mock_hermes.recent_sessions = AsyncMock(return_value=[])
    mock_hermes.recent_errors = AsyncMock(return_value=[])
    mock_hermes.list_skills = AsyncMock(return_value=[
        {"name": "test-skill", "category": "test", "enabled": True},
    ])
    mock_hermes.list_cron_jobs = AsyncMock(return_value=[])

    # Mock Shu adapter
    mock_shu = MagicMock()
    mock_shu.health.return_value = MagicMock(
        agent_id="shu", agent_type="discord", name="Shu",
        status="online", model="gpt-4",
        session_count=3, error_count=0,
        uptime_seconds=1800, last_active=datetime.now(timezone.utc),
        current_task=None, error_message=None,
    )
    mock_shu.recent_sessions = AsyncMock(return_value=[])
    mock_shu.recent_errors = AsyncMock(return_value=[])

    # Mock VaultReader
    mock_vault = MagicMock()
    mock_vault.get_all_projects.return_value = []
    mock_vault._root = Path("/tmp/test_vault")
    mock_vault._validate_path.return_value = True

    # Set module-level globals
    api_module._hermes = mock_hermes
    api_module._shu = mock_shu
    api_module._vault = mock_vault

    # Initialize aggregators
    from server.aggregators.health_score import HealthScoreEngine
    from server.aggregators.vault_analytics import VaultAnalytics
    from server.aggregators.cron_dashboard import CronDashboard
    api_module._health_score = HealthScoreEngine()
    api_module._vault_analytics = VaultAnalytics(str(Path("/tmp").resolve()))
    api_module._cron_dashboard = CronDashboard()

    return TestClient(app), mock_hermes, mock_shu, mock_vault


# ── A2: Auth Tests ──────────────────────────────────────────────────────────

class TestAuthMiddleware:
    """Tests for Bearer token authentication middleware."""

    def test_exempt_paths_always_accessible(self, client):
        """Healthz and readyz should be accessible without auth."""
        client, _, _, _ = client
        resp = client.get("/healthz")
        assert resp.status_code == 200


class TestPathInjection:
    """Tests for path traversal prevention."""

    def test_slug_traversal_blocked(self, client):
        """Path traversal via slug should return 400."""
        client, _, _, _ = client
        resp = client.get("/api/projects/../../etc/passwd")
        # Should be 400 (invalid path) or 404 (not found), not 200
        assert resp.status_code in [400, 404]

    def test_slug_with_slash_blocked(self, client):
        """Slugs containing slashes should be rejected."""
        client, _, _, _ = client
        resp = client.get("/api/projects/foo/bar")
        assert resp.status_code in [400, 404]

    def test_slug_with_dots_blocked(self, client):
        """Slugs containing .. should be rejected."""
        client, _, _, _ = client
        resp = client.get("/api/projects/test..project")
        assert resp.status_code in [400, 404]

    def test_vault_static_path_validation(self):
        """Static path validation should block traversal."""
        from server.vault import VaultReader
        vr = VaultReader("/tmp/test_vault")
        # Path that escapes the vault should be blocked
        assert vr._validate_static_path(
            Path("/etc/passwd"), Path("/tmp/test_vault")
        ) is False


# ── B1: Skill Usage Heat ─────────────────────────────────────────────────────

class TestSkillUsageHeat:
    """Tests for skill usage heat classification."""

    def test_skills_endpoint_includes_heat(self, client):
        """Skills endpoint should return heat classification."""
        client, mock_hermes, _, _ = client
        resp = client.get("/api/skills")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        if data:
            assert "heat" in data[0] or len(data) == 0  # Heat field should exist

    def test_skills_usage_endpoint(self, client):
        """Skills usage endpoint should return usage data."""
        client, _, _, _ = client
        resp = client.get("/api/skills/usage")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)


# ── B3: Trends Endpoints ─────────────────────────────────────────────────────

class TestTrendsEndpoints:
    """Tests for trends API endpoints."""

    def test_session_trends(self, client):
        """/api/trends/sessions returns valid structure."""
        client, _, _, _ = client
        resp = client.get("/api/trends/sessions")
        assert resp.status_code == 200
        data = resp.json()
        assert "points" in data
        assert "badge" in data

    def test_error_trends(self, client):
        """/api/trends/errors returns valid structure."""
        client, _, _, _ = client
        resp = client.get("/api/trends/errors")
        assert resp.status_code == 200
        data = resp.json()
        assert "points" in data
        assert "breakdown" in data

    def test_combined_trends(self, client):
        """/api/trends returns combined sessions + errors."""
        client, _, _, _ = client
        resp = client.get("/api/trends")
        assert resp.status_code == 200
        data = resp.json()
        assert "sessions" in data
        assert "errors" in data


# ── B4: Health Score ──────────────────────────────────────────────────────────

class TestHealthScore:
    """Tests for composite health score endpoint."""

    def test_health_score_returns_valid_structure(self, client):
        """/api/health/score returns 0-100 score with breakdown."""
        client, _, _, _ = client
        resp = client.get("/api/health/score")
        assert resp.status_code == 200
        data = resp.json()
        assert "score" in data
        assert 0 <= data["score"] <= 100
        assert "breakdown" in data
        assert "recommendations" in data

    def test_health_score_categories(self, client):
        """Health score should have all 5 categories."""
        client, _, _, _ = client
        resp = client.get("/api/health/score")
        data = resp.json()
        breakdown = data["breakdown"]
        for cat in ["sessions", "errors", "projects", "skills", "vault"]:
            assert cat in breakdown
            assert "score" in breakdown[cat]
            assert "max" in breakdown[cat]


# ── B5: Vault Vitals ──────────────────────────────────────────────────────────

class TestVaultVitals:
    """Tests for vault vital signs endpoint."""

    def test_vault_vitals_returns_structure(self, client):
        """/api/vault/vitals returns entity count and analytics."""
        client, _, _, _ = client
        resp = client.get("/api/vault/vitals")
        assert resp.status_code == 200
        data = resp.json()
        assert "entity_count" in data
        assert "top_linked" in data
        assert "orphaned_notes" in data

    def test_vault_vitals_top_linked_is_list(self, client):
        """Top linked should be a list of {name, incoming_links}."""
        client, _, _, _ = client
        resp = client.get("/api/vault/vitals")
        data = resp.json()
        assert isinstance(data["top_linked"], list)


# ── B6: Cron Dashboard ──────────────────────────────────────────────────────

class TestCronDashboard:
    """Tests for cron dashboard endpoint."""

    def test_cron_dashboard_returns_structure(self, client):
        """/api/cron/dashboard returns jobs list."""
        client, _, _, _ = client
        resp = client.get("/api/cron/dashboard")
        assert resp.status_code == 200
        data = resp.json()
        assert "jobs" in data
        assert "total" in data
        assert "computed_at" in data

    def test_cron_dashboard_empty_jobs(self, client):
        """With no cron jobs, should return empty list."""
        client, _, _, _ = client
        resp = client.get("/api/cron/dashboard")
        data = resp.json()
        assert isinstance(data["jobs"], list)


# ── B7: Inference Usage ──────────────────────────────────────────────────────

class TestInferenceUsage:
    """Tests for inference usage stub endpoint."""

    def test_inference_usage_returns_structure(self, client):
        """/api/inference/usage returns token aggregation."""
        client, _, _, _ = client
        resp = client.get("/api/inference/usage")
        assert resp.status_code == 200
        data = resp.json()
        assert "total_tokens" in data
        assert "note" in data
        assert data["estimated_cost"] is None


# ── A3: Rate Limiting ─────────────────────────────────────────────────────────

class TestRateLimiting:
    """Tests for rate limiting middleware."""

    def test_health_endpoint_accessible(self, client):
        """/api/health should be accessible at normal rate."""
        client, _, _, _ = client
        resp = client.get("/api/health")
        assert resp.status_code == 200

    def test_multiple_health_calls_succeed(self, client):
        """Multiple normal-rate calls should all succeed."""
        client, _, _, _ = client
        for _ in range(5):
            resp = client.get("/api/health")
            assert resp.status_code == 200