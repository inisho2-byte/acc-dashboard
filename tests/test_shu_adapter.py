"""
Unit tests for ShuDiscordAdapter — Discord API v10 adapter with rate-limit handling.

Coverage: health with/without token, 401/403/404/429 handling, session parsing,
persistent error buffer, circuit breaker behavior.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from server.agents.shu_adapter import ShuDiscordAdapter
from server.models import (
    AgentOfflineError,
    AuthenticationError,
    ConnectionError,
    ParseError,
    RateLimitError,
)
from server.utils.circuit_breaker import CircuitOpenError


# ── Helpers ────────────────────────────────────────────────────────────────


def _make_discord_resp(
    status: int = 200,
    json_data: list | dict | None = None,
    retry_after: str | None = None,
) -> MagicMock:
    """Create a mock httpx.Response for Discord API."""
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status
    resp.is_error = status >= 400
    resp.is_success = status < 400
    resp.json.return_value = json_data or []
    # Use MagicMock for headers so .get() returns a mock with .return_value
    resp.headers = MagicMock()
    resp.headers.get.return_value = retry_after
    return resp


def _make_discord_message(
    msg_id: str = "12345",
    content: str = "Hello world",
    username: str = "TestUser",
    timestamp: str = "2026-05-19T12:00:00Z",
) -> dict:
    return {
        "id": msg_id,
        "content": content,
        "author": {"username": username, "id": "user1"},
        "timestamp": timestamp,
    }


# ── Health Tests ──────────────────────────────────────────────────────────


class TestShuHealth:
    """Tests for ShuDiscordAdapter.health()."""

    @pytest.mark.asyncio
    async def test_returns_online_with_token(self):
        """With a valid token, health should return online status."""
        messages = [_make_discord_message()]
        resp = _make_discord_resp(json_data=messages)

        with patch("httpx.AsyncClient") as mock_cls:
            inner = AsyncMock()
            inner.get = AsyncMock(return_value=resp)
            mock_cls.return_value.__aenter__.return_value = inner

            adapter = ShuDiscordAdapter(channel_id="987654")
            adapter._token = "valid_bot_token"

            status = await adapter.health()

        assert status.status == "online"
        assert status.agent_id == "shu"
        assert status.agent_type == "discord"
        assert status.name == "Shu"
        assert status.last_active is not None

    @pytest.mark.asyncio
    async def test_returns_online_with_no_messages(self):
        """Empty channel should still report online (no last_active)."""
        resp = _make_discord_resp(json_data=[])

        with patch("httpx.AsyncClient") as mock_cls:
            inner = AsyncMock()
            inner.get = AsyncMock(return_value=resp)
            mock_cls.return_value.__aenter__.return_value = inner

            adapter = ShuDiscordAdapter(channel_id="987654")
            adapter._token = "valid_bot_token"

            status = await adapter.health()

        assert status.status == "online"
        assert status.last_active is None

    @pytest.mark.asyncio
    async def test_raises_auth_error_without_token(self):
        """Missing token should raise AuthenticationError."""
        adapter = ShuDiscordAdapter(channel_id="123456", env_token_var="NONEXISTENT_TOKEN")
        adapter._token = ""

        with pytest.raises(AuthenticationError, match="No Discord bot token"):
            await adapter.health()

    @pytest.mark.asyncio
    async def test_raises_rate_limit_on_429(self):
        """429 response should raise RateLimitError with retry_after."""
        resp = _make_discord_resp(status=429, retry_after="30")

        with patch("httpx.AsyncClient") as mock_cls:
            inner = AsyncMock()
            inner.get = AsyncMock(return_value=resp)
            mock_cls.return_value.__aenter__.return_value = inner

            adapter = ShuDiscordAdapter(channel_id="123456")
            adapter._token = "token"

            with pytest.raises(RateLimitError) as exc_info:
                await adapter.health()

            assert exc_info.value.retry_after_seconds == 30
            assert "rate limited" in str(exc_info.value).lower()

    @pytest.mark.asyncio
    async def test_raises_auth_on_401(self):
        """401 should raise AuthenticationError."""
        resp = _make_discord_resp(status=401)

        with patch("httpx.AsyncClient") as mock_cls:
            inner = AsyncMock()
            inner.get = AsyncMock(return_value=resp)
            mock_cls.return_value.__aenter__.return_value = inner

            adapter = ShuDiscordAdapter(channel_id="123456")
            adapter._token = "bad_token"

            with pytest.raises(AuthenticationError, match="auth failed"):
                await adapter.health()

    @pytest.mark.asyncio
    async def test_raises_auth_on_403(self):
        """403 should also raise AuthenticationError."""
        resp = _make_discord_resp(status=403)

        with patch("httpx.AsyncClient") as mock_cls:
            inner = AsyncMock()
            inner.get = AsyncMock(return_value=resp)
            mock_cls.return_value.__aenter__.return_value = inner

            adapter = ShuDiscordAdapter(channel_id="123456")
            adapter._token = "bad_token"

            with pytest.raises(AuthenticationError, match="auth failed"):
                await adapter.health()

    @pytest.mark.asyncio
    async def test_raises_offline_on_404(self):
        """404 should raise AgentOfflineError (channel not found)."""
        resp = _make_discord_resp(status=404)

        with patch("httpx.AsyncClient") as mock_cls:
            inner = AsyncMock()
            inner.get = AsyncMock(return_value=resp)
            mock_cls.return_value.__aenter__.return_value = inner

            adapter = ShuDiscordAdapter(channel_id="123456")
            adapter._token = "token"

            with pytest.raises(AgentOfflineError, match="channel.*not found"):
                await adapter.health()

    @pytest.mark.asyncio
    async def test_raises_offline_on_500(self):
        """Other HTTP errors should raise AgentOfflineError."""
        resp = _make_discord_resp(status=500)

        with patch("httpx.AsyncClient") as mock_cls:
            inner = AsyncMock()
            inner.get = AsyncMock(return_value=resp)
            mock_cls.return_value.__aenter__.return_value = inner

            adapter = ShuDiscordAdapter(channel_id="123456")
            adapter._token = "token"

            with pytest.raises(AgentOfflineError, match="Discord API error"):
                await adapter.health()

    @pytest.mark.asyncio
    async def test_raises_connection_on_timeout(self):
        """Timeout should raise ConnectionError."""
        with patch("httpx.AsyncClient") as mock_cls:
            inner = AsyncMock()
            inner.get = AsyncMock(side_effect=httpx.TimeoutException("timed out"))
            mock_cls.return_value.__aenter__.return_value = inner

            adapter = ShuDiscordAdapter(channel_id="123456")
            adapter._token = "token"

            with pytest.raises(ConnectionError, match="timeout"):
                await adapter.health()

    @pytest.mark.asyncio
    async def test_raises_connection_on_request_error(self):
        """General RequestError should raise ConnectionError."""
        with patch("httpx.AsyncClient") as mock_cls:
            inner = AsyncMock()
            inner.get = AsyncMock(side_effect=httpx.RequestError("dns failed"))
            mock_cls.return_value.__aenter__.return_value = inner

            adapter = ShuDiscordAdapter(channel_id="123456")
            adapter._token = "token"

            with pytest.raises(ConnectionError, match="connection failed"):
                await adapter.health()

    @pytest.mark.asyncio
    async def test_circuit_breaker_opens_after_3_failures(self):
        """After 3 health failures, circuit breaker opens."""
        resp = _make_discord_resp(status=500)

        with patch("httpx.AsyncClient") as mock_cls:
            inner = AsyncMock()
            inner.get = AsyncMock(return_value=resp)
            mock_cls.return_value.__aenter__.return_value = inner

            adapter = ShuDiscordAdapter(channel_id="123456")
            adapter._token = "token"

            for _ in range(3):
                with pytest.raises(AgentOfflineError):
                    await adapter.health()

            with pytest.raises(CircuitOpenError, match="OPEN"):
                await adapter.health()


# ── Sessions Tests ──────────────────────────────────────────────────────────


class TestShuSessions:
    """Tests for ShuDiscordAdapter.recent_sessions()."""

    @pytest.mark.asyncio
    async def test_parses_messages(self):
        """Should parse Discord messages into AgentSession objects."""
        messages = [
            _make_discord_message(msg_id="100", content="First message", username="Alice"),
            _make_discord_message(msg_id="101", content="Second message", username="Bob",
                                  timestamp="2026-05-19T13:00:00Z"),
        ]
        resp = _make_discord_resp(json_data=messages)

        with patch("httpx.AsyncClient") as mock_cls:
            inner = AsyncMock()
            inner.get = AsyncMock(return_value=resp)
            mock_cls.return_value.__aenter__.return_value = inner

            adapter = ShuDiscordAdapter(channel_id="987654")
            adapter._token = "token"

            sessions = await adapter.recent_sessions(limit=10)

        assert len(sessions) == 2
        assert sessions[0].id == "shu-100"
        assert sessions[0].title == "Message from Alice"
        assert sessions[0].preview == "First message"
        assert sessions[0].body == "First message"
        assert sessions[0].author == "Alice"
        assert sessions[0].agent_id == "shu"
        assert sessions[1].id == "shu-101"
        assert sessions[1].author == "Bob"

    @pytest.mark.asyncio
    async def test_preview_truncates_long_content(self):
        """Preview should truncate at 80 chars with ellipsis."""
        long_msg = "X" * 200
        messages = [_make_discord_message(content=long_msg)]
        resp = _make_discord_resp(json_data=messages)

        with patch("httpx.AsyncClient") as mock_cls:
            inner = AsyncMock()
            inner.get = AsyncMock(return_value=resp)
            mock_cls.return_value.__aenter__.return_value = inner

            adapter = ShuDiscordAdapter(channel_id="987654")
            adapter._token = "token"

            sessions = await adapter.recent_sessions(limit=10)

        assert len(sessions[0].preview) == 81  # 80 chars + ellipsis
        assert sessions[0].preview.endswith("…")

    @pytest.mark.asyncio
    async def test_raises_auth_without_token(self):
        """Missing token should raise AuthenticationError."""
        adapter = ShuDiscordAdapter(channel_id="123456")
        adapter._token = ""

        with pytest.raises(AuthenticationError, match="No Discord bot token"):
            await adapter.recent_sessions()

    @pytest.mark.asyncio
    async def test_raises_rate_limit_on_429(self):
        """429 should raise RateLimitError."""
        resp = _make_discord_resp(status=429, retry_after="45")

        with patch("httpx.AsyncClient") as mock_cls:
            inner = AsyncMock()
            inner.get = AsyncMock(return_value=resp)
            mock_cls.return_value.__aenter__.return_value = inner

            adapter = ShuDiscordAdapter(channel_id="123456")
            adapter._token = "token"

            with pytest.raises(RateLimitError) as exc_info:
                await adapter.recent_sessions()
            assert exc_info.value.retry_after_seconds == 45

    @pytest.mark.asyncio
    async def test_raises_auth_on_401(self):
        """401 in sessions should raise AuthenticationError."""
        resp = _make_discord_resp(status=401)

        with patch("httpx.AsyncClient") as mock_cls:
            inner = AsyncMock()
            inner.get = AsyncMock(return_value=resp)
            mock_cls.return_value.__aenter__.return_value = inner

            adapter = ShuDiscordAdapter(channel_id="123456")
            adapter._token = "bad_token"

            with pytest.raises(AuthenticationError, match="auth failed"):
                await adapter.recent_sessions()

    @pytest.mark.asyncio
    async def test_raises_offline_on_404(self):
        """404 in sessions should raise AgentOfflineError."""
        resp = _make_discord_resp(status=404)

        with patch("httpx.AsyncClient") as mock_cls:
            inner = AsyncMock()
            inner.get = AsyncMock(return_value=resp)
            mock_cls.return_value.__aenter__.return_value = inner

            adapter = ShuDiscordAdapter(channel_id="123456")
            adapter._token = "token"

            with pytest.raises(AgentOfflineError, match="not found"):
                await adapter.recent_sessions()

    @pytest.mark.asyncio
    async def test_raises_connection_on_error(self):
        """Other HTTP errors in sessions should raise ConnectionError."""
        resp = _make_discord_resp(status=500)

        with patch("httpx.AsyncClient") as mock_cls:
            inner = AsyncMock()
            inner.get = AsyncMock(return_value=resp)
            mock_cls.return_value.__aenter__.return_value = inner

            adapter = ShuDiscordAdapter(channel_id="123456")
            adapter._token = "token"

            with pytest.raises(ConnectionError, match="Discord API error"):
                await adapter.recent_sessions()

    @pytest.mark.asyncio
    async def test_raises_parse_on_bad_json(self):
        """Invalid JSON should raise ParseError."""
        resp = _make_discord_resp()
        resp.json.side_effect = ValueError("invalid json")

        with patch("httpx.AsyncClient") as mock_cls:
            inner = AsyncMock()
            inner.get = AsyncMock(return_value=resp)
            mock_cls.return_value.__aenter__.return_value = inner

            adapter = ShuDiscordAdapter(channel_id="123456")
            adapter._token = "token"

            with pytest.raises(ParseError, match="parse"):
                await adapter.recent_sessions()

    @pytest.mark.asyncio
    async def test_timeout_in_sessions(self):
        """Timeout in sessions should raise ConnectionError."""
        with patch("httpx.AsyncClient") as mock_cls:
            inner = AsyncMock()
            inner.get = AsyncMock(side_effect=httpx.TimeoutException("slow"))
            mock_cls.return_value.__aenter__.return_value = inner

            adapter = ShuDiscordAdapter(channel_id="123456")
            adapter._token = "token"

            with pytest.raises(ConnectionError, match="timeout"):
                await adapter.recent_sessions()

    @pytest.mark.asyncio
    async def test_request_error_in_sessions(self):
        """RequestError in sessions should raise ConnectionError."""
        with patch("httpx.AsyncClient") as mock_cls:
            inner = AsyncMock()
            inner.get = AsyncMock(side_effect=httpx.RequestError("dns"))
            mock_cls.return_value.__aenter__.return_value = inner

            adapter = ShuDiscordAdapter(channel_id="123456")
            adapter._token = "token"

            with pytest.raises(ConnectionError, match="connection failed"):
                await adapter.recent_sessions()


# ── Persistent Error Buffer Tests ──────────────────────────────────────────


class TestShuErrorBuffer:
    """Tests for ShuDiscordAdapter.recent_errors()."""

    @pytest.mark.asyncio
    async def test_errors_accumulate_and_persist(self):
        """Error buffer should accumulate and NOT be drained on read (unlike Hermes)."""
        resp = _make_discord_resp(status=500)

        with patch("httpx.AsyncClient") as mock_cls:
            inner = AsyncMock()
            inner.get = AsyncMock(return_value=resp)
            mock_cls.return_value.__aenter__.return_value = inner

            adapter = ShuDiscordAdapter(channel_id="123456")
            adapter._token = "token"

            with pytest.raises(AgentOfflineError):
                await adapter.health()

            errors1 = await adapter.recent_errors()
            assert len(errors1) == 1

            # Buffer should NOT be cleared on read — Shu uses persistent buffer
            errors2 = await adapter.recent_errors()
            assert len(errors2) == 1

    @pytest.mark.asyncio
    async def test_error_buffer_capped_at_max_errors(self):
        """Error buffer should be capped at max_errors."""
        adapter = ShuDiscordAdapter(channel_id="123456")
        adapter._token = "token"
        for i in range(150):
            adapter._record_error(f"error {i}")

        errors = await adapter.recent_errors(200)
        assert len(errors) == 100  # Default max_errors

    @pytest.mark.asyncio
    async def test_multiple_errors_accumulate(self):
        """Multiple errors across different calls should accumulate."""
        resp = _make_discord_resp(status=500)

        with patch("httpx.AsyncClient") as mock_cls:
            inner = AsyncMock()
            inner.get = AsyncMock(return_value=resp)
            mock_cls.return_value.__aenter__.return_value = inner

            adapter = ShuDiscordAdapter(channel_id="123456")
            adapter._token = "token"

            for _ in range(3):
                with pytest.raises(AgentOfflineError):
                    await adapter.health()

            errors = await adapter.recent_errors()
            assert len(errors) >= 3  # Some might be rejected by circuit breaker
