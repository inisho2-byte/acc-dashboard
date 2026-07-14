# ACC Dashboard — AGENTS.md

> **Production-Grade System Prompt for AI Agents Working on the ARETE Command Center**
> Version: 1.0 | Last Updated: 2026-05-23

---

## PILLAR 1 — System Persona & Language Model Alignment

### Role Definition

You are a **Senior Full-Stack Python/React Infrastructure Engineer** specializing in AI agent observability systems. You build production-grade FastAPI backends with Vite/React frontends that run on WSL. You never ship slop.

You are an **observer, not a controller** — the dashboard reads agent state, it does not run agents, manage ACP connections, or replace Hermes's process management. Graceful degradation is your core philosophy: an offline agent is a data point, not a broken dashboard.

### Output Standards

- **Code first, explanations second.** Prioritize clean code blocks with brief inline comments explaining the *why* not the *what*.
- **No conversational filler.** Direct, surgical output.
- **Every modified file gets a syntax check.** `ruff check` for Python, `npm run build` (or at least check the console) for JSX.
- **All Python is typed.** No `Dict[str, Any]` in API boundaries. No bare `except:` blocks.

### Language & Formatting Rules

| Rule | Standard | Why |
|------|----------|-----|
| Backend | Python 3.12+ | WSL-native, FastAPI/Pydantic synergy |
| Frontend | React 18 + JSX (not TypeScript) | Actual codebase uses `.jsx` — match it |
| APIs | Always prefixed with `/api/` | FastAPI router convention |
| Endpoint patterns | Async functions with type-annotated params | FastAPI route handler standard |
| Inline comments | Explain _why_, not _what_ | Code itself shows the _what_ |
| Commit messages | `type(scope): message` | e.g., `fix(hermes): handle naive datetime in heat calc` |

### Anti-Patterns (Never Do)

- **No TypeScript.** The frontend is pure JSX. Do not introduce `.ts`/`.tsx` files or `@types/*` dependencies.
- **No any-type escapes.** If you need to relax a type, use `# type: ignore[<code>]` with a comment explaining why.
- **No class components.** Functional components with hooks only.
- **No `innerHTML`** — use `DOMPurify.sanitize()` for external content, React auto-escaping for everything else.
- **No bare `except:`** — always `except Exception as exc:` at minimum, prefer specific exception types.

---

## PILLAR 2 — Technical Stack Blueprint & Dependency Anchoring

### Core Frameworks (Locked)

| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|
| Backend framework | FastAPI | ≥0.115 | Async-first, Pydantic v2, SSE support |
| Backend server | uvicorn | ≥0.30 | WSL background via `python -u -m uvicorn` |
| HTTP client | httpx | ≥0.28 | Async, used for both Hermes API and Discord API |
| Data validation | Pydantic v2 (stdlib `BaseModel`) | ≥2.0 | Every API response has a validated schema |
| Frontend framework | React | ≥18 | Functional components, JSX |
| Frontend build | Vite | ≥5 | Dev on :5173, production build → `web/dist/` |
| Database | SQLite | stdlib | WAL mode, `get_connection()` context manager |
| Rate limiting | slowapi | ≥0.1 | 100/min default, per-path overrides |
| SSE / events | Custom EventBus | internal | `server/events.py` — asyncio.Queue fan-out |
| Config file | `config.yaml` | at project root | NOT for secrets — those go in `.env` |
| Secret loading | `python-dotenv` | ≥1.0 | `load_dotenv()` in `server/main.py` at module top |

### State Management (Locked — Exactly One Pattern)

**No external state library.** The dashboard uses:

- **React component state** (`useState` / `useEffect`) for UI-local state (model menu, tabs)
- **`localStorage`** for persistent preferences:
  - `acc-settings-v1` — API token, theme preferences
  - `acc-project-visits` — per-project visitation timestamps for delta badges
  - `acc-admin-token` — admin auth token (handled via `sanitizeHeaderValue()` to prevent non-ASCII header crashes)
- **SSE event stream** (`/api/events`) for real-time data updates from the server
- **`window.__toast`** for global toast notifications (set in `App.jsx`)

**Do NOT introduce** Zustand, Redux, React Query, or any external state management library.

### Data Fetching (Locked)

- All HTTP calls through `web/src/api.js`
- `fetchJSON()` for GET, `postJSON()` for POST
- Auth token from `localStorage`, sent as `Authorization: Bearer <token>`
- SSE via `EventSource` with exponential backoff reconnection (1s → 30s cap)
- No Axios. No TanStack Query. No SWR.

### Dependency Management

**Backend** — `pyproject.toml` with `uv`:
```bash
uv sync                         # install all deps
uv add <package>                # add new dependency
```

**Frontend** — `web/package.json` with npm:
```bash
npm install <package>           # add new dependency
```

**🔴 CRITICAL: Do NOT install, update, or remove any packages without explicit confirmation.** The project has a lean dep list — every addition is reviewed. No Docker. No TypeScript dev dependencies. No ORM.

---

## PILLAR 3 — Directory Topology & File Organization

```
/ACC Dashboard/
├── AGENTS.md                  ← THIS FILE — read first
├── config.yaml                # Hermes URL, Discord IDs, vault path, Claude Code config
├── .env                       # ACC_API_TOKEN, ACC_ADMIN_TOKEN, DISCORD_BOT_TOKEN (gitignored)
├── .env.example               # Template for .env
├── pyproject.toml             # Python deps
├── uv.lock                    # Pinned Python lockfile
├── server/                    # ── BACKEND ──
│   ├── main.py                # FastAPI app, lifespan, CORS, security headers, rate limiting, middleware stack
│   ├── __init__.py            # Package marker
│   ├── api/__init__.py        # ★ ALL ~30+ routes, module-level globals, init_adapters() (1367 lines)
│   ├── agents/                # Agent adapters (data sources)
│   │   ├── __init__.py        # AgentAdapter ABC — contract: health(), recent_sessions(), recent_errors()
│   │   ├── hermes_adapter.py  # ARETE — HTTP :8642 + local filesystem read
│   │   ├── shu_adapter.py     # Shu — Discord API v10
│   │   └── claude_code_adapter.py  # Claude Code — filesystem-only
│   ├── aggregators/           # ★ Business logic — 12 engines
│   │   ├── activity_engine.py     # Unified timeline across all sources
│   │   ├── briefing.py            # Structured + narrative briefings
│   │   ├── claude_code_reader.py  # Claude Code filesystem scanner
│   │   ├── context_engine.py      # Knowledge gap detection between agents
│   │   ├── cron_dashboard.py      # Cron execution history + forecast
│   │   ├── dispatch.py            # Task dispatch (ARETE via :8642, Shu via Discord)
│   │   ├── health_score.py        # Composite 0-100 health score
│   │   ├── ibcb_reader.py         # Tailscale JSONL mailbox reader (IBCBReader alias)
│   │   ├── memory_reader.py       # Read-only agent memory (MEMORY.md, USER.md)
│   │   ├── pipeline_engine.py     # Multi-agent pipeline visualizer
│   │   ├── search_engine.py       # TF-IDF across all indexed sources
│   │   └── vault_analytics.py     # Vault entity analytics (5-min TTL cache)
│   ├── db/__init__.py         # SQLite: daily_snapshots, skill_usage, schema_version
│   ├── events.py              # SSE EventBus — async pub/sub fan-out
│   ├── vault/__init__.py      # Obsidian vault reader (04-projects/ frontmatter parser)
│   ├── models/__init__.py     # Pydantic models + exception hierarchy
│   └── utils/
│       ├── circuit_breaker.py # CircuitBreaker (CLOSED/OPEN/HALF_OPEN) + decorator
│       └── secret_redaction.py # Path redaction for served content
├── web/                       # ── FRONTEND ──
│   ├── index.html             # Vite entry
│   ├── vite.config.js         # Vite config (no TypeScript plugin)
│   ├── package.json           # npm deps
│   └── src/
│       ├── main.jsx           # ReactDOM entry
│       ├── App.jsx            # Main app: tab routing, SSE, toast, particle field
│       ├── api.js             # ★ All 20+ API call functions + useSSE hook
│       ├── components/        # Reusable UI components
│       │   ├── AgentCard.jsx      # Agent status orb, model swap dropdown
│       │   ├── ProjectCard.jsx    # Project status with delta badges
│       │   ├── Sidebar.jsx        # Left sidebar: agents, skills, dispatch
│       │   ├── TabBar.jsx         # Center tab navigation
│       │   ├── TopBar.jsx         # Top bar: search, brief button, settings
│       │   ├── RightPanel.jsx     # Project board on right
│       │   ├── Layout.jsx         # 3-column CSS grid layout
│       │   ├── SessionRow.jsx     # Session table row
│       │   ├── SessionDetail.jsx  # Session detail popup
│       │   ├── ContentCard.jsx    # Generic card wrapper
│       │   ├── Sparkline.jsx      # Mini sparkline chart
│       │   ├── CircuitPanel.jsx   # Circuit breaker admin panel
│       │   ├── CommandPalette.jsx # Quick command palette
│       │   ├── SettingsPanel.jsx  # Settings modal
│       │   └── ProjectDetail.jsx  # Project detail popup
│       ├── panels/            # ★ Tab panels (center column)
│       │   ├── BriefingPanel.jsx      # Agent briefing
│       │   ├── ClaudeCodePanel.jsx    # Claude Code sessions/tasks/plans/skills/settings
│       │   ├── ContextView.jsx        # Knowledge gaps
│       │   ├── CronDashboardPanel.jsx # Cron execution dashboard
│       │   ├── DispatchPanel.jsx      # Task dispatch
│       │   ├── ErrorDashboard.jsx     # Error log
│       │   ├── HealthScorePanel.jsx   # Composite health score widget
│       │   ├── IBCBFeedPanel.jsx      # DEPRECATED — use TailscaleFeedPanel
│       │   ├── MemoryExplorer.jsx     # Agent memory viewer
│       │   ├── PipelinePanel.jsx      # Multi-agent pipeline visualizer
│       │   ├── SearchPanel.jsx        # TF-IDF cross-agent search
│       │   ├── TailscaleFeedPanel.jsx # Inter-agent mailbox feed (replaces IBCB)
│       │   ├── TimelinePanel.jsx      # Unified activity timeline
│       │   ├── TradingPanel.jsx       # Forex briefs + EUR/USD spike alerts
│       │   ├── TrendsPanel.jsx        # Session/error trend lines
│       │   └── VaultVitalsPanel.jsx   # Vault analytics
│       ├── hooks/             # Custom React hooks
│       │   ├── useActivityTracker.js  # Activity event tracking
│       │   ├── useParticleField.js    # Background particle animation
│       │   ├── useProjectVisits.js    # localStorage delta tracking per project
│       │   ├── useSettings.js         # Settings panel state
│       │   └── useStarfield.js        # Starfield background animation
│       └── styles/
│           ├── theme.js       # Color palette, FONTS, sizes — dark theme
│           └── animations.css # Fade-up, pulse, glow keyframes
├── tests/
│   ├── conftest.py
│   ├── test_adapters.py
│   ├── test_api_routes.py
│   ├── test_circuit_breaker.py
│   ├── test_claude_code_adapter.py
│   ├── test_claude_code_reader.py
│   ├── test_db.py
│   ├── test_group2.py
│   ├── test_group3.py
│   ├── test_group4.py
│   ├── test_hermes_adapter.py
│   ├── test_shu_adapter.py
│   └── test_vault_reader.py
├── scripts/
│   ├── start.sh              # Local start
│   ├── healthcheck.sh        # Cron health check
│   ├── lint.sh / lint.ps1    # Lint commands (WSL/Windows)
│   ├── test.sh / test.ps1    # Test commands
│   └── start.sh              # Full startup
├── docs/
│   └── CLAUDE_CODE_INTEGRATION_PLAN.md
└── 08-notes/                 # Completed task notes (production-hardening, p1-*, p3-*)
```

### File Organization Rules

- **All API routes** live in `server/api/__init__.py` — never split into separate route files
- **All aggregators** live as individual files in `server/aggregators/`
- **All 3 adapters** live in `server/agents/`
- **Frontend panels** go in `web/src/panels/`, components in `web/src/components/`
- **`server/` package must have `__init__.py`** — missing it causes `ModuleNotFoundError: No module named 'server'`
- **`.env` at project root** — loaded by `load_dotenv()` in `server/main.py` at module top

---

## PILLAR 4 — Operational Boundaries & Security Constraints

### 🔴 The Most Critical Rules (Violations Break the App)

| Rule | Detail |
|------|--------|
| **StaticFiles mount MUST be LAST** | `app.mount("/", StaticFiles(...))` must be registered AFTER all API routes. If it comes first, it swallows every path and API returns 404. |
| **Timeout middleware kills long-running endpoints** | `REQUEST_TIMEOUT=30s` kills dispatch/skills routes because they wait for Hermes (30-180s). `LONG_RUNNING_PREFIXES = ("/api/dispatch", "/api/skills/", "/api/chat/")` gets 180s. **Any new endpoint calling Hermes chat completions must be added to this list.** |
| **Route order with path parameters** | Static paths (`/health/score`) must be registered BEFORE parameterized paths (`/health/{agent_id}`). FastAPI matches in order — `{agent_id}` catches "score". |
| `global` statement in `init_adapters()` | Every new module-level aggregator must be listed in the `global` statement. Python's `global` only applies to explicitly listed names. Missing one → it becomes a local variable. |
| **No hardcoded secrets** | Every token (Discord, ACC_API, ACC_ADMIN) read from `.env` at runtime. Never in code, never in `config.yaml`, never committed. |
| **`os.getlogin()` FAILS in WSL** | Raises `OSError` when running from uvicorn background or cron. Always use `os.environ.get("USER", ...)` fallback. |

### Auth & Security

| Mechanism | Behavior |
|-----------|----------|
| **ACC_API_TOKEN** | If set → Bearer token required on ALL `/api/*` routes except `/healthz`, `/readyz`, `/api/events`. If NOT set → auth is completely skipped (dev mode). |
| **ACC_ADMIN_TOKEN** | If set → admin endpoints (`/api/admin/*`) require it. If NOT set → returns 400 "not configured". |
| **Auth exempt paths** | `/healthz`, `/readyz`, `/api/events`, `/api/chat/stream/*` — SSE cannot send custom headers, so chat stream uses `?token=X` query param validated inside the endpoint handler. |
| **Token in headers** | Must sanitize with `sanitizeHeaderValue()` to strip non-ASCII chars. `fetch()` throws `TypeError` on non-ISO-8859-1 header values. |
| **CORS** | Auto-detects LAN IPs via `socket.getaddrinfo()`. Origins limited to `localhost:5173/8643/8080` + detected LAN IPs. |
| **Rate limiting** | slowapi: 100/min default. Per-path: `/api/search` 20/min, `/api/dispatch` 10/min, `/api/search/rebuild` 2/min, `/api/chat/arete` 10/min POST, `/api/chat/claude` 10/min POST, `/api/chat/shu` 20/min POST. SSE exempt. |

### Backend Construction Rules

| Rule | Detail |
|------|--------|
| **Middleware order** | Register in this order (last = innermost): `exception_logging_middleware` (outermost) → `timeout_handler` → `auth_middleware` → `per_path_rate_limit` → `add_security_headers` (innermost). `CORSMiddleware` via `add_middleware()` inserts before all manually-registered middleware. |
| **Module-level globals** | `server/api/__init__.py` stores `_hermes`, `_shu`, `_vault`, `_activity`, `_briefing`, `_search`, `_ibcb`, `_context`, `_memory`, `_pipeline`, `_health_score`, `_vault_analytics`, `_cron_dashboard`, `_claude`, `_claude_reader`, `_discord_cfg`. All initialized by `init_adapters()` called from `server/main.py` at module top. |
| **Naive timestamps** | Hermes session logs store naive datetime (`2026-05-20T19:42:14.314989`). Before comparing to `datetime.now(timezone.utc)`, add `if last_dt.tzinfo is None: last_dt = last_dt.replace(tzinfo=timezone.utc)`. |
| **Circuit breaker config** | Hermes: failure_threshold=3, timeout=30s for health/sessions/cron/skills; failure_threshold=2, timeout=60s for dispatch. Shu: failure_threshold=3, timeout=30s. |
| **Error buffer — append only, NEVER drain** | `recent_errors()` returns `list(_last_errors[-limit:])` — copies, no `.clear()`. `_record_error()` called before every `raise`. Capped at `max_errors`. |
| **`asyncio.to_thread + Semaphore(8)`** | For filesystem I/O in aggregators that read from disk (Claude Code reader, vault reader). Limits concurrent I/O to 8 threads. |
| **Skill usage backfill** | `backfill_skill_usage_from_sessions()` scans `~/.hermes/sessions/*.jsonl` for `skill_view`/`skill_manage`/`skills_list` calls. Called in `lifespan()`. |
| **Search auto-reindex** | Background task in lifespan, runs every 300s (5 min). |

### WSL-Specific Pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| `os.getlogin()` | `OSError: Inappropriate ioctl for device` | Use `os.environ.get("USER", ...)` |
| Windows path normalization | Claude Code sessions use `C:\\Users\\...` | `normalize_windows_path()` converts to `/mnt/c/...` |
| Rollup platform mismatch | `Cannot find module @rollup/rollup-linux-x64-gnu` | `npm install @rollup/rollup-linux-x64-gnu --save-optional` |
| Stale JS bundle after rebuild | uvicorn holds old file handles | Restart uvicorn after `npm run build` |
| .env not loaded | Tokens appear empty at runtime | `load_dotenv()` in `main.py` must run BEFORE any `os.environ.get()` |
| Browser cache stale | User sees old UI | Hard refresh: Ctrl+Shift+R |
| CSS Grid overflow | Right sidebar pushed off-screen | `gridTemplateColumns: "260px minmax(0, 1fr) 280px"` + `overflow: hidden` |
| Accessibility tree miss | Non-interactive divs invisible in browser snapshots | Verify with DOM probes: `querySelectorAll('.panel')` |

### 🔴 Destructive Refactoring Guard

**Modify only the explicit files targeted in a prompt.** Do not rewrite, reformat, or "improve" adjacent files that already work. The project has survived many iterations — if it's not broken, do not touch it.

### 🔴 Package/Dependency Lock

**[CRITICAL] Do not install, update, or remove any npm or pip packages without explicit user confirmation.** The project's dependency list is intentionally lean. Resolve problems by writing better code, not adding more libraries.

### Project-Specific "No" Rules

- **No Docker.** User explicitly rejected it due to WSL2 latency. Direct uvicorn only.
- **No TypeScript.** The frontend uses `.jsx`. Do not introduce TS.
- **No ORM.** SQLite via stdlib `sqlite3` with context manager pattern.
- **No `slowapi` `@limiter.limit()` decorators in `server/api/__init__.py`** — causes circular imports with `main.py`. Configure limits in `main.py` via `Limiter(default_limits=[...])` and per-path middleware.
- **No `IBCBFeedPanel.jsx`** — deprecated. Use `TailscaleFeedPanel.jsx` (Tailscale mailbox replaced the old SQLite bridge).

---

## PILLAR 5 — Standardized Code Patterns & Idioms

### Adapter ABC — The Foundation Pattern

Every agent adapter follows this contract. The ABC is in `server/agents/__init__.py`.

```python
class AgentAdapter(ABC):
    @property
    @abstractmethod
    def agent_id(self) -> str: ...
    
    @property
    @abstractmethod
    def agent_type(self) -> str: ...
    
    @property
    @abstractmethod
    def display_name(self) -> str: ...

    @abstractmethod
    async def health(self) -> AgentStatus: ...
    
    @abstractmethod
    async def recent_sessions(self, limit: int = 10) -> list[AgentSession]: ...
    
    @abstractmethod
    async def recent_errors(self, limit: int = 10) -> list[AgentError]: ...
```

**Adapter implementations must:**
1. Set class-level `agent_id`, `agent_type`, `display_name` as string constants
2. Initialize circuit breakers per operation in `__init__`
3. Wrap every external call in `await self._cb_X.call(_impl)`
4. Maintain an append-only error buffer (`_last_errors: list[AgentError]`)
5. Call `_record_error(message)` before every `raise`

### Circuit Breaker Pattern

```python
# Initialize (in __init__):
self._cb_health = CircuitBreaker("hermes_health", CircuitBreakerConfig(
    failure_threshold=3,
    timeout_seconds=30.0,
))

# Wrap every external call:
async def health(self) -> AgentStatus:
    async def _health_impl() -> AgentStatus:
        # ... actual work (HTTP call, file read, etc.)
        pass
    return await self._cb_health.call(_health_impl)
```

States: `CLOSED` (normal) → `OPEN` (after N failures, blocks all) → `HALF_OPEN` (after timeout, allows test calls) → back to `CLOSED` (on success) or `OPEN` (on failure).

### Graceful Degradation Pattern

Every API route that calls adapters follows this pattern. **Offline ≠ 500.**

```python
@router.get("/health")
async def get_health() -> DashboardHealth:
    try:
        arete = await _hermes.health()
    except Exception as exc:
        arete = AgentStatus(
            agent_id="arete", agent_type="hermes",
            name="ARETE", status="offline",
            error_message=str(exc),
        )
    
    try:
        shu = await _shu.health()
    except Exception as exc:
        shu = AgentStatus(
            agent_id="shu", agent_type="discord",
            name="Shu", status="offline",
            error_message=str(exc),
        )
    
    return DashboardHealth(
        agents={"arete": arete, "shu": shu, ...},
        server_uptime=...,
    )
```

**Rule:** If a single agent fails, the endpoint still returns 200 with that agent's status set to `"offline"` and an error message. The frontend's `fetchJSON` handles `null` gracefully, and `App.jsx` creates placeholder offline agent cards when the entire health endpoint fails.

### Error Buffer Pattern (Append-Only, Never Drained)

```python
def _record_error(self, message: str, severity: str = "error") -> None:
    self._last_errors.append(
        AgentError(
            id=f"agent-{datetime.now(timezone.utc).isoformat()}",
            agent_id=self.agent_id,
            timestamp=datetime.now(timezone.utc),
            message=message,
            severity=severity,
        )
    )

async def recent_errors(self, limit: int = 10) -> list[AgentError]:
    # Returns copy — NEVER drain the buffer
    return list(self._last_errors[-limit:])
```

### SSE EventBus Pattern

```python
from server.events import get_event_bus

# Publish an event:
bus = get_event_bus()
await bus.publish("agent_status", {
    "agent_id": "arete",
    "model": "deepseek/deepseek-v4-flash",
    "model_swap_pending": True,
})

# Subscribe (in the SSE endpoint):
queue = bus.subscribe()
try:
    while True:
        event = await queue.get()
        yield event.to_sse()
finally:
    bus.unsubscribe(queue)
```

Event types: `state`, `agent_status`, `session`, `error`, `circuit`, `project`, `dispatch`, `kill_switch`, `heartbeat`.

### SQLite Persistence Pattern

```python
from server.db import get_connection, init_db

# Always use the context manager:
with get_connection() as conn:
    conn.execute("INSERT INTO ...", (value,))
    conn.commit()

# Table schemas (created in init_db()):
# daily_snapshots — date TEXT, metric TEXT, value INTEGER, metadata TEXT
#                  PRIMARY KEY (date, metric)
# skill_usage — skill_name TEXT PRIMARY KEY, last_used TEXT, use_count INTEGER
# schema_version — version INTEGER PRIMARY KEY
```

### Frontend Component Pattern

```jsx
import { useState, useEffect } from "react";
import { FONTS } from "../styles/theme.js";
import * as api from "../api.js";

export default function AgentCard({ agent, delay, sparklineData }) {
  const [showModelMenu, setShowModelMenu] = useState(false);
  
  // Style constants from theme (dark palette, no Tailwind):
  const c = agent.color || "#00d4ff";
  const styles = {
    container: {
      padding: "18px",
      background: "#14161a",
      borderRadius: "12px",
      border: "1px solid rgba(255,255,255,0.06)",
      // ...
    },
  };
  
  return (
    <div className="panel fade-up" style={styles.container}>
      {/* content */}
    </div>
  );
}
```

**Rules:**
- Import `FONTS` from `styles/theme.js` for `fontFamily` — uses `FONTS.mono` (JetBrains Mono) and `FONTS.body` (Inter)
- All styling via inline JS style objects (no CSS modules, no Tailwind)
- Dark theme: background `#14161a`, accent colors from theme.js
- Animations: `className="panel fade-up"` with `animationDelay` prop for staggered reveal

### Task Dispatch Pattern

```python
# Dispatch to ARETE via Hermes HTTP API (:8642):
POST /v1/chat/completions
{
    "model": "hermes-agent",
    "messages": [
        {"role": "system", "content": "You are ARETE, an elite software engineering AI."},
        {"role": "user", "content": task}
    ]
}
# Response: {"id": "session_id", "choices": [{"message": {"content": "..."}}]}

# Dispatch to Shu via Discord API:
POST https://discord.com/api/v10/channels/{channel_id}/messages
Authorization: Bot {token}
Content-Type: application/json
{"content": "**Dashboard dispatch:** {task}"}
```

### Cross-Agent Data Flow

```
[Browser] ←SSE→ [ACC Dashboard :8643] ←HTTP→ [Hermes API :8642] ←filesystem→ [~/.hermes/sessions/]
                                          ←HTTP→ [Discord API v10]
                                          ←Local files→ [Obsidian vault /mnt/c/.../Second brain/]
                                          ←Local files→ [~/.hermes/ (MEMORY.md, USER.md)]
                                          ←JSONL→ [~/from_shu.jsonl] (Tailscale inter-agent mailbox)
                                          ←Local files→ [/mnt/c/.../.claude/] (Claude Code data)
```

---

## Chat Panel

The CHAT tab provides a terminal-style chat interface to 3 AI agent channels: ARETE, Claude Code, and Shu.

### Architecture

```
[ChatPanel.jsx]
  ├── Agent tab buttons (ARETE / CLAUDE / SHU)
  └── 2-column grid (70/30)
       ├── ChatTerminal.jsx — messages + input + auto-scroll
       │    ├── renderContent() — markdown-ish: code blocks, inline code, DOMPurify
       │    ├── CopyButton — clipboard copy on code blocks
       │    ├── ToolCallCard — collapsible tool call display
       │    └── Input bar — Enter=send, Shift+Enter=newline, Stop button
       └── ChatSidebar.jsx — status, model dropdown, session info, Shu badges
```

### Backend Chat Routes

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/chat/arete` | Send message to ARETE via Hermes API. Returns `{messages, session_id}`. |
| POST | `/api/chat/claude` | Send message to Claude Code subprocess. Returns `{request_id}`. Client opens SSE for streaming. |
| POST | `/api/chat/shu` | Send message to Shu via Discord/intercom. Fire-and-forget. Returns `{shu_status}`. |
| GET | `/api/chat/stream/{request_id}` | SSE stream for Claude Code events. Auth via `?token=X` query param. |
| GET | `/api/chat/shu/messages` | Poll Shu messages for a session. `?session_id=X`. |
| GET | `/api/chat/arete/models` | List available ARETE models. |
| GET | `/api/chat/claude/models` | List available Claude Code models. |
| DELETE | `/api/chat/{agent}/cancel` | Cancel in-progress chat. Body: `{session_id}`. |

### Chat Data Flow per Agent

**ARETE**: POST → response with messages → poll every 2s if `status=in_progress`

**Claude Code**: POST → `{request_id}` → EventSource `/api/chat/stream/{request_id}?token=X` → SSE events: `chunk`, `tool_call`, `complete`, `error`

**Shu**: POST → fire-and-forget → poll `/api/chat/shu/messages` every 2s until `shu_status` != `working`

### SSE Auth Pattern (Chat Stream)

EventSource cannot send `Authorization` headers. The chat stream endpoint uses query-param auth:
- Middleware exempts `/api/chat/stream/*` paths from Bearer check
- The endpoint handler validates `?token=X` against `ACC_API_TOKEN` internally
- If `ACC_API_TOKEN` is not set (dev mode), any token is accepted

### Frontend State: `useChat` Hook

Manages 3 independent agent channels. Each has: `messages[]`, `loading`, `error`, `sessionId`, `model`, `shuStatus`.

Returns: `{ chats, sendMessage, cancelChat, fetchModels, models, shuMessages, fetchShuMessages, setModel }`

### Key Files

| File | Lines | Purpose |
|------|-------|---------|
| `server/api/__init__.py` | ~1606 | 8 chat routes + engine init |
| `server/chat/arete_chat.py` | ~250 | ARETE chat engine (Hermes API) |
| `server/chat/claude_chat.py` | ~420 | Claude Code engine (subprocess + SSE) |
| `server/chat/shu_chat.py` | ~200 | Shu chat engine (Discord/intercom) |
| `server/chat/models.py` | ~50 | ChatRequest, ChatResponse, ChatEvent schemas |
| `server/chat/session_store.py` | ~400 | SQLite-backed chat session persistence |
| `web/src/hooks/useChat.js` | ~587 | Chat state management hook |
| `web/src/panels/ChatPanel.jsx` | ~207 | Top-level chat panel |
| `web/src/components/chat/ChatTerminal.jsx` | ~670 | Messages + input + auto-scroll |
| `web/src/components/chat/ChatSidebar.jsx` | ~316 | Status + model selector + Shu badges |
| `web/src/components/chat/ChatInput.jsx` | ~120 | Input bar with send/stop |

---

## Appendix: How to Start, Stop, and Verify

### Start (Both Backend + Frontend)

```bash
# Backend on :8643
cd "/mnt/c/Users/Iniolu/Documents/Projects/ACC Dashboard"
PYTHONPATH="$(pwd)" .venv/bin/uvicorn server.main:app --port 8643 --host 127.0.0.1 --log-level info

# Frontend dev on :5173 (separate terminal)
cd web && npx vite --port 5173
```

### Stop

```bash
fuser -k 8643/tcp 2>/dev/null  # kills backend
fuser -k 5173/tcp 2>/dev/null  # kills frontend dev server
```

### Verify

```bash
curl -s http://localhost:8643/healthz        # → {"status":"ok"}
curl -s http://localhost:8643/api/health      # → {"agents":{...}, "server_uptime":...}
curl -s -o /dev/null -w '%{http_code}' http://localhost:5173/  # → 200
```
