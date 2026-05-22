# P1-C: Error State Disambiguation — Implementation Complete

**Date:** May 17, 2026  
**Status:** ✅ Complete  
**Tests:** 19/19 passing

---

## Summary

Implemented explicit exception hierarchy to distinguish between "truly empty data" vs "fetch failed" across all agent adapters. This prevents silent failures and enables proper error handling in UI and retry logic.

---

## Exception Hierarchy

```
Exception
├── DataUnavailableError (retryable)
│   ├── RateLimitError (429, with retry_after_seconds)
│   ├── ConnectionError (timeout, DNS, refused)
│   └── AgentOfflineError (agent unreachable)
├── AuthenticationError (401, 403 - NOT retryable)
└── ParseError (malformed JSON/schema)
```

### Key Design Decisions

1. **DataUnavailableError** is the base for all retryable errors
   - Callers can catch this single exception to implement retry loops
   - Subclasses provide specific error details

2. **AuthenticationError** is standalone (NOT retryable)
   - Auth failures require user intervention (fix token)
   - Should never be retried automatically

3. **ParseError** is standalone (NOT retryable)
   - Indicates bug in adapter or API schema change
   - Requires code fix, not retry

4. **RateLimitError** includes `retry_after_seconds`
   - Extracted from Discord `Retry-After` header
   - Enables intelligent backoff

---

## Changes Made

### 1. `server/models/__init__.py`

Added exception classes:
- `DataUnavailableError` - base for retryable errors
- `RateLimitError` - 429 with retry_after
- `ConnectionError` - network failures
- `AuthenticationError` - auth failures
- `ParseError` - JSON/schema parsing failures
- `AgentOfflineError` - agent unreachable

### 2. `server/agents/shu_adapter.py`

**Before:**
```python
async def health(self) -> AgentStatus:
    if not self._token:
        return AgentStatus(status="offline")  # Silent failure
    
    if resp.status_code == 429:
        return AgentStatus(status="degraded")  # No retry_after
    
    if resp.is_error:
        return AgentStatus(status="offline")  # All errors same
```

**After:**
```python
async def health(self) -> AgentStatus:
    if not self._token:
        raise AuthenticationError("No Discord bot token")
    
    if resp.status_code == 429:
        retry_after = int(resp.headers.get("Retry-After", "60"))
        raise RateLimitError("rate limited", retry_after_seconds=retry_after)
    
    if resp.status_code in (401, 403):
        raise AuthenticationError("auth failed")
    
    if resp.is_error:
        raise AgentOfflineError("API error")
```

**`recent_sessions()` changes:**
- Raises `RateLimitError` with retry_after on 429
- Raises `AuthenticationError` on 401/403
- Raises `ConnectionError` on network failures
- Raises `ParseError` on JSON parsing failures
- No longer returns `[]` silently on errors

### 3. `server/agents/hermes_adapter.py`

**Before:**
```python
async def health(self) -> AgentStatus:
    raw = self._run("status", "--all")
    online = "Gateway Service" in raw and "running" in raw
    return AgentStatus(status="online" if online else "offline")
```

**After:**
```python
async def health(self) -> AgentStatus:
    try:
        raw = self._run("status", "--all")
    except Exception as exc:
        raise ConnectionError(f"Hermes CLI unavailable: {exc}")
    
    if not raw:
        raise AgentOfflineError("CLI returned empty output")
    
    if not online:
        raise AgentOfflineError("Gateway Service is not running")
    
    return AgentStatus(status="online", ...)
```

**`recent_sessions()` changes:**
- Raises `ConnectionError` if CLI unavailable
- Raises `AgentOfflineError` if empty output
- No longer returns `[]` silently

### 4. `tests/test_adapters.py` (NEW)

19 tests covering:
- Exception hierarchy and inheritance
- Shu adapter error handling (429, 401, timeout, parse errors)
- Hermes adapter error handling (CLI not found, empty output, gateway down)
- Caller patterns for distinguishing empty vs error states
- Retry patterns for DataUnavailableError
- Non-retry patterns for AuthenticationError

---

## Caller Patterns

### Pattern 1: Distinguish Empty vs Error

```python
try:
    sessions = await adapter.recent_sessions()
    # Process sessions (may be empty list)
except DataUnavailableError:
    # Show "temporarily unavailable" UI
    # Keep cached data if available
except AuthenticationError:
    # Alert user to fix token
    sessions = None
```

### Pattern 2: Retry Loop for Transient Errors

```python
max_retries = 3
for attempt in range(max_retries):
    try:
        data = await adapter.recent_sessions()
        break
    except RateLimitError as exc:
        if exc.retry_after_seconds:
            await asyncio.sleep(exc.retry_after_seconds)
        else:
            await asyncio.sleep(2 ** attempt)  # Exponential backoff
    except DataUnavailableError:
        if attempt == max_retries - 1:
            raise
        await asyncio.sleep(2 ** attempt)
```

### Pattern 3: Don't Retry Auth Errors

```python
try:
    data = await adapter.recent_sessions()
except AuthenticationError:
    # Don't retry - alert user
    log_error("Auth failed, user must fix token")
    raise
except DataUnavailableError:
    # CAN retry
    await retry_later()
```

---

## Test Results

```
============================= 19 passed in 1.86s ==============================
TestExceptionHierarchy::test_data_unavailable_error_is_base PASSED
TestExceptionHierarchy::test_authentication_error_is_standalone PASSED
TestExceptionHierarchy::test_parse_error_is_standalone PASSED
TestExceptionHierarchy::test_catch_data_unavailable_catches_subclasses PASSED
TestExceptionHierarchy::test_rate_limit_error_has_retry_after PASSED
TestShuAdapterErrorHandling::test_health_raises_auth_error_on_missing_token PASSED
TestShuAdapterErrorHandling::test_health_raises_rate_limit_on_429 PASSED
TestShuAdapterErrorHandling::test_health_raises_auth_error_on_401 PASSED
TestShuAdapterErrorHandling::test_health_raises_connection_error_on_timeout PASSED
TestShuAdapterErrorHandling::test_recent_sessions_raises_on_429 PASSED
TestShuAdapterErrorHandling::test_recent_sessions_raises_on_parse_error PASSED
TestHermesAdapterErrorHandling::test_health_raises_on_cli_not_found PASSED
TestHermesAdapterErrorHandling::test_health_raises_on_empty_output PASSED
TestHermesAdapterErrorHandling::test_health_raises_when_gateway_not_running PASSED
TestHermesAdapterErrorHandling::test_recent_sessions_raises_on_cli_error PASSED
TestHermesAdapterErrorHandling::test_recent_sessions_raises_on_empty_output PASSED
TestErrorHandlingPatterns::test_caller_can_distinguish_empty_vs_error PASSED
TestErrorHandlingPatterns::test_caller_can_retry_on_data_unavailable PASSED
TestErrorHandlingPatterns::test_auth_errors_should_not_retry PASSED
```

---

## Impact

### Before P1-C
- Errors returned `[]` or `status="offline"` - indistinguishable from "no data"
- 429 rate limits detected but not properly handled (no retry_after)
- Silent failures dominated - operators couldn't diagnose issues
- UI couldn't distinguish "no sessions" from "fetch failed"

### After P1-C
- Explicit exceptions for each failure mode
- 429 includes retry_after for intelligent backoff
- Callers can implement proper retry logic
- UI can show appropriate error states vs empty states
- Auth errors clearly separated from transient errors

---

## Remaining Gaps (Future Phases)

From `edge-case-review.md`, P1-C addressed:
- ✅ Empty vs error state ambiguity
- ✅ Discord 429 retry-after handling

Still pending:
- SQLite retry logic + busy timeout (P1)
- Mtime + hash delta detection (P1)
- Vault scan limit warnings (P1)
- Parallel vault indexing (P2)
- Circuit breaker for failing adapters (P2)

---

## Files Modified

| File | Change |
|------|--------|
| `server/models/__init__.py` | Added 6 exception classes |
| `server/agents/shu_adapter.py` | Raise exceptions instead of returning empty/offline |
| `server/agents/hermes_adapter.py` | Raise exceptions instead of returning empty/offline |
| `tests/test_adapters.py` | NEW - 19 tests for error handling |

---

## Next Steps

**P1-C is complete.** Continue with:
- P1: SQLite retry logic + busy timeout (ibcb_reader.py)
- P1: Vault scan limit warnings (search_engine.py)
- P1: Mtime + hash delta detection (vault/__init__.py)

Or move to P2+ features if foundation is sufficient.
