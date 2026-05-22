# ACC Dashboard - Edge Cases, Error Handling & Robustness Review

**Review Date:** May 17, 2026  
**Scope:** Critical failure modes, silent failures, and recovery gaps

---

## 1. FILE MTIME-BASED DELTA DETECTION

### Current State
- `server/vault/__init__.py`: Uses time-based cache (5-minute TTL) but **no actual mtime tracking**
- `server/aggregators/search_engine.py`: Reads `fpath.stat().st_mtime` for timestamps only
- **No delta detection exists** - full rescans happen on cache expiry

### Unhandled Failure Modes

| Issue | Severity | Risk |
|-------|----------|------|
| **Clock skew / mtime manipulation** | Medium | Files modified but mtime unchanged (touch -d, sync issues) → stale cache serves outdated data |
| **WSL filesystem quirks** | Medium | /mnt/c/ (Windows mount) has known mtime reliability issues; NTFS-WSL translation can lag |
| **Cache invalidation blind spot** | High | 5-minute window where deleted/modified files show stale state |
| **No content hash fallback** | Medium | Cannot detect when mtime is unreliable |

### Silent Failure Risks
1. `VaultReader._invalidate_if_stale()` only checks time, not actual file changes
2. If vault file is deleted between cache cycles, `get_all_projects()` returns stale data silently
3. No logging when cache invalidates - operators can't correlate data refreshes

### Recommended Fixes
```python
# Add content-hash based delta detection
def _get_file_signature(path: Path) -> str:
    """Combine mtime + size + hash of first 1KB for quick change detection."""
    stat = path.stat()
    hasher = hashlib.md5()
    try:
        with open(path, 'rb') as f:
            hasher.update(f.read(1024))
    except (OSError, IOError):
        return ""
    return f"{stat.st_mtime}:{stat.st_size}:{hasher.hexdigest()}"

# Track per-file signatures in cache
self._file_signatures: dict[str, str] = {}

def _has_changed(self, path: Path) -> bool:
    current = self._get_file_signature(path)
    previous = self._file_signatures.get(str(path))
    if current != previous:
        self._file_signatures[str(path)] = current
        return True
    return False
```

---

## 2. SQLITE WRITE FAILURES (IBCB Bridge)

### Current State
- `server/aggregators/ibcb_reader.py`: **Read-only** - no writes performed
- Basic `sqlite3.OperationalError` handling on missing tables
- Returns empty list/dict on connection failure

### Unhandled Failure Modes

| Issue | Severity | Risk |
|-------|----------|------|
| **Database locked (SQLITE_BUSY)** | High | Hermes may be writing while ACC reads → returns empty data silently |
| **Corrupted database** | High | `sqlite3.DatabaseError` not caught → crashes entire request |
| **Partial reads during writes** | Medium | Inconsistent state if read mid-transaction |
| **No retry logic** | Medium | Transient locks cause immediate failure |

### Silent Failure Risks
1. `_connect()` returns `None` when DB missing - callers get empty data with no error logged
2. `get_feed()` and `get_stats()` swallow `OperationalError` but not `DatabaseError` or `IntegrityError`
3. No distinction between "no data" vs "read failed" - both return `[]` or `{}`

### Code Gaps
```python
# Current (line 17-22):
def _connect(self) -> sqlite3.Connection | None:
    if not self._db_path.is_file():
        return None
    conn = sqlite3.connect(str(self._db_path))
    conn.row_factory = sqlite3.Row
    return conn

# Missing:
# - timeout parameter (default 5s may be too short)
# - BUSY handler
# - PRAGMA busy_timeout
# - Error logging
```

### Recommended Fixes
```python
def _connect(self) -> sqlite3.Connection | None:
    if not self._db_path.is_file():
        logger.debug(f"Bridge DB not found: {self._db_path}")
        return None
    try:
        conn = sqlite3.connect(str(self._db_path), timeout=10.0)
        conn.execute("PRAGMA busy_timeout = 10000")  # 10s wait
        conn.execute("PRAGMA journal_mode = WAL")    # Better concurrent reads
        conn.row_factory = sqlite3.Row
        return conn
    except sqlite3.DatabaseError as exc:
        logger.error(f"Bridge DB connection failed: {exc}")
        return None

# Add retry for transient failures
def get_feed(self, limit: int = 30, retries: int = 2) -> list[dict]:
    for attempt in range(retries + 1):
        conn = self._connect()
        if not conn:
            if attempt < retries:
                time.sleep(0.5 * (2 ** attempt))  # Exponential backoff
                continue
            return []
        # ... rest of logic
```

---

## 3. RATE LIMIT HANDLING (Discord 429s)

### Current State
- `server/agents/shu_adapter.py`: Detects 429 in `health()` only (line 80-87)
- Returns status="degraded" but **no retry-after handling**
- `recent_sessions()` and `dispatch_to_shu()` have **no 429 handling**

### Unhandled Failure Modes

| Issue | Severity | Risk |
|-------|----------|------|
| **No Retry-After header parsing** | High | Blind retries during rate limit window → compound failures |
| **Global vs channel limits** | Medium | Discord has both; code treats all 429s identically |
| **No exponential backoff** | High | `dispatch_to_shu()` fails immediately on 429 |
| **429 in recent_sessions()** | High | Returns `[]` silently - looks like "no messages" not "rate limited" |
| **Token bucket exhaustion** | Medium | No tracking of remaining requests |

### Silent Failure Risks
1. `recent_sessions()` line 142-143: `if resp.is_error: return []` - 429 becomes empty list
2. `dispatch_to_shu()` line 95-101: Returns error dict but no automatic retry
3. No logging when 429 occurs - operators unaware of rate limiting

### Code Gaps
```python
# Current health() (line 74-95):
if resp.status_code == 429:
    return AgentStatus(..., status="degraded", current_task="rate limited")
# Missing:
# - retry_after = resp.headers.get('Retry-After')
# - Store rate limit state for other methods to check
```

### Recommended Fixes
```python
class ShuDiscordAdapter:
    def __init__(self, ...):
        self._rate_limit_until: datetime | None = None
        self._rate_limit_remaining: int = 100
    
    def _is_rate_limited(self) -> bool:
        if self._rate_limit_until and datetime.now(timezone.utc) < self._rate_limit_until:
            return True
        self._rate_limit_until = None
        return False
    
    async def _handle_rate_limit(self, resp: httpx.Response) -> None:
        if resp.status_code == 429:
            retry_after = int(resp.headers.get('Retry-After', '60'))
            self._rate_limit_until = datetime.now(timezone.utc) + timedelta(seconds=retry_after)
            logger.warning(f"Discord rate limited until {self._rate_limit_until}")
    
    async def recent_sessions(self, limit: int = 10) -> list[AgentSession]:
        if self._is_rate_limited():
            raise RateLimitError(f"Rate limited until {self._rate_limit_until}")
        # ... existing code with 429 handling
        if resp.status_code == 429:
            await self._handle_rate_limit(resp)
            raise RateLimitError("Discord rate limit exceeded")
```

---

## 4. VAULT SCAN PERFORMANCE (662+ DOCS)

### Current State
- `server/aggregators/search_engine.py`: Limits vault scan to 500 files (line 94)
- `server/vault/__init__.py`: **No limit** - scans all project directories
- Sequential file reads, no parallelization
- 10KB content cap per file in search engine

### Unhandled Failure Modes

| Issue | Severity | Risk |
|-------|----------|------|
| **662 files exceeds 500 limit** | High | 162 files silently excluded from search index |
| **Sequential I/O bottleneck** | High | 662 files × ~50ms each = 33+ seconds for full scan |
| **No progress tracking** | Medium | Long scans appear hung; no timeout |
| **Memory growth** | Medium | All docs indexed in-memory; 662 files could be 50+ MB |
| **VaultReader has no scan limit** | Medium | get_all_projects() could scan hundreds of project dirs |

### Silent Failure Risks
1. Search engine silently drops files 501-662 - users can't find them
2. No logging when limit is hit - operators unaware of incomplete index
3. `search_engine.rebuild()` has no timeout - could block requests indefinitely
4. Large files (>10KB) truncated without warning

### Code Gaps
```python
# Current (search_engine.py line 88-122):
md_files = list(vault_root.rglob("*.md"))
for fpath in md_files[:500]:  # Hard limit, no warning
    # ...
counts["vault"] = vault_count  # Reports count but not that it's capped

# Missing:
# - Warning when files are skipped
# - Configurable limit
# - Parallel processing
# - Timeout on rebuild()
```

### Recommended Fixes
```python
async def rebuild(self) -> dict[str, int]:
    # ... existing code
    
    # Parallel vault indexing
    vault_count = 0
    if self._vault_path and Path(self._vault_path).is_dir():
        vault_root = Path(self._vault_path)
        md_files = list(vault_root.rglob("*.md"))
        
        # Warn if exceeding limit
        if len(md_files) > 500:
            logger.warning(f"Vault has {len(md_files)} files, indexing first 500 only")
        
        # Parallel processing with semaphore
        semaphore = asyncio.Semaphore(10)  # Max 10 concurrent reads
        
        async def index_file(fpath: Path) -> dict | None:
            async with semaphore:
                try:
                    # ... existing indexing logic
                    return {"doc_id": ..., "metadata": ...}
                except Exception as exc:
                    logger.error(f"Failed to index {fpath}: {exc}")
                    return None
        
        tasks = [index_file(f) for f in md_files[:500]]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        vault_count = sum(1 for r in results if r is not None)
    
    counts["vault"] = vault_count
    counts["vault_skipped"] = max(0, len(md_files) - 500)  # Report skipped
    return counts
```

---

## 5. EMPTY DATA STATES

### Current State
- Inconsistent handling across modules
- Some return `[]`, some return `{}`, some raise exceptions
- No distinction between "empty" vs "error"

### Unhandled Failure Modes

| Issue | Severity | Risk |
|-------|----------|------|
| **Empty = Error ambiguity** | High | Can't tell if no sessions exist or fetch failed |
| **Cascading empty states** | High | One failure → empty list → downstream shows "no data" |
| **No sentinel values** | Medium | No way to signal "data unavailable" vs "truly empty" |
| **UI shows stale data** | Medium | If API returns empty on error, UI may clear valid cached data |

### Silent Failure Risks by Module

| Module | Empty Return | Actual Failure Mode |
|--------|--------------|---------------------|
| `hermes_adapter.recent_sessions()` | `[]` | CLI not found, timeout, parse error - all same output |
| `shu_adapter.recent_sessions()` | `[]` | 429, 401, network error - all same output |
| `ibcb_reader.get_feed()` | `[]` | DB missing, locked, corrupted - all same output |
| `vault_reader.get_all_projects()` | `[]` | Path invalid, no projects, parse error - all same output |
| `activity_engine.get_timeline()` | `[]` | All agents fail - looks like "no activity" |

### Recommended Fixes
```python
# Option 1: Typed result wrapper
from typing import Generic, TypeVar
from dataclasses import dataclass

T = TypeVar('T')

@dataclass
class DataResult(Generic[T]):
    data: T
    success: bool
    error: str | None = None
    is_stale: bool = False  # Cache fallback

# Usage:
async def recent_sessions(self, limit: int = 10) -> DataResult[list[AgentSession]]:
    try:
        sessions = await self._fetch()
        return DataResult(data=sessions, success=True)
    except ConnectionError as exc:
        return DataResult(data=[], success=False, error=str(exc), is_stale=True)

# Option 2: Explicit exception hierarchy
class DataUnavailableError(Exception): pass
class RateLimitError(DataUnavailableError): pass
class ParseError(Exception): pass

# Then callers can distinguish:
try:
    sessions = await adapter.recent_sessions()
except DataUnavailableError:
    # Show "temporarily unavailable" UI
except ParseError:
    # Log bug, show empty state
```

---

## ADDITIONAL CRITICAL GAPS

### 6. Hermes CLI Not in PATH (Known Issue)
- `hermes_adapter._run()` catches `FileNotFoundError` but returns `""`
- `dispatch_to_arete()` returns error dict but no fallback
- **Risk:** Entire ARETE integration silently disabled

### 7. No Circuit Breaker Pattern
- Repeated failures don't trigger cooldown
- Failed agents polled continuously, wasting resources
- **Recommendation:** Add simple circuit breaker with 3-failure threshold

### 8. Missing Health Check Aggregation
- `activity_engine.get_timeline()` has bare `except Exception: pass` for cron jobs
- Errors swallowed, no visibility into partial failures

### 9. No Request Timeouts on API Endpoints
- FastAPI routes don't specify timeouts
- Long-running `search_engine.rebuild()` could block indefinitely

### 10. Token/Secret Handling
- Discord token read from env or `~/.hermes/.env`
- No validation, no expiry handling
- Token errors show as generic "offline" status

---

## PRIORITY RECOMMENDATIONS

| Priority | Issue | Effort | Impact |
|----------|-------|--------|--------|
| **P0** | Add Discord 429 retry-after handling | Low | High |
| **P0** | Distinguish empty vs error states | Medium | High |
| **P1** | Add SQLite retry logic + busy timeout | Low | Medium |
| **P1** | Log when vault scan limit is hit | Low | Medium |
| **P1** | Add mtime + hash delta detection | Medium | Medium |
| **P2** | Parallel vault indexing | Medium | Medium |
| **P2** | Circuit breaker for failing adapters | Medium | Low |
| **P3** | Request timeouts on API endpoints | Low | Low |

---

## FILES REQUIRING CHANGES

1. `server/agents/shu_adapter.py` - 429 handling, error differentiation
2. `server/agents/hermes_adapter.py` - Error state clarity
3. `server/aggregators/ibcb_reader.py` - SQLite retry, error logging
4. `server/aggregators/search_engine.py` - Vault limit warnings, parallel processing
5. `server/vault/__init__.py` - Mtime-based delta detection
6. `server/aggregators/activity_engine.py` - Error propagation, not swallowing
7. `server/models/__init__.py` - Add error state types
8. `server/api/__init__.py` - Request timeouts (not yet reviewed)

---

## SUMMARY

The ACC Dashboard has **basic error handling** but lacks **robustness patterns** for production use. Key risks:

1. **Silent failures dominate** - Most errors return empty data, indistinguishable from "no data"
2. **Rate limiting is incomplete** - Discord 429s detected but not properly handled
3. **No delta detection** - Vault rescans are inefficient and time-based cache is unreliable
4. **Performance cliffs** - 662+ files will cause slow scans with no progress visibility
5. **SQLite fragility** - No retry logic for transient database locks

**Immediate actions:** Implement 429 retry-after, add error/empty differentiation, log when limits are hit.
