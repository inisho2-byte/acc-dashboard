# ACC Dashboard + Claude Code Integration — Master Plan

**Version:** 1.0  
**Date:** 2026-05-21  
**Status:** Council-Approved, Pre-Implementation

---

## 1. Architecture

### 1.1 New Files

```
server/
├── agents/
│   └── claude_code_adapter.py      # AgentAdapter ABC facade (~80 lines)
├── aggregators/
│   └── claude_code_reader.py       # Filesystem reader + cache (~400 lines)
├── utils/
│   └── secret_redaction.py         # Regex-based secret pattern redaction (~80 lines)
web/src/
├── panels/
│   └── ClaudeCodePanel.jsx         # Dedicated Claude Code tab (~500 lines)
├── components/
│   └── ClaudeSessionCard.jsx       # Session status card (~100 lines)
```

### 1.2 Modified Files

| File | Change |
|------|--------|
| `server/api/__init__.py` | Add `_claude` global, init in `init_adapters()`, add 6 new routes |
| `server/events.py` | Add `"claude"` to event source types |
| `server/models.py` | Add `ClaudeSession`, `ClaudeTask`, `ClaudePlan`, `ClaudeFileChange` models |
| `config.yaml` | Add `claude_code:` section with `data_dir`, `cache_ttl_seconds` |
| `web/src/api.js` | Add `fetchClaudeSessions()`, `fetchClaudePlans()`, etc. |
| `web/src/App.jsx` | Add `"claude-code"` tab, import panel, add to tab array |

### 1.3 Adapter Pattern

```
ClaudeCodeAdapter (AgentAdapter ABC)
  ├── health()          → reads sessions/*.json, derives online/offline
  ├── recent_sessions() → reads sessions/*.json + history.jsonl
  ├── recent_errors()   → derived from session anomalies
  ├── list_skills()     → reads skills/*/SKILL.md (allowlisted frontmatter)
  │
  └── delegates ALL filesystem I/O to ClaudeCodeReader

ClaudeCodeReader (utility)
  ├── discover_data_dir()         → checks WSL path first, then Windows mount
  ├── list_sessions()             → sessions/*.json with caching
  ├── get_session_history()       → history.jsonl filtered by sessionId
  ├── list_tasks(session_id)      → tasks/{uuid}/*.json
  ├── list_plans()                → plans/*.md
  ├── list_skills()               → skills/*/SKILL.md
  ├── get_file_history(session)   → file-history/{uuid}/*@vN
  ├── get_settings_summary()      → allowlisted fields from settings.json
  ├── safe_read()                 → path sandboxing + secret redaction
  │
  └── Uses asyncio.to_thread + Semaphore(8) for all I/O
      TTLCache per data type
```

---

## 2. Data Models

```python
class ClaudeSession(BaseModel):
    id: str                              # sessionId UUID
    agent_id: str = "claude-code"
    pid: int | None = None              # Windows PID
    cwd: str                             # normalized WSL path
    display_cwd: str                     # original Windows path for UI
    version: str | None = None           # e.g. "2.1.145"
    kind: str | None = None              # "interactive" or "daemon"
    entrypoint: str | None = None        # "cli" etc.
    status: Literal["active", "idle", "offline"]
    started_at: datetime | None = None
    updated_at: datetime | None = None
    last_prompt: str | None = None       # truncated to 80 chars, redacted
    task_count: int = 0
    has_plan: bool = False

class ClaudeTask(BaseModel):
    id: str
    session_id: str                       # UUID linking to session
    subject: str
    description: str | None = None
    active_form: str | None = None
    status: Literal["pending", "in_progress", "completed", "blocked"] = "pending"
    blocks: list[str] = []               # task IDs this blocks
    blocked_by: list[str] = []           # task IDs blocking this

class ClaudePlan(BaseModel):
    filename: str                         # e.g. "phase-2-signal-core.md"
    title: str                            # first heading
    mtime: datetime
    size_bytes: int
    content_preview: str | None = None    # first 500 chars, redacted

class ClaudeFileChange(BaseModel):
    session_id: str
    file_hash: str                        # content hash from filename
    version: int                           # @v1, @v2, etc.
    filename: str | None = None           # derived from hash if possible
    size_bytes: int
    mtime: datetime
```

---

## 3. Security Hardening

### 3.1 Hard Deny List — Never Read

```python
DENIED_SUBPATHS = {
    "daemon",              # pipe.key = IPC auth token (CRITICAL: RCE risk)
    "cache",               # internal cache
    "backups",             # may contain sensitive backups
    "paste-cache",         # user pasted content (secrets!)
    "shell-snapshots",     # shell history snapshots
    "telemetry",           # telemetry IDs
    "status-bar",          # internal status bar state
    "ide",                 # IDE connection state
}

DENIED_FILES = {
    "settings.json",       # contains permissions, bypass modes, hook commands
    "settings.local.json", # contains local permission overrides
    "pipe.key",            # daemon IPC auth token
    ".last-cleanup",       # internal state
}
```

### 3.2 Metadata-Only Paths

Session content and history entries contain full user prompts and assistant responses — never serve raw.

```python
METADATA_ONLY = {
    "sessions",         # only: id, pid, cwd, version, status, startedAt, updatedAt
    "history.jsonl",    # only: timestamp, project, sessionId, display (truncated 80 chars)
    "tasks",            # task JSON is safe (subject/status only), but sanitize description
}
```

### 3.3 Content Allowed (with redaction)

```python
CONTENT_ALLOWED = {
    "skills",    # SKILL.md with allowlisted frontmatter + redacted body
    "plans",     # markdown content with secret redaction
}
```

### 3.4 Secret Redaction

All content served from `~/.claude/` passes through `redact_secrets()`:

```python
SECRET_PATTERNS = [
    re.compile(r'(sk-[a-zA-Z0-9]{20,})'),           # OpenAI-style keys
    re.compile(r'(ghp_[a-zA-Z0-9]{36,})'),           # GitHub PATs
    re.compile(r'(glpat-[a-zA-Z0-9\-]{20,})'),       # GitLab PATs
    re.compile(r'(api[_-]?key\s*[:=]\s*["\']?[a-zA-Z0-9]{16,})', re.I),
    re.compile(r'(token\s*[:=]\s*["\']?[a-zA-Z0-9\-_\.]{20,})', re.I),
    re.compile(r'(password\s*[:=]\s*["\']?[^\s"\']{8,})', re.I),
    re.compile(r'(Bearer\s+[a-zA-Z0-9\-_\.]+)'),
    re.compile(r'(https?://[^\s"\']*?(?:key|token|secret|auth)[^\s"\']*=)[^\s"\']+'),
]
```

### 3.5 Path Sandboxing

```python
CLAUDE_DIR = Path("/mnt/c/Users/Iniolu/.claude").resolve()  # or discovered dynamically

def safe_claude_path(relative_path: str) -> Path | None:
    """Resolve a relative path within ~/.claude/ and verify it stays inside."""
    if ".." in relative_path or "\\" in relative_path:
        return None
    target = (CLAUDE_DIR / relative_path).resolve()
    try:
        target.relative_to(CLAUDE_DIR)
    except ValueError:
        return None
    # Also check against deny lists
    parts = target.relative_to(CLAUDE_DIR).parts
    if parts[0] in DENIED_SUBPATHS or target.name in DENIED_FILES:
        return None
    return target
```

### 3.6 Auth Requirement

When `claude_code` section exists in `config.yaml`, `ACC_API_TOKEN` **must** be set. Startup check:

```python
if claude_cfg and not os.environ.get("ACC_API_TOKEN"):
    logger.error("ACC_API_TOKEN must be set when Claude Code adapter is enabled")
    raise SystemExit(1)
```

---

## 4. API Surface

### 4.1 New Endpoints

| Method | Path | Description | Rate Limit |
|--------|------|-------------|-------------|
| GET | `/api/claude-code/health` | Adapter health status | 60/min |
| GET | `/api/claude-code/sessions` | List sessions with metadata | 30/min |
| GET | `/api/claude-code/sessions/{session_id}/history` | History entries for a session (redacted) | 10/min |
| GET | `/api/claude-code/tasks` | All tasks across all sessions | 30/min |
| GET | `/api/claude-code/plans` | List plan files | 30/min |
| GET | `/api/claude-code/plans/{filename}` | Full plan content (redacted) | 10/min |
| GET | `/api/claude-code/skills` | Skill registry (allowlisted fields) | 20/min |
| GET | `/api/claude-code/settings` | Allowlisted settings summary | 20/min |
| GET | `/api/claude-code/file-history/{session_id}` | File changes for a session | 10/min |

### 4.2 Response Schemas

**GET /api/claude-code/health**
```json
{
  "agent_id": "claude-code",
  "status": "online",  // "online" if sessions exist, "offline" if no data dir
  "version": "2.1.145",
  "active_sessions": 1,
  "total_sessions": 2,
  "data_dir": "/mnt/c/Users/Iniolu/.claude",
  "last_activity": "2026-05-21T00:36:00Z"
}
```

**GET /api/claude-code/sessions**
```json
[
  {
    "id": "a5faf55e-70c5-4198-90e0-ea2a4584f233",
    "pid": 5204,
    "cwd": "/mnt/c/Users/Iniolu",
    "display_cwd": "C:\\Users\\Iniolu",
    "version": "2.1.145",
    "kind": "interactive",
    "entrypoint": "cli",
    "status": "idle",
    "started_at": "2026-05-21T00:38:00Z",
    "updated_at": "2026-05-21T00:36:00Z",
    "last_prompt": "I was thinking of adding claude code to the...",
    "task_count": 3,
    "has_plan": false
  }
]
```

**GET /api/claude-code/settings**
```json
{
  "version": "2.1.145",
  "effort_level": "medium",
  "theme": "dark-daltonized",
  "auto_updates_channel": "latest",
  "hooks_count": 3,
  "permissions_summary": {
    "allowed_categories": ["Read", "Edit", "Write", "Glob", "Grep", "WebSearch", "Bash(git*)"],
    "denied_categories": ["Bash(rm -rf*)", "Write(/etc/*)"],
    "mode": "bypassPermissions"
  }
}
```

Note: **Never** expose the raw `allow`/`deny` arrays, hook commands, or `skipDangerousModePermissionPrompt`. Only summarize categories.

---

## 5. Frontend Design

### 5.1 New "Claude Code" Tab

**ClaudeCodePanel.jsx** — 5 sub-views:

1. **Sessions View** (default)
   - List of Claude Code sessions as cards
   - Each card shows: status dot (green/amber/gray), PID, CWD (Windows path), version, last activity (relative time)
   - Expandable to show last 5 prompts (truncated, redacted)
   - Click to navigate to session detail

2. **Plans View**
   - Grid of plan cards with title, filename, last modified, preview
   - Click to expand full markdown (rendered with DOMPurify)

3. **Tasks View**
   - Filterable task list across all sessions
   - Status badges: pending (gray), in_progress (blue), completed (green), blocked (red)
   - Group by session

4. **History View**
   - Searchable prompt history from history.jsonl
   - Search with debounced input
   - Group by project path
   - Each entry: timestamp, truncated display, project

5. **Settings View** (read-only)
   - Categorized display of permissions, hooks count, effort level, theme
   - No edit capability

### 5.2 Cross-References

- **Sessions tab** (existing): Add `agent_id="claude-code"` sessions to merged list
- **Activity tab** (existing): Claude Code events from ActivityEngine
- **Search tab** (existing): Index Claude Code plans, skills, session summaries
- **Health endpoint** (existing): Include Claude Code in `_gather_state()`
- **AgentCard row**: Add a third card for Claude Code between ARETE and Shu

### 5.3 Component Structure

```
ClaudeCodePanel.jsx
├── SessionListSection
│   └── ClaudeSessionCard (per session)
│       ├── StatusDot
│       ├── CwdDisplay
│       └── PromptPreview (truncated, redacted)
├── PlansSection
│   └── PlanCard (per plan)
├── TasksSection
│   └── TaskRow (per task)
├── HistorySection
│   └── HistoryEntry (per entry)
└── SettingsSection
    └── PermissionCategory
```

---

## 6. Integration Points

### 6.1 `server/api/__init__.py` — `init_adapters()`

Add after existing adapter initialization:

```python
global _claude, _claude_reader
claude_cfg = config.get("claude_code", {})
if claude_cfg and claude_cfg.get("enabled", False):
    _claude_reader = ClaudeCodeReader(data_dir=claude_cfg.get("data_dir"))
    _claude = ClaudeCodeAdapter(reader=_claude_reader)
    logger.info("claude_code_adapter_initialized", extra={"data_dir": str(_claude_reader.data_dir)})
else:
    _claude = None
    _claude_reader = None
```

### 6.2 `ActivityEngine` — Add `_claude_reader` parameter

```python
class ActivityEngine:
    def __init__(self, hermes, shu, vault=None, claude_reader=None):
        self._claude_reader = claude_reader

    async def get_timeline(self, since=None, limit=100):
        events = []
        # ... existing hermes, shu, vault events ...
        if self._claude_reader:
            events.extend(await self._claude_reader.get_recent_events(since))
        # deduplicate by event.id
```

### 6.3 `SearchEngine` — Index Claude Code data

```python
async def rebuild(self):
    # ... existing indexing ...
    if self._claude_reader:
        skills = await self._claude_reader.list_skills()
        plans = await self._claude_reader.list_plans()
        for skill in skills:
            self._add_doc(f"claude-skill-{skill['name']}", skill['description'], "claude_skill")
        for plan in plans:
            self._add_doc(f"claude-plan-{plan.filename}", plan.content_preview, "claude_plan")
```

### 6.4 `_gather_state()` SSE Snapshot

Add `_claude` to the agent status dict alongside `_hermes` and `_shu`.

### 6.5 Frontend `App.jsx`

```jsx
const TABS = [
  // ... existing tabs ...
  "claude-code",
];
```

Add a third `AgentCard` for Claude Code in the status panel.

---

## 7. Caching Strategy

| Data Type | Source | TTL | Invalidation |
|-----------|--------|-----|---------------|
| Sessions | `sessions/*.json` | 30s | File mtime check |
| History | `history.jsonl` | 30s | File size/mtime check |
| Tasks | `tasks/{uuid}/*.json` | 60s | Directory mtime check |
| Plans | `plans/*.md` | 300s | File mtime check |
| Skills | `skills/*/SKILL.md` | 300s | File mtime check |
| Settings | `settings.json` | 300s | File mtime check |
| File History | `file-history/{uuid}/` | 120s | Directory mtime check |

Cache uses `cachetools.TTLCache` per data type. Delta detection via `os.stat(mtime + size)` before cache return.

---

## 8. Error Handling

### 8.1 Missing Data Directory

```python
async def discover_data_dir(self) -> Path | None:
    """Check WSL path first, then Windows mount."""
    candidates = [
        Path.home() / ".claude",
        Path(f"/mnt/c/Users/{os.getlogin()}") / ".claude",
    ]
    # Also enumerate /mnt/c/Users/ for the directory with .claude/
    for candidate in candidates:
        if candidate.is_dir():
            return candidate
    # Fallback: scan /mnt/c/Users/*/ for .claude/
    for user_dir in Path("/mnt/c/Users").iterdir():
        claude_dir = user_dir / ".claude"
        if claude_dir.is_dir():
            return claude_dir
    return None
```

If `None`, adapter health returns `AgentStatus(status="offline", error_message="Claude Code data directory not found")` and all data methods return empty lists.

### 8.2 Corrupted JSON

```python
def _parse_json_safe(self, path: Path) -> dict | None:
    try:
        text = path.read_text(encoding="utf-8")
        return json.loads(text)
    except (json.JSONDecodeError, UnicodeDecodeError, OSError):
        self._record_error(f"Failed to parse {path.name}")
        return None
```

For JSONL, parse line-by-line, skip bad lines, count skipped:

```python
def _parse_jsonl_safe(self, path: Path) -> list[dict]:
    results = []
    skipped = 0
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            results.append(json.loads(line))
        except json.JSONDecodeError:
            skipped += 1
    if skipped:
        logger.warning(f"Skipped {skipped} malformed lines in {path.name}")
    return results
```

### 8.3 Concurrent Access (Cross-OS)

- **Never write** to `~/.claude/` — dashboard is strictly read-only
- All reads wrapped in try/except OSError (handles NTFS file locks)
- Short TTL cache (30s) reduces hot-reload frequency
- WSL NTFS boundary: use `asyncio.to_thread` for all file reads

### 8.4 Windows Path Normalization

```python
def normalize_windows_path(win_path: str) -> str:
    """Convert C:\\Users\\Iniolu\\... to /mnt/c/Users/Iniolu/..."""
    # JSON already unescapes \\ to \
    path = win_path.replace("\\", "/")
    # Match drive letter pattern: C:/...
    match = re.match(r"^([A-Za-z]):(.+)$", path)
    if match:
        drive = match.group(1).lower()
        rest = match.group(2)
        return f"/mnt/{drive}{rest}"
    return path
```

---

## 9. Implementation Roadmap

Each step is fully functional and testable before moving to the next.

### Phase 1: Foundation (Backend Core)

**Step 1.1: Data Models** 
- Add `ClaudeSession`, `ClaudeTask`, `ClaudePlan`, `ClaudeFileChange` to `server/models.py`
- Add `SECRET_PATTERNS` and `redact_secrets()` to `server/utils/secret_redaction.py`
- Verify: `pytest tests/test_models.py` passes

**Step 1.2: ClaudeCodeReader — Path Discovery + Sessions**
- Create `server/aggregators/claude_code_reader.py`
- Implement `discover_data_dir()`, `list_sessions()`, `get_session_history()`
- Add caching with TTLCache
- Path sandboxing with `safe_claude_path()`
- Windows path normalization
- Verify: unit tests with temp `~/.claude/` structure

**Step 1.3: ClaudeCodeReader — Tasks, Plans, Skills, Settings**
- Implement `list_tasks()`, `list_plans()`, `list_skills()`, `get_settings_summary()`, `get_file_history()`
- Secret redaction on all content
- Allowlist filtering for skills frontmatter
- Verify: unit tests for each method

**Step 1.4: ClaudeCodeAdapter — AgentAdapter ABC**
- Create `server/agents/claude_code_adapter.py`
- Implement `health()`, `recent_sessions()`, `recent_errors()`, `list_skills()`
- Wire into `config.yaml` with `claude_code:` section
- Verify: `/healthz` returns 200, `/api/health` includes `claude-code` in agents

### Phase 2: API Endpoints

**Step 2.1: Health + Sessions Endpoints**
- Add `/api/claude-code/health`, `/api/claude-code/sessions`, `/api/claude-code/sessions/{session_id}/history`
- Wire `_claude` and `_claude_reader` in `init_adapters()`
- Add to `_gather_state()` for SSE
- Rate limits per security review
- Verify: `curl localhost:8643/api/claude-code/sessions` returns session list

**Step 2.2: Tasks + Plans Endpoints**
- Add `/api/claude-code/tasks`, `/api/claude-code/plans`, `/api/claude-code/plans/{filename}`
- Verify: endpoints return correct data

**Step 2.3: Skills + Settings + File History Endpoints**
- Add `/api/claude-code/skills`, `/api/claude-code/settings`, `/api/claude-code/file-history/{session_id}`
- Verify: settings returns only allowlisted fields

### Phase 3: Aggregator Integration

**Step 3.1: ActivityEngine Integration**
- Add `claude_reader` parameter to `ActivityEngine`
- Generate `ActivityEvent` entries from Claude Code sessions and tasks
- Verify: `/api/activity` includes `claude-code` events

**Step 3.2: SearchEngine Integration**
- Index Claude Code plans, skills, session summaries
- Add `claude_skill` and `claude_plan` source types to `SearchEngine`
- Verify: `/api/search?q=signal+core` returns Claude Code plan results

### Phase 4: Frontend

**Step 4.1: AgentCard for Claude Code**
- Add third AgentCard to status panel
- Shows: status dot, version, active sessions, last activity
- Verify: Claude Code card appears alongside ARETE and Shu

**Step 4.2: ClaudeCodePanel — Sessions + History**
- Create `ClaudeCodePanel.jsx`
- Sessions list with status dots, CWD, version
- History view with search
- Verify: Tab shows session data

**Step 4.3: ClaudeCodePanel — Tasks + Plans + Settings**
- Tasks view with status badges
- Plans view with markdown rendering
- Settings view (read-only)
- Verify: All sub-views render correctly

**Step 4.4: Search + Activity Cross-References**
- Wire Claude Code results into existing SearchPanel
- Wire Claude events into existing TimelinePanel
- Verify: Search returns mixed Hermes + Claude results

### Phase 5: Testing + Hardening

**Step 5.1: Test Suite**
- `test_claude_code_reader.py` — filesystem reads, caching, error handling
- `test_claude_code_adapter.py` — AgentAdapter contract, health, sessions
- `test_claude_api.py` — API endpoint tests with mock filesystem
- Security tests: path traversal, deny list, redaction

**Step 5.2: Security Audit**
- Verify: no daemon/ content servable
- Verify: no settings.json raw exposure
- Verify: no secrets in any response
- Verify: ACC_API_TOKEN required when adapter enabled
- Verify: SSE events contain only status metadata

**Step 5.3: Performance**
- Benchmark: `/api/claude-code/sessions` under 100ms with caching
- Load test: 10 concurrent requests to all Claude endpoints
- Verify: no filesystem blocking of event loop

---

## 10. Testing Strategy

### Unit Tests

```python
# tests/test_claude_code_reader.py
- test_discover_data_dir_wsl_path
- test_discover_data_dir_windows_mount
- test_discover_data_dir_missing
- test_list_sessions_empty
- test_list_sessions_with_data
- test_list_sessions_corrupted_json
- test_list_tasks_non_sequential_numbering
- test_list_tasks_empty_dir
- test_list_plans
- test_list_skills_allowlisted_frontmatter
- test_get_settings_summary_no_secrets
- test_safe_claude_path_traversal_blocked
- test_safe_claude_path_denied_subpaths
- test_redact_secrets_patterns
- test_normalize_windows_path
- test_cache_ttl_expiry
```

### Integration Tests

```python
# tests/test_claude_api.py
- test_claude_health_online
- test_claude_health_offline_no_dir
- test_claude_sessions_returns_list
- test_claude_sessions_history_redacted
- test_claude_plans_list
- test_claude_plans_content_redacted
- test_claude_settings_no_secrets
- test_claude_file_history_by_session
- test_claude_rate_limiting
- test_auth_required_when_adapter_enabled
```

### Security Tests

```python
# tests/test_claude_security.py
- test_path_traversal_blocked (../../../etc/passwd)
- test_daemon_dir_not_readable
- test_settings_json_not_served
- test_pipe_key_not_accessible
- test_session_content_metadata_only
- test_history_display_truncated
- test_skill_frontmatter_allowlisted
- test_secret_patterns_redacted
- test_acc_api_token_required
```