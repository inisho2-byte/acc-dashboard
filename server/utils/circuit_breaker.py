from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Callable, TypeVar, Generic

logger = logging.getLogger(__name__)

T = TypeVar("T")


class CircuitState(Enum):
    CLOSED = "closed"      # Normal operation, requests flow through
    OPEN = "open"          # Failing, requests blocked
    HALF_OPEN = "half_open"  # Testing if service recovered


@dataclass
class CircuitBreakerConfig:
    """Configuration for circuit breaker behavior."""
    failure_threshold: int = 3        # Failures before opening circuit
    success_threshold: int = 2        # Successes before closing circuit (half-open)
    timeout_seconds: float = 60.0     # How long circuit stays open
    half_open_max_calls: int = 1      # Max test calls in half-open state


@dataclass
class CircuitStats:
    """Statistics for circuit breaker monitoring."""
    total_calls: int = 0
    successful_calls: int = 0
    failed_calls: int = 0
    rejected_calls: int = 0  # Calls rejected while open
    last_failure_time: float | None = None
    last_success_time: float | None = None
    state_changes: int = 0


class CircuitBreaker(Generic[T]):
    """Circuit breaker pattern implementation for failing services.
    
    States:
    - CLOSED: Normal operation. Track failures, open circuit on threshold.
    - OPEN: Reject all calls immediately. Transition to HALF_OPEN after timeout.
    - HALF_OPEN: Allow limited test calls. Close on success threshold, open on failure.
    
    Usage:
        breaker = CircuitBreaker("shu_adapter", CircuitBreakerConfig())
        
        async def fetch():
            return await breaker.call(shu_adapter.recent_sessions)
        
        # Or with custom error handling:
        try:
            result = await breaker.call(fetch_data)
        except CircuitOpenError:
            # Use cached data or show "unavailable"
            pass
    """
    
    def __init__(
        self,
        name: str,
        config: CircuitBreakerConfig | None = None,
    ) -> None:
        self.name = name
        self.config = config or CircuitBreakerConfig()
        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._success_count = 0
        self._last_failure_time: float | None = None
        self._stats = CircuitStats()
        self._half_open_calls = 0
    
    @property
    def state(self) -> CircuitState:
        """Get current state, checking for timeout-based transitions."""
        if self._state == CircuitState.OPEN:
            if self._should_attempt_reset():
                self._transition_to(CircuitState.HALF_OPEN)
        return self._state
    
    @property
    def stats(self) -> CircuitStats:
        """Get circuit breaker statistics."""
        return self._stats
    
    def _should_attempt_reset(self) -> bool:
        """Check if enough time has passed to try half-open."""
        if self._last_failure_time is None:
            return False
        elapsed = time.time() - self._last_failure_time
        return elapsed >= self.config.timeout_seconds
    
    def _transition_to(self, new_state: CircuitState) -> None:
        """Transition to a new state with structured logging."""
        old_state = self._state
        if old_state != new_state:
            self._state = new_state
            self._stats.state_changes += 1
            
            # Structured log entry for state change (JSON-formatted via pythonjsonlogger)
            log_extra = {
                "circuit_name": self.name,
                "old_state": old_state.value,
                "new_state": new_state.value,
                "failure_count": self._failure_count,
                "success_count": self._success_count,
                "total_calls": self._stats.total_calls,
                "failed_calls": self._stats.failed_calls,
                "rejected_calls": self._stats.rejected_calls,
                "timeout_seconds": self.config.timeout_seconds,
                "failure_threshold": self.config.failure_threshold,
            }
            
            # Log level based on transition type
            if new_state == CircuitState.OPEN:
                logger.warning(
                    f"Circuit breaker '{self.name}' OPENED - service failing",
                    extra=log_extra,
                )
            elif new_state == CircuitState.HALF_OPEN:
                logger.info(
                    f"Circuit breaker '{self.name}' HALF_OPEN - testing recovery",
                    extra=log_extra,
                )
            elif new_state == CircuitState.CLOSED:
                logger.info(
                    f"Circuit breaker '{self.name}' CLOSED - service recovered",
                    extra=log_extra,
                )
            
            # Reset counters on state change
            if new_state == CircuitState.HALF_OPEN:
                self._half_open_calls = 0
                self._success_count = 0
            elif new_state == CircuitState.CLOSED:
                self._failure_count = 0
                self._success_count = 0
    
    async def call(
        self,
        func: Callable[..., T],
        *args,
        **kwargs,
    ) -> T:
        """Execute function through circuit breaker.
        
        Args:
            func: Async function to call
            *args: Positional arguments for func
            **kwargs: Keyword arguments for func
        
        Returns:
            Result from func
        
        Raises:
            CircuitOpenError: If circuit is open (service unavailable)
            Exception: Any exception from func (and records failure)
        """
        self._stats.total_calls += 1
        
        # Check circuit state
        current_state = self.state
        
        if current_state == CircuitState.OPEN:
            self._stats.rejected_calls += 1
            raise CircuitOpenError(
                f"Circuit '{self.name}' is OPEN - service unavailable",
                name=self.name,
                retry_after=self._get_retry_after(),
            )
        
        if current_state == CircuitState.HALF_OPEN:
            if self._half_open_calls >= self.config.half_open_max_calls:
                self._stats.rejected_calls += 1
                raise CircuitOpenError(
                    f"Circuit '{self.name}' is HALF_OPEN - max test calls reached",
                    name=self.name,
                    retry_after=self._get_retry_after(),
                )
            self._half_open_calls += 1
        
        # Execute the function
        try:
            if asyncio.iscoroutinefunction(func):
                result = await func(*args, **kwargs)
            else:
                result = func(*args, **kwargs)
            
            # Success
            self._on_success()
            return result
            
        except Exception as exc:
            # Failure
            self._on_failure()
            raise
    
    def _on_success(self) -> None:
        """Handle successful call."""
        self._stats.successful_calls += 1
        self._stats.last_success_time = time.time()
        self._success_count += 1
        
        if self._state == CircuitState.HALF_OPEN:
            if self._success_count >= self.config.success_threshold:
                self._transition_to(CircuitState.CLOSED)
    
    def _on_failure(self) -> None:
        """Handle failed call."""
        self._stats.failed_calls += 1
        self._stats.last_failure_time = time.time()
        self._failure_count += 1
        self._last_failure_time = time.time()
        
        if self._state == CircuitState.HALF_OPEN:
            # Any failure in half-open immediately opens circuit
            self._transition_to(CircuitState.OPEN)
        elif self._state == CircuitState.CLOSED:
            if self._failure_count >= self.config.failure_threshold:
                self._transition_to(CircuitState.OPEN)
    
    def _get_retry_after(self) -> float:
        """Get seconds until circuit might allow requests again."""
        if self._last_failure_time is None:
            return 0.0
        elapsed = time.time() - self._last_failure_time
        return max(0.0, self.config.timeout_seconds - elapsed)
    
    def reset(self) -> None:
        """Manually reset circuit to closed state."""
        self._transition_to(CircuitState.CLOSED)
        self._failure_count = 0
        self._success_count = 0
        self._half_open_calls = 0
        logger.info(f"Circuit breaker '{self.name}' manually reset")


class CircuitOpenError(Exception):
    """Raised when circuit breaker is open and rejecting calls."""
    
    def __init__(
        self,
        message: str,
        name: str = "",
        retry_after: float = 0.0,
    ) -> None:
        super().__init__(message)
        self.name = name
        self.retry_after = retry_after  # Seconds until might retry


# ── Convenience decorator ──────────────────────────────────────────────

def with_circuit_breaker(
    name: str,
    config: CircuitBreakerConfig | None = None,
) -> Callable:
    """Decorator to wrap async function with circuit breaker.
    
    Usage:
        @with_circuit_breaker("shu_adapter")
        async def fetch_sessions():
            return await adapter.recent_sessions()
    """
    breaker = CircuitBreaker(name, config)
    
    def decorator(func: Callable) -> Callable:
        async def wrapper(*args, **kwargs):
            return await breaker.call(func, *args, **kwargs)
        wrapper.circuit_breaker = breaker  # Expose for testing/monitoring
        return wrapper
    
    return decorator
