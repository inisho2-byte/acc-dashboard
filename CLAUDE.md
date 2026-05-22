# ACC Dashboard — Claude Code Context

## Architecture
- **Backend**: FastAPI (Python 3.11+) — `server/` directory
- **Frontend**: Vite + React — `web/` directory
- **Agent adapters**: `server/agents/` — each implements `AgentAdapter` ABC from `server/agents/__init__.py`
- **Aggregators**: `server/aggregators/` — data readers (filesystem, HTTP, vault)
- **Models**: `server/models/__init__.py` — Pydantic models shared across all modules

## Key Patterns
- AgentAdapter ABC requires: `agent_id`, `agent_type`, `display_name`, `health()`, `recent_sessions()`, `recent_errors()`
- ClaudeCodeAdapter delegates ALL I/O to ClaudeCodeReader (filesystem-only, no HTTP API)
- Windows/WSL path duality: `normalize_windows_path()` in `claude_code_reader.py` converts `C:\Users\...` to `/mnt/c/Users/...`
- Path sandboxing: `safe_claude_path()` enforces deny lists and traversal protection
- Secret redaction: `server/utils/secret_redaction.py` applied to all served content

## Commands
```bash
# Install (from project root)
uv venv .venv --python 3.12 && uv pip install -e ".[dev]"

# Run tests
.venv\Scripts\python -m pytest tests/ -v

# Run server locally
.venv\Scripts\python -m uvicorn server.main:app --port 8643

# Lint
.venv\Scripts\python -m ruff check server/ tests/
```

## Windows Notes
- Symlink tests are skipped on Windows (`@pytest.mark.skipif`)
- Use `.venv\Scripts\python.exe` not `.venv/bin/python`
- Paths in tests: use `Path` objects, compare with `str()` or `resolve()`