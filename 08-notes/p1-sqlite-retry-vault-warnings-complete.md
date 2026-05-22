# P1: SQLite Retry + Vault Scan Warnings — Implementation Complete

**Date:** May 17, 2026  
**Status:** ✅ Complete  
**Tests:** 40/40 passing (all existing tests preserved)

---

## Summary

Completed remaining P1 items from `edge-case-review.md`:
1. **SQLite retry logic** for IBCB bridge reader (handles transient database locks)
2. **Vault scan limit warnings** for search engine (logs when files are skipped)

---

## Changes Made

### 1. `server/aggregators/ibcb_reader.py` — SQLite Retry Logic

**Problem:** Bridge DB reads would fail silently when Hermes was writing, returning empty data with no visibility.

**Solution:** Added retry logic with exponential backoff for `SQLITE_BUSY` errors.

#### Changes:

**`_connect()` method:**
- Added `retries` parameter (default: 2)
- Sets `PRAGMA busy_timeout = 10000` (10s wait for locks)
- Sets `PRAGMA journal_mode = WAL` (better concurrent reads)
- Retries on "database is locked" errors with exponential backoff (0.5s, 1s)
- Logs warnings on retry, errors on permanent failure
- Catches `DatabaseError` for corruption detection

**`get_feed()` method:**
- Logs debug message when DB unavailable
- Logs `ERROR` on query failures (was silent `pass`)
- Logs `DEBUG` on payload parse failures (expected occasionally)
- Distinguishes `OperationalError` (transient) from `DatabaseError` (corruption)

**`get_stats()` method:**
- Same error logging pattern as `get_feed()`
- Each query failure logged separately for diagnosis

#### Code Example:

```python
def _connect(self, retries: int = 2) -> sqlite3.Connection | None:
    if not self._db_path.is_file():
        logger.debug(f"Bridge DB not found: {self._db_path}")
        return None
    
    attempt = 0
    while attempt <= retries:
        try:
            conn = sqlite3.connect(str(self._db_path), timeout=10.0)
            conn.execute("PRAGMA busy_timeout = 10000")  # 10s wait
            conn.execute("PRAGMA journal_mode = WAL")    # Better concurrent reads
            conn.row_factory = sqlite3.Row
            return conn
        except sqlite3.OperationalError as exc:
            error_msg = str(exc).lower()
            if "database is locked" in error_msg or "busy" in error_msg:
                attempt += 1
                if attempt <= retries:
                    delay = 0.5 * (2 ** (attempt - 1))  # 0.5s, 1s
                    logger.warning(f"Bridge DB locked, retry {attempt}/{retries} in {delay}s")
                    time.sleep(delay)
                    continue
            logger.error(f"Bridge DB connection failed: {exc}")
            return None
        except sqlite3.DatabaseError as exc:
            logger.error(f"Bridge DB corruption/error: {exc}")
            return None
    
    return None
```

---

### 2. `server/aggregators/search_engine.py` — Vault Scan Limit Warnings

**Problem:** Vault had 662+ files but search engine silently indexed only first 500. Users couldn't find 162 files, operators had no visibility.

**Solution:** Log warning when limit is hit, report skipped count in return value.

#### Changes:

- Added `_VAULT_SCAN_LIMIT = 500` constant
- Added `logging` import and logger
- Logs `WARNING` when vault exceeds limit (includes file counts)
- Returns `vault_skipped` count in `rebuild()` return dict
- Logs `DEBUG` when truncating large files (>10KB)
- Logs `DEBUG` on individual file index failures

#### Code Example:

```python
# Warn if exceeding limit
if len(md_files) > _VAULT_SCAN_LIMIT:
    vault_skipped = len(md_files) - _VAULT_SCAN_LIMIT
    logger.warning(
        f"Vault has {len(md_files)} files, indexing first {_VAULT_SCAN_LIMIT} only "
        f"({vault_skipped} files skipped)"
    )

for fpath in md_files[:_VAULT_SCAN_LIMIT]:
    # ... indexing logic ...
    
counts["vault"] = vault_count
if vault_skipped > 0:
    counts["vault_skipped"] = vault_skipped
```

#### Return Value Change:

**Before:**
```python
{"sessions": 10, "discord": 50, "vault": 500}
```

**After (when limit hit):**
```python
{"sessions": 10, "discord": 50, "vault": 500, "vault_skipped": 162}
```

---

## Impact

### Before P1
- Bridge DB locks caused silent empty returns
- No visibility into transient database failures
- Vault scan limit was silent — 162 files missing from index
- Operators couldn't diagnose "missing data" issues

### After P1
- Bridge DB retries transient locks automatically (0.5s, 1s delays)
- All failures logged with appropriate severity (DEBUG/WARNING/ERROR)
- Vault limit warnings alert operators to incomplete indexing
- `vault_skipped` count enables monitoring/alerting
- Corruption errors distinguished from transient failures

---

## Logging Levels

| Level | When Used | Action Required |
|-------|-----------|-----------------|
| `DEBUG` | DB not found, payload parse failures, file index failures, truncation | None — expected noise |
| `WARNING` | Bridge DB locked (retrying), vault scan limit hit | Monitor — may indicate scaling issue |
| `ERROR` | DB connection failed, query failed, corruption detected | Investigate — data integrity risk |

---

## Test Results

```
============================= 40 passed in 14.97s ==============================
```

All existing tests preserved. No breaking changes to public APIs.

---

## Files Modified

| File | Lines Changed | Description |
|------|---------------|-------------|
| `server/aggregators/ibcb_reader.py` | +50, -10 | Retry logic, error logging |
| `server/aggregators/search_engine.py` | +20, -5 | Limit warnings, skipped count |

---

## Remaining Gaps (Future Phases)

From `edge-case-review.md`, P1 now complete:
- ✅ Empty vs error state ambiguity (P1-C)
- ✅ Discord 429 retry-after handling (P1-C)
- ✅ SQLite retry logic + busy timeout (P1)
- ✅ Vault scan limit warnings (P1)

Still pending (P2+):
- Mtime + hash delta detection (vault rescans)
- Parallel vault indexing (performance)
- Circuit breaker for failing adapters
- Request timeouts on API endpoints

---

## Next Steps

**P1 foundation is complete.** Ready to proceed with:
- P2+ feature builds
- Testing infrastructure (3hr)
- Or pause for review
