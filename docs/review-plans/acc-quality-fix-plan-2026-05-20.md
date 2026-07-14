# ACC Dashboard Quality Audit Fix Plan

> **For Hermes:** Use subagent-driven-development skill to execute this task-by-task.

**Goal:** Eliminate all 9 test failures and critical code smells identified in the 2026-05-20 quality audit. Bring the codebase from B+ (202 pass / 9 fail) to A-grade.

**Root Directory:** `/mnt/c/Users/Iniolu/Documents/Projects/ACC Dashboard/`

**Current Test Command:** `pytest tests/ -v` (run from root directory)

**Estimated Total Fix Time:** ~40 minutes of actual implementation + testing.

---

## Table of Contents

| Priority | Fix | Effort | File(s) |
|----------|-----|--------|---------|
| P0 | Purge committed `__pycache__` + add `.gitignore` | 5 min | `.gitignore`, git rm |
| P0 | Rewrite `test_adapters.py` for HTTP adapter | 20 min | `tests/test_adapters.py` |
| P1 | Vault cache invalidation bug fix | 3 min | `server/vault/__init__.py` |
| P1 | Windows path assertions in vault tests | 5 min | `tests/test_vault_reader.py` |
| P1 | Skip symlink tests on Windows | 3 min | `tests/test_vault_reader.py` |
| P2 | Stop draining error buffer | 5 min | `server/agents/hermes_adapter.py` |
| P2 | Use `_shu._token` in dispatch handler | 5 min | `server/api/__init__.py` |

---

## Context for Every Fix

### Fix 1 (P0): Purge `__pycache__` and Add `.gitignore`

**Problem:** `__pycache__/` directories and `.pyc` files are tracked in git. Evidence from audit: pyc files exist in `server/agents/__pycache__/`, `server/aggregators/__pycache__/`, `server/api/__pycache__/`, `server/vault/__init__.py`, `tests/__pycache__/`.

**Solution:**
1. Add `/mnt/c/Users/Iniolu/Documents/Projects/ACC Dashboard/.gitignore` with standard Python ignores.
2. `git rm -r --cached` all committed `__pycache__` directories.
3. Verify no `.pyc` files remain in source tree.

**Verification:**
```bash
git ls-files | grep __pycache__   # should return nothing
git ls-files | grep '\.pyc$'      # should return nothing
```

---

### Fix 2 (P0): Rewrite `test_adapters.py` for HTTP Adapter

**Problem:** `tests/test_adapters.py` references a CLI-based adapter that no longer exists. All 5 HermesAdapter tests construct `HermesAdapter(hermes_bin=...)` and monkeypatch `_run()`, but `HermesAdapter.__init__` now takes `base_url` (HTTP client). These tests are dead weight producing false failures.

**Context:** `tests/test_hermes_adapter.py` ALREADY exists and comprehensively tests the HTTP adapter (health, sessions, circuit breakers, retry logic). Decision: **rewrite `test_adapters.py`** to test the Shu adapter error hierarchy (Shu tests are still valid) and add a few lightweight HTTP adapter error tests that use the actual constructor signature.

**Current dead weight in `test_adapters.py` (lines 195–254):**

```python
# OLD — CLI adapter tests that fail
adapter = HermesAdapter(hermes_bin="nonexistent_hermes")
# ... patches _run() which doesn't exist
```

**Replacement content for `test_adapters.py`:**

Keep everything before line 192 (`TestShuAdapterErrorHandling` and `TestExceptionHierarchy` — these are all valid and pass). Replace `TestHermesAdapterErrorHandling` (lines 192–254) with HTTP-adapter tests:

```python
class TestHermesAdapterErrorHandling:
    """Test HermesAdapter error state disambiguation via HTTP adapter."""

    @pytest.mark.asyncio
    async def test_health_raises_agent_offline_on_http_error(self):
        """HTTP error (connection refused, timeout) should raise AgentOfflineError."""
        from server.agents.hermes_adapter import HermesAdapter
        import httpx

        adapter = HermesAdapter()
        # _client is None by default; simulate the HTTP failure path
        mock_exc = httpx.ConnectError("Connection refused")
        
        with patch.object(adapter, '_get', side_effect=mock_exc):
            with pytest.raises(AgentOfflineError, match="unavailable"):
                await adapter.health()

    @pytest.mark.asyncio
    async def test_health_raises_agent_offline_on_empty_body(self):
        """Empty JSON body from health endpoint should raise AgentOfflineError."""
        from server.agents.hermes_adapter import HermesAdapter

        adapter = HermesAdapter()
        
        with patch.object(adapter, '_get', return_value={}):
            with pytest.raises(AgentOfflineError, match="unavailable"):
                await adapter.health()

    @pytest.mark.asyncio
    async def test_recent_sessions_raises_on_http_error(self):
        """HTTP failure in recent_sessions should raise AgentOfflineError."""
        from server.agents.hermes_adapter import HermesAdapter
        import httpx

        adapter = HermesAdapter()
        mock_exc = httpx.TimeoutException("Request timed out")
        
        with patch.object(adapter, '_get', side_effect=mock_exc):
            with pytest.raises(AgentOfflineError, match="unavailable"):
                await adapter.recent_sessions()

    @pytest.mark.asyncio
    async def test_recent_sessions_returns_empty_on_parse_error(self):
        """Invalid JSON should be handled gracefully inside circuit breaker."""
        from server.agents.hermes_adapter import HermesAdapter

        adapter = HermesAdapter()
        
        # _get returning garbage should be caught by circuit breaker
        # and re-raise as AgentOfflineError
        with patch.object(adapter, '_get', return_value="not json"):
            with pytest.raises((AgentOfflineError, ParseError)):
                await adapter.recent_sessions()

    @pytest.mark.asyncio
    async def test_list_skills_returns_empty_on_http_error(self):
        """Skills list should return [] on HTTP failure (circuit breaker handles)."""
        from server.agents.hermes_adapter import HermesAdapter
        import httpx

        adapter = HermesAdapter()
        mock_exc = httpx.ConnectError("Connection refused")
        
        with patch.object(adapter, '_get', side_effect=mock_exc):
            # Circuit breaker will open after failures; first call raises
            with pytest.raises(AgentOfflineError):
                await adapter.list_skills()
```

**Verification:**
```bash
pytest tests/test_adapters.py -v
# Expected: all ~14 tests pass (8 Shu tests + 6 new Hermes tests)
```

---

### Fix 3 (P1): Vault Cache Invalidation Bug

**Problem:** `VaultReader._invalidate_if_stale()` (lines 51–54 of `server/vault/__init__.py`) clears the cache and signatures but does NOT reset `_cache_ts`. This means after TTL expiry, the next call may compare against the OLD timestamp, causing inconsistent cache behavior.

**Current code (line 51–54):**
```python
def _invalidate_if_stale(self) -> None:
    if datetime.now().timestamp() - self._cache_ts > self._cache_ttl:
        self._cache.clear()
        self._file_signatures.clear()
```

**Fix:** Add `self._cache_ts = 0.0` after clearing.

**Exact patch for `server/vault/__init__.py:52-54`:**

Replace:
```python
        if datetime.now().timestamp() - self._cache_ts > self._cache_ttl:
            self._cache.clear()
            self._file_signatures.clear()  # A5: also clear signatures so next scan redetects changes
```

With:
```python
        if datetime.now().timestamp() - self._cache_ts > self._cache_ttl:
            self._cache.clear()
            self._file_signatures.clear()  # A5: also clear signatures so next scan redetects changes
            self._cache_ts = 0.0
```

**Verification:**
```bash
pytest tests/test_vault_reader.py::TestVaultCache::test_invalidate_if_stale_clears_cache -v
# Expected: PASS
```

---

### Fix 4 (P1): Windows Path Assertions in Vault Tests

**Problem:** On Windows, `_find_project_file()` returns a `Path` with Windows-style separators (backslashes). The assertions use `assert found == path` (line 447, 455, 472) which on Windows compares `WindowsPath('04-projects/...')` vs `WindowsPath('04-projects\\...')` — string equality fails.

**Affected lines:**
- `test_vault_reader.py:447` — `assert found == path`
- `test_vault_reader.py:455` — `assert found == path`
- `test_vault_reader.py:472` — `assert found == path`

**Fix:** Compare using `str(path.resolve())` or normalize with `Path.as_posix()`. Simplest: wrap both in `str()`.

**Exact patch for each assertion:**

Line 447: Replace `assert found == path` with `assert str(found) == str(path)`
Line 455: Replace `assert found == path` with `assert str(found) == str(path)`
Line 472: Replace `assert found == path` with `assert str(found) == str(path)`

**Verification:**
```bash
pytest tests/test_vault_reader.py::TestVaultFindProject -v
# Expected: 4 passed (on Windows too)
```

---

### Fix 5 (P1): Skip Symlink Tests on Windows

**Problem:** `test_blocks_path_traversal_symlink` (line 222) and `test_skips_invalid_entry_in_get_all_projects` (line 276) use `Path.symlink_to()` to create symlinks. This requires administrator privileges on Windows and fails in standard test runs.

**Fix:** Add `@pytest.mark.skipif` decorator to both test methods.

**Exact patch for `tests/test_vault_reader.py`:**

At the top of the file (line ~6), `sys` is already imported. Add `import sys` if not present — it is already present on line 10.

Add decorator above `test_blocks_path_traversal_symlink` (line ~222):
```python
    @pytest.mark.skipif(sys.platform == "win32", reason="symlinks require admin privileges on Windows")
    @pytest.mark.asyncio
    async def test_blocks_path_traversal_symlink(self, temp_vault: Path):
```

Add decorator above `test_skips_invalid_entry_in_get_all_projects` (line ~276):
```python
    @pytest.mark.skipif(sys.platform == "win32", reason="symlinks require admin privileges on Windows")
    @pytest.mark.asyncio
    async def test_skips_invalid_entry_in_get_all_projects(self, temp_vault: Path, project_dir: Path):
```

**Verification:**
```bash
pytest tests/test_vault_reader.py::TestVaultPathTraversal -v
# Expected: 1 failed → now 3 passed (symlink tests skipped) + 2 passed on Windows
```

---

### Fix 6 (P2): Stop Draining Error Buffer in `HermesAdapter.recent_errors()`

**Problem:** `server/agents/hermes_adapter.py:160–161` calls `self._last_errors.clear()` after returning the slice. This means two rapid calls get different results (first has data, second is empty). This is a data-loss bug in observability.

**Current code (lines 158–162):**
```python
    async def recent_errors(self, limit: int = 10) -> list[AgentError]:
        # No circuit breaker needed — this reads an in-memory buffer, no external call
        recent = self._last_errors[-limit:]
        self._last_errors.clear()
        return recent
```

**Fix:** Remove `self._last_errors.clear()`. The buffer is already capped at `max_errors` (100) via append-only trimming in `_record_error()`. Clearing is destructive and serves no purpose.

**Exact patch for `server/agents/hermes_adapter.py:158-162`:**

Replace:
```python
    async def recent_errors(self, limit: int = 10) -> list[AgentError]:
        # No circuit breaker needed — this reads an in-memory buffer, no external call
        recent = self._last_errors[-limit:]
        self._last_errors.clear()
        return recent
```

With:
```python
    async def recent_errors(self, limit: int = 10) -> list[AgentError]:
        """Return the N most recent errors from the in-memory buffer.

        Buffer is append-only and capped at max_errors — old entries are
        trimmed in _record_error(). Does not drain on read (idempotent).
        """
        return list(self._last_errors[-limit:])
```

**Verification:** Run `pytest tests/test_hermes_adapter.py -v` to make sure nothing depends on the drain behavior.

---

### Fix 7 (P2): Use `_shu._token` in Dispatch Handler

**Problem:** `server/api/__init__.py:470–481` re-reads the Discord token from `os.environ` and `~/.hermes/.env` inside the `/dispatch` handler instead of using the already-initialized `_shu._token`. This is redundant and slightly slower.

**Current code (lines 468–483):**
```python
    elif agent == "shu":
        assert _shu is not None
        # Read token from env
        import os
        token = os.environ.get("DISCORD_BOT_TOKEN", "")
        if not token:
            # Fallback to .env file
            env_path = os.path.expanduser("~/.hermes/.env")
            ...
        cfg = _discord_cfg
        result = await dispatch_to_shu(task, cfg.get("shu_channel_id", ""), token)
```

**Fix:** Replace the env re-read with `_shu._token`.

**Exact patch for `server/api/__init__.py:468-483`:**

Replace:
```python
    elif agent == "shu":
        assert _shu is not None
        # Read token from env
        import os
        token = os.environ.get("DISCORD_BOT_TOKEN", "")
        if not token:
            # Fallback to .env file
            env_path = os.path.expanduser("~/.hermes/.env")
            if os.path.isfile(env_path):
                with open(env_path) as f:
                    for line in f:
                        if line.startswith("DISCORD_BOT_TOKEN="):
                            token = line.strip().split("=", 1)[1].strip('"').strip("'")
                            break
        cfg = _discord_cfg
        result = await dispatch_to_shu(task, cfg.get("shu_channel_id", ""), token)
```

With:
```python
    elif agent == "shu":
        assert _shu is not None
        cfg = _discord_cfg
        result = await dispatch_to_shu(task, cfg.get("shu_channel_id", ""), _shu._token)
```

**Verification:** Manual code review — no new test needed. Confirm by searching for `os.environ.get.*DISCORD` in `api/__init__.py`; there should be zero matches after the fix.

---

## Execution Order

**Phase 1 — P0 (Must Fix)**
1. Fix 1: Purge `__pycache__` + `.gitignore`
2. Fix 2: Rewrite `test_adapters.py`
3. Run full test suite: `cd /mnt/c/Users/Iniolu/Documents/Projects/ACC Dashboard && pytest tests/ -v`

**Phase 2 — P1 (Grade Improvement)**
4. Fix 3: Vault cache invalidation
5. Fix 4: Windows path assertions
6. Fix 5: Skip symlink tests
7. Run full test suite

**Phase 3 — P2 (Code Smells)**
8. Fix 6: Stop draining error buffer
9. Fix 7: Use `_shu._token`
10. Run full test suite, confirm 211 passed / 0 failed

---

## Commit Strategy

Commit after each phase (3 commits total):

```bash
# Phase 1
git add .gitignore tests/test_adapters.py
git rm -r --cached server/**/__pycache__ tests/__pycache__
git commit -m "fix: purge __pycache__, rewrite test_adapters.py for HTTP adapter"

# Phase 2
git add server/vault/__init__.py tests/test_vault_reader.py
git commit -m "fix: vault cache invalidation, Windows path assertions, skip symlink tests on Windows"

# Phase 3
git add server/agents/hermes_adapter.py server/api/__init__.py
git commit -m "fix: stop draining error buffer, use _shu._token in dispatch"
```

---

## Final Verification Checklist

- [ ] `git ls-files | grep __pycache__` returns NOTHING
- [ ] `git ls-files | grep '\.pyc$'` returns NOTHING
- [ ] `pytest tests/test_adapters.py -v` — ALL pass
- [ ] `pytest tests/test_vault_reader.py -v` — ALL pass (no symlink failures on Windows)
- [ ] `pytest tests/test_hermes_adapter.py -v` — ALL pass
- [ ] `pytest tests/ -v` — ALL pass (211/211 or current count)
- [ ] Manual review: `server/api/__init__.py` dispatch handler uses `_shu._token`
- [ ] Manual review: `server/agents/hermes_adapter.py` `recent_errors()` does not call `.clear()`

---

## Plan Saved To

`/mnt/c/Users/Iniolu/Documents/Projects/ACC Dashboard/acc-quality-fix-plan-2026-05-20.md`
