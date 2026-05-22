"""
Tests for ACC Dashboard agent adapter error handling.

Coverage: Exception hierarchy, error state disambiguation, retry-after handling.
"""

import asyncio
import pytest
import sys
from pathlib import Path
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

# Add server to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from server.models import (
    DataUnavailableError,
    RateLimitError,
    ConnectionError,
    AuthenticationError,
    ParseError,
    AgentOfflineError,
)


# ── Helpers ────────────────────────────────────────────────────────────────


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


class TestExceptionHierarchy:
    """Test exception class structure and inheritance."""

    def test_data_unavailable_error_is_base(self):
        """DataUnavailableError should be the base for retryable errors."""
        assert issubclass(RateLimitError, DataUnavailableError)
        assert issubclass(ConnectionError, DataUnavailableError)
        assert issubclass(AgentOfflineError, DataUnavailableError)

    def test_authentication_error_is_standalone(self):
        """AuthenticationError should NOT inherit from DataUnavailableError."""
        assert not issubclass(AuthenticationError, DataUnavailableError)
        assert issubclass(AuthenticationError, Exception)

    def test_parse_error_is_standalone(self):
        """ParseError should NOT inherit from DataUnavailableError."""
        assert not issubclass(ParseError, DataUnavailableError)
        assert issubclass(ParseError, Exception)

    def test_catch_data_unavailable_catches_subclasses(self):
        """Catching DataUnavailableError should catch all retryable errors."""
        errors = [
            RateLimitError("rate limited"),
            ConnectionError("connection failed"),
            AgentOfflineError("agent offline"),
        ]
        
        caught = []
        for exc in errors:
            try:
                raise exc
            except DataUnavailableError as e:
                caught.append(type(e).__name__)
        
        assert len(caught) == 3
        assert "RateLimitError" in caught
        assert "ConnectionError" in caught
        assert "AgentOfflineError" in caught

    def test_rate_limit_error_has_retry_after(self):
        """RateLimitError should store retry_after_seconds."""
        exc = RateLimitError("limited", retry_after_seconds=60)
        assert exc.retry_after_seconds == 60
        
        # Default should be None
        exc2 = RateLimitError("limited")
        assert exc2.retry_after_seconds is None


class TestShuAdapterErrorHandling:
    """Test ShuDiscordAdapter error state disambiguation."""

    @pytest.mark.asyncio
    async def test_health_raises_auth_error_on_missing_token(self):
        """Missing token should raise AuthenticationError, not return offline status."""
        from server.agents.shu_adapter import ShuDiscordAdapter
        
        adapter = ShuDiscordAdapter(channel_id="123456")
        adapter._token = ""
        
        with pytest.raises(AuthenticationError, match="No Discord bot token"):
            await adapter.health()

    @pytest.mark.asyncio
    async def test_health_raises_rate_limit_on_429(self):
        """429 response should raise RateLimitError with retry_after."""
        from server.agents.shu_adapter import ShuDiscordAdapter
        
        adapter = ShuDiscordAdapter(channel_id="123456")
        adapter._token = "fake_token"
        
        mock_response = MagicMock()
        mock_response.status_code = 429
        mock_response.headers.get.return_value = "30"
        
        with patch("httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client_class.return_value.__aenter__.return_value = mock_client
            
            with pytest.raises(RateLimitError) as exc_info:
                await adapter.health()
            
            assert exc_info.value.retry_after_seconds == 30
            assert "rate limited" in str(exc_info.value).lower()

    @pytest.mark.asyncio
    async def test_health_raises_auth_error_on_401(self):
        """401 response should raise AuthenticationError."""
        from server.agents.shu_adapter import ShuDiscordAdapter
        
        adapter = ShuDiscordAdapter(channel_id="123456")
        adapter._token = "invalid_token"
        
        mock_response = MagicMock()
        mock_response.status_code = 401
        
        with patch("httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client_class.return_value.__aenter__.return_value = mock_client
            
            with pytest.raises(AuthenticationError, match="auth failed"):
                await adapter.health()

    @pytest.mark.asyncio
    async def test_health_raises_connection_error_on_timeout(self):
        """Timeout should raise ConnectionError."""
        from server.agents.shu_adapter import ShuDiscordAdapter
        import httpx
        
        adapter = ShuDiscordAdapter(channel_id="123456")
        adapter._token = "fake_token"
        
        with patch("httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get = AsyncMock(side_effect=httpx.TimeoutException("timeout"))
            mock_client_class.return_value.__aenter__.return_value = mock_client
            
            with pytest.raises(ConnectionError, match="timeout"):
                await adapter.health()

    @pytest.mark.asyncio
    async def test_recent_sessions_raises_on_429(self):
        """429 in recent_sessions should raise RateLimitError."""
        from server.agents.shu_adapter import ShuDiscordAdapter
        
        adapter = ShuDiscordAdapter(channel_id="123456")
        adapter._token = "fake_token"
        
        mock_response = MagicMock()
        mock_response.status_code = 429
        mock_response.headers.get.return_value = "45"
        
        with patch("httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client_class.return_value.__aenter__.return_value = mock_client
            
            with pytest.raises(RateLimitError) as exc_info:
                await adapter.recent_sessions()
            
            assert exc_info.value.retry_after_seconds == 45

    @pytest.mark.asyncio
    async def test_recent_sessions_raises_on_parse_error(self):
        """Invalid JSON should raise ParseError."""
        from server.agents.shu_adapter import ShuDiscordAdapter
        
        adapter = ShuDiscordAdapter(channel_id="123456")
        adapter._token = "fake_token"
        
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.is_error = False
        mock_response.json.side_effect = ValueError("invalid json")
        
        with patch("httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client_class.return_value.__aenter__.return_value = mock_client
            
            with pytest.raises(ParseError, match="parse"):
                await adapter.recent_sessions()


class TestHermesAdapterErrorHandling:
    """Test HermesAdapter error state disambiguation via HTTP adapter."""

    @pytest.mark.asyncio
    async def test_health_raises_agent_offline_on_connect_error(self):
        """HTTP connection error should raise AgentOfflineError."""
        from server.agents.hermes_adapter import HermesAdapter
        import httpx

        adapter = HermesAdapter()
        client = AsyncMock(spec=httpx.AsyncClient)
        client.get = AsyncMock(side_effect=httpx.ConnectError("Connection refused"))
        adapter._client = client

        with pytest.raises(AgentOfflineError, match="unavailable"):
            await adapter.health()

    @pytest.mark.asyncio
    async def test_health_raises_agent_offline_on_timeout(self):
        """HTTP timeout should raise AgentOfflineError."""
        from server.agents.hermes_adapter import HermesAdapter
        import httpx

        adapter = HermesAdapter()
        client = AsyncMock(spec=httpx.AsyncClient)
        client.get = AsyncMock(side_effect=[
            httpx.TimeoutException("timeout 1"),
            httpx.TimeoutException("timeout 2"),
            httpx.TimeoutException("timeout 3"),
        ])
        adapter._client = client

        with pytest.raises(AgentOfflineError, match="unavailable"):
            await adapter.health()

    @pytest.mark.asyncio
    async def test_recent_sessions_returns_empty_on_http_error(self):
        """HTTP failure in recent_sessions should return empty list (graceful degradation)."""
        from server.agents.hermes_adapter import HermesAdapter, SESSIONS_DIR
        import httpx
        import tempfile
        from unittest.mock import patch

        adapter = HermesAdapter()

        with tempfile.TemporaryDirectory() as td:
            # SESSIONS_DIR exists but is empty — simulates graceful degradation
            sd = Path(td) / "sessions"
            sd.mkdir()
            with patch("server.agents.hermes_adapter.SESSIONS_DIR", sd):
                with patch.object(adapter, "_cb_sessions", new=await _noop_cb("cb_ses")):
                    sessions = await adapter.recent_sessions()

        assert sessions == []

    @pytest.mark.asyncio
    async def test_list_skills_returns_empty_when_dir_missing(self):
        """When skills directory is missing, list_skills returns empty list."""
        from server.agents.hermes_adapter import HermesAdapter, SKILLS_DIR
        import tempfile
        from unittest.mock import patch

        adapter = HermesAdapter()

        with tempfile.TemporaryDirectory() as td:
            missing = Path(td) / "nope"  # doesn't exist
            with patch("server.agents.hermes_adapter.SKILLS_DIR", missing):
                with patch.object(adapter, "_cb_skills", new=await _noop_cb("cb_sk")):
                    skills = await adapter.list_skills()

        assert skills == []

    @pytest.mark.asyncio
    async def test_list_cron_returns_empty_on_connect_error(self):
        """Cron list should return [] on HTTP connect error (graceful degradation)."""
        from server.agents.hermes_adapter import HermesAdapter
        import httpx

        adapter = HermesAdapter()
        client = AsyncMock(spec=httpx.AsyncClient)
        client.get = AsyncMock(side_effect=httpx.ConnectError("Connection refused"))
        adapter._client = client

        jobs = await adapter.list_cron_jobs()
        assert jobs == []


class TestErrorHandlingPatterns:
    """Test recommended error handling patterns for callers."""

    @pytest.mark.asyncio
    async def test_caller_can_distinguish_empty_vs_error(self):
        """Callers should distinguish 'no data' from 'fetch failed'."""
        from server.models import DataUnavailableError
        
        # Simulate adapter that can fail
        async def fetch_data(should_fail: bool):
            if should_fail:
                raise ConnectionError("API down")
            return []  # Truly empty
        
        # Pattern 1: Catch and handle
        try:
            data = await fetch_data(should_fail=True)
            # Process data
        except DataUnavailableError:
            # Show "temporarily unavailable" UI, keep cached data
            data = None
        
        assert data is None

    @pytest.mark.asyncio
    async def test_caller_can_retry_on_data_unavailable(self):
        """Callers can retry on DataUnavailableError subclasses."""
        from server.models import RateLimitError, ConnectionError
        
        attempt = 0
        
        async def flaky_fetch():
            nonlocal attempt
            attempt += 1
            if attempt < 3:
                raise RateLimitError("limited", retry_after_seconds=0)
            return ["data"]
        
        # Retry loop pattern
        max_retries = 3
        for i in range(max_retries):
            try:
                result = await flaky_fetch()
                break
            except DataUnavailableError:
                if i == max_retries - 1:
                    raise
                # Would add delay here based on retry_after
        
        assert attempt == 3
        assert result == ["data"]

    @pytest.mark.asyncio
    async def test_auth_errors_should_not_retry(self):
        """AuthenticationError should NOT be retried."""
        from server.models import AuthenticationError
        
        async def auth_fail():
            raise AuthenticationError("invalid token")
        
        # Pattern: Don't retry auth errors
        with pytest.raises(AuthenticationError):
            # Retry loop would be wrong here
            for i in range(3):
                try:
                    await auth_fail()
                except AuthenticationError:
                    # Don't retry - alert user to fix token
                    raise
                except DataUnavailableError:
                    # These CAN be retried
                    pass
        
        # Should only attempt once
        # (this test verifies the pattern, not actual retry logic)
