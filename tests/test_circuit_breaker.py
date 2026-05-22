"""
Tests for ACC Dashboard circuit breaker pattern.

Coverage: Circuit breaker state transitions, failure handling, timeout-based resets.
"""

import pytest
import asyncio
import time
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent.parent))

from server.utils.circuit_breaker import (
    CircuitBreaker,
    CircuitBreakerConfig,
    CircuitState,
    CircuitOpenError,
    CircuitStats,
)


class TestCircuitBreakerConfig:
    """Test configuration defaults and customization."""

    def test_default_config(self):
        """Default config should have reasonable values."""
        config = CircuitBreakerConfig()
        assert config.failure_threshold == 3
        assert config.success_threshold == 2
        assert config.timeout_seconds == 60.0
        assert config.half_open_max_calls == 1

    def test_custom_config(self):
        """Custom config should override defaults."""
        config = CircuitBreakerConfig(
            failure_threshold=5,
            success_threshold=3,
            timeout_seconds=30.0,
            half_open_max_calls=2,
        )
        assert config.failure_threshold == 5
        assert config.success_threshold == 3
        assert config.timeout_seconds == 30.0
        assert config.half_open_max_calls == 2


class TestCircuitBreakerStateTransitions:
    """Test state machine transitions."""

    def test_initial_state_is_closed(self):
        """Circuit should start in CLOSED state."""
        breaker = CircuitBreaker("test")
        assert breaker.state == CircuitState.CLOSED

    def test_opens_after_failure_threshold(self):
        """Circuit should open after reaching failure threshold."""
        breaker = CircuitBreaker("test", CircuitBreakerConfig(failure_threshold=3))
        
        async def failing_func():
            raise ValueError("test error")
        
        # Fail 3 times
        for _ in range(3):
            with pytest.raises(ValueError):
                asyncio.run(breaker.call(failing_func))
        
        assert breaker.state == CircuitState.OPEN

    def test_half_open_after_timeout(self):
        """Circuit should transition to HALF_OPEN after timeout."""
        config = CircuitBreakerConfig(failure_threshold=1, timeout_seconds=0.1)
        breaker = CircuitBreaker("test", config)
        
        async def failing_func():
            raise ValueError("test error")
        
        # Fail once to open circuit
        with pytest.raises(ValueError):
            asyncio.run(breaker.call(failing_func))
        
        assert breaker.state == CircuitState.OPEN
        
        # Wait for timeout
        time.sleep(0.15)
        
        assert breaker.state == CircuitState.HALF_OPEN

    @pytest.mark.asyncio
    async def test_closes_after_success_threshold(self):
        """Circuit should close after success threshold in HALF_OPEN."""
        config = CircuitBreakerConfig(
            failure_threshold=1,
            timeout_seconds=0.1,
            success_threshold=2,
            half_open_max_calls=5,
        )
        breaker = CircuitBreaker("test", config)
        
        fail_flag = True
        
        async def maybe_fail():
            if fail_flag:
                raise ValueError("test error")
            return "success"
        
        # Fail once to open circuit
        with pytest.raises(ValueError):
            await breaker.call(maybe_fail)
        
        assert breaker.state == CircuitState.OPEN
        
        # Wait for timeout
        await asyncio.sleep(0.15)
        assert breaker.state == CircuitState.HALF_OPEN
        
        # Succeed twice to close (set fail_flag=False)
        fail_flag = False
        await breaker.call(maybe_fail)
        await breaker.call(maybe_fail)
        
        assert breaker.state == CircuitState.CLOSED

    @pytest.mark.asyncio
    async def test_reopens_on_failure_in_half_open(self):
        """Circuit should reopen immediately on failure in HALF_OPEN."""
        config = CircuitBreakerConfig(failure_threshold=1, timeout_seconds=0.1)
        breaker = CircuitBreaker("test", config)
        
        fail_flag = True
        
        async def maybe_fail():
            if fail_flag:
                raise ValueError("test error")
            return "success"
        
        # Fail once to open circuit
        with pytest.raises(ValueError):
            await breaker.call(maybe_fail)
        
        assert breaker.state == CircuitState.OPEN
        
        # Wait for timeout
        await asyncio.sleep(0.15)
        assert breaker.state == CircuitState.HALF_OPEN
        
        # Fail in half-open (still fail_flag=True)
        with pytest.raises(ValueError):
            await breaker.call(maybe_fail)
        
        assert breaker.state == CircuitState.OPEN


class TestCircuitOpenError:
    """Test CircuitOpenError behavior."""

    def test_rejects_calls_when_open(self):
        """Open circuit should reject calls with CircuitOpenError."""
        config = CircuitBreakerConfig(failure_threshold=1, timeout_seconds=60.0)
        breaker = CircuitBreaker("test", config)
        
        async def failing_func():
            raise ValueError("test error")
        
        async def success_func():
            return "success"
        
        # Fail to open circuit
        with pytest.raises(ValueError):
            asyncio.run(breaker.call(failing_func))
        
        assert breaker.state == CircuitState.OPEN
        
        # Try to call success function - should be rejected
        with pytest.raises(CircuitOpenError) as exc_info:
            asyncio.run(breaker.call(success_func))
        
        assert exc_info.value.name == "test"
        assert exc_info.value.retry_after > 0

    def test_rejects_calls_at_half_open_limit(self):
        """Half-open circuit should reject after max test calls."""
        config = CircuitBreakerConfig(
            failure_threshold=1,
            timeout_seconds=0.1,
            half_open_max_calls=1,
        )
        breaker = CircuitBreaker("test", config)
        
        async def slow_success():
            await asyncio.sleep(0.05)
            return "success"
        
        # Fail to open circuit
        async def fail():
            raise ValueError("test error")
        
        with pytest.raises(ValueError):
            asyncio.run(breaker.call(fail))
        
        # Wait for half-open
        time.sleep(0.15)
        assert breaker.state == CircuitState.HALF_OPEN
        
        # First call should work
        asyncio.run(breaker.call(slow_success))
        
        # Second call should be rejected (hit max calls)
        with pytest.raises(CircuitOpenError):
            asyncio.run(breaker.call(slow_success))


class TestCircuitStats:
    """Test statistics tracking."""

    def test_tracks_total_calls(self):
        """Should track total number of calls."""
        breaker = CircuitBreaker("test")
        
        async def success():
            return "ok"
        
        for _ in range(5):
            asyncio.run(breaker.call(success))
        
        assert breaker.stats.total_calls == 5
        assert breaker.stats.successful_calls == 5

    def test_tracks_failed_calls(self):
        """Should track failed calls."""
        breaker = CircuitBreaker("test")
        
        async def fail():
            raise ValueError("error")
        
        for _ in range(3):
            with pytest.raises(ValueError):
                asyncio.run(breaker.call(fail))
        
        assert breaker.stats.failed_calls == 3

    def test_tracks_rejected_calls(self):
        """Should track calls rejected while open."""
        config = CircuitBreakerConfig(failure_threshold=1, timeout_seconds=60.0)
        breaker = CircuitBreaker("test", config)
        
        async def fail():
            raise ValueError("error")
        
        async def success():
            return "ok"
        
        # Fail to open
        with pytest.raises(ValueError):
            asyncio.run(breaker.call(fail))
        
        # Try 3 calls while open
        for _ in range(3):
            with pytest.raises(CircuitOpenError):
                asyncio.run(breaker.call(success))
        
        assert breaker.stats.rejected_calls == 3

    def test_tracks_state_changes(self):
        """Should track state transitions."""
        config = CircuitBreakerConfig(failure_threshold=1, timeout_seconds=0.1)
        breaker = CircuitBreaker("test", config)
        
        async def fail():
            raise ValueError("error")
        
        # CLOSED → OPEN (1 change)
        with pytest.raises(ValueError):
            asyncio.run(breaker.call(fail))
        
        assert breaker.stats.state_changes == 1
        
        # Wait for OPEN → HALF_OPEN (2 changes)
        time.sleep(0.15)
        _ = breaker.state  # Trigger state check
        assert breaker.stats.state_changes == 2


class TestCircuitBreakerReset:
    """Test manual reset functionality."""

    def test_manual_reset(self):
        """Should allow manual reset to closed state."""
        config = CircuitBreakerConfig(failure_threshold=1, timeout_seconds=60.0)
        breaker = CircuitBreaker("test", config)
        
        async def fail():
            raise ValueError("error")
        
        # Fail to open
        with pytest.raises(ValueError):
            asyncio.run(breaker.call(fail))
        
        assert breaker.state == CircuitState.OPEN
        
        # Manual reset
        breaker.reset()
        
        assert breaker.state == CircuitState.CLOSED
        assert breaker._failure_count == 0


class TestAsyncVsSyncFunctions:
    """Test circuit breaker with both async and sync functions."""

    def test_async_function(self):
        """Should work with async functions."""
        breaker = CircuitBreaker("test")
        
        async def async_func():
            await asyncio.sleep(0.01)
            return "async result"
        
        result = asyncio.run(breaker.call(async_func))
        assert result == "async result"

    def test_sync_function(self):
        """Should work with sync functions."""
        breaker = CircuitBreaker("test")
        
        def sync_func():
            return "sync result"
        
        result = asyncio.run(breaker.call(sync_func))
        assert result == "sync result"


class TestRetryAfterCalculation:
    """Test retry_after calculation."""

    def test_retry_after_decreases_over_time(self):
        """retry_after should decrease as time passes."""
        config = CircuitBreakerConfig(failure_threshold=1, timeout_seconds=1.0)
        breaker = CircuitBreaker("test", config)
        
        async def fail():
            raise ValueError("error")
        
        # Fail to open
        with pytest.raises(ValueError):
            asyncio.run(breaker.call(fail))
        
        # Get initial retry_after
        with pytest.raises(CircuitOpenError) as exc1:
            asyncio.run(breaker.call(lambda: "test"))
        initial_retry = exc1.value.retry_after
        
        assert initial_retry > 0
        assert initial_retry <= 1.0
        
        # Wait and check again
        time.sleep(0.5)
        
        with pytest.raises(CircuitOpenError) as exc2:
            asyncio.run(breaker.call(lambda: "test"))
        later_retry = exc2.value.retry_after
        
        assert later_retry < initial_retry
