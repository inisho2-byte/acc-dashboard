# Architecture — Agent Chat Panel

## 1. Tech Stack

| Layer | Technology | Version | Justification |
|-------|-----------|---------|---------------|
| Chat subprocess (ARETE) | `hermes chat -q` | current | Non-interactive query mode, --resume for session continuity |
| Chat subprocess (Claude) | `claude.exe -p` or `ollama launch claude -- -p` | v2.1.146 | --print mode with --output-format stream-json for SSE |
| Shu transport | httpx POST to Tailscale peer | ≥0.28 | Same HTTP client used across the dashboard |
| Chat persistence | SQLite (new `chat_sessions` + `chat_messages` tables) | stdlib | Consistent with existing SQLite pattern |
| SSE streaming | Existing EventBus + new ChatEvent type | internal | Reuses server/events.py infrastructure |
| Frontend component | ChatPanel.jsx + sub-components | React 18 | Terminal-style chat embedded as activity tab |

## 2. System Architecture

```
┌──────────── BROWSER ────────────┐
│  ChatPanel.jsx                  │
│  ├── AgentTabBar [ARETE|CLAUDE|SHU]
│  ├── ChatSidebar.jsx           │
│  │   ├── Status orb            │
│  │   ├── Model dropdown        │
│  │   └── Session info          │
│  ├── ChatTerminal.jsx          │
│  │   ├── MessageList.jsx       │
│  │   │   ├── UserMessage       │
│  │   │   ├── AgentMessage      │
│  │   │   ├── ToolCallCard      │
│  │   │   └── SystemMessage     │
│  │   ├── StreamingCursor       │
│  │   └── ChatInput.jsx         │
│  └── SSE EventSource (/api/chat/events)
└───────────┬─────────────────────┘
            │ POST /api/chat/{agent}
            │ GET  /api/chat/events (SSE)
            │
┌───────────▼─────────────────────┐
│  FastAPI Backend (:8643)        │
│  server/api/__init__.py         │
│  ├── POST /api/chat/arete       │
│  ├── POST /api/chat/claude      │
│  ├── GET  /api/chat/claude/stream/{req_id} (SSE)
│  ├── POST /api/chat/shu         │
│  ├── GET  /api/chat/shu/messages│
│  ├── GET  /api/chat/arete/models│
│  ├── GET  /api/chat/claude/models│
│  ├── DELETE /api/chat/{agent}/cancel│
│  └── Chat routes in LONG_RUNNING│
│                                 │
│  server/chat/                   │
│  ├── __init__.py                │
│  ├── arete_chat.py  (subprocess)│
│  ├── claude_chat.py (subprocess)│
│  ├── shu_chat.py    (HTTP)      │
│  └── session_store.py (SQLite)  │
└───────────┬─────────────────────┘
            │
    ┌───────┼───────────────┐
    │       │               │
    ▼       ▼               ▼
 hermes   claude.exe    100.85.6.14
 CLI      -p mode        :8765/msg
```

## 3. Folder Structure (new files only)

```
server/
  chat/
    __init__.py           # ChatEngine class — top-level orchestrator
    arete_chat.py         # AreteChatEngine — hermes chat subprocess
    claude_chat.py        # ClaudeChatEngine — claude.exe subprocess + stream-json parser
    shu_chat.py           # ShuChatEngine — HTTP POST + JSONL poll
    session_store.py      # ChatSessionStore — SQLite persistence for sessions + messages
    models.py             # Pydantic models: ChatMessage, ChatSession, ChatRequest, ChatEvent

web/src/
  panels/
    ChatPanel.jsx         # Top-level tab component (~150 lines)
  chat/
    ChatSidebar.jsx       # Left info panel — agent status, model selector, session info
    ChatTerminal.jsx      # Right terminal pane — message list + input bar
    MessageList.jsx       # Scrollable message container with auto-scroll logic
    UserMessage.jsx       # Right-aligned user bubble
    AgentMessage.jsx      # Left-aligned agent response with markdown rendering
    ToolCallCard.jsx      # Collapsible tool_use / tool_result display
    SystemMessage.jsx     # Muted system notices (session started, cancelled, errors)
    ChatInput.jsx         # Input bar with prefix, textarea, send/stop buttons
    useChat.js            # Custom hook — manages chat state, API calls, SSE subscription
```

## 4. Data Models

### SQLite Tables

```sql
CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,              -- UUID
    agent TEXT NOT NULL,              -- 'arete' | 'claude' | 'shu'
    model TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,         -- ISO 8601
    last_active_at TEXT NOT NULL,
    turns INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,              -- UUID
    session_id TEXT NOT NULL REFERENCES chat_sessions(id),
    role TEXT NOT NULL,               -- 'user' | 'assistant' | 'system' | 'tool'
    content TEXT NOT NULL DEFAULT '',
    tool_name TEXT,                   -- NULL for non-tool messages
    tool_input TEXT,                  -- JSON string for tool_use
    tool_output TEXT,                 -- for tool_result
    created_at TEXT NOT NULL,         -- ISO 8601
    cost_usd REAL,
    duration_ms INTEGER,
    metadata TEXT                     -- JSON blob for extra fields
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON chat_messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_agent_active ON chat_sessions(agent, is_active);
```

### Pydantic Models (server/chat/models.py)

```python
class ChatRequest(BaseModel):
    message: str = Field(..., max_length=10000)
    session_id: str | None = None
    model: str | None = None

class ChatResponse(BaseModel):
    success: bool
    response: str = ""
    session_id: str = ""
    turns: int = 0
    cost_usd: float = 0.0
    duration_ms: int = 0
    error: str | None = None

class ChatEvent(BaseModel):
    type: str  # "token" | "tool_call" | "tool_result" | "done" | "error" | "heartbeat" | "cancelled"
    channel: str  # "arete" | "claude" | "shu"
    request_id: str
    content: str = ""
    tool_name: str | None = None
    tool_input: str | None = None
    tool_output: str | None = None
    session_id: str | None = None
    cost_usd: float | None = None
    duration_ms: int | None = None
```

## 5. API Design

### POST /api/chat/arete
- **Auth:** ACC_API_TOKEN (Bearer header)
- **Body:** `ChatRequest`
- **Response:** `ChatResponse`
- **Timeout:** 180s (LONG_RUNNING)
- **Implementation:** Spawns `hermes chat -q "<message>" --quiet --max-turns 1 [--resume <session_id>]` via `asyncio.create_subprocess_exec`. Captures stdout, parses response. Publishes ChatEvent(type="done") to SSE when complete.
- **Concurrency:** Mutex per agent — returns 409 if a request for ARETE is already in-flight.

### POST /api/chat/claude
- **Auth:** ACC_API_TOKEN (Bearer header)
- **Body:** `ChatRequest` (model field required for Claude)
- **Response:** `{ "success": true, "request_id": "..." }` — returns immediately
- **Timeout:** Returns immediately; actual processing streams via SSE
- **Implementation:** Spawns `claude.exe -p "<message>" --model <model> --output-format stream-json` via `asyncio.create_subprocess_exec`. Parses each line of stdout as JSON. For each parsed event, publishes ChatEvent to SSE. Also supports fallback: `ollama launch claude --model <model> -- -p "<message>" --output-format stream-json`.
- **Concurrency:** Mutex per agent — returns 409 if Claude is already processing.

### GET /api/chat/claude/stream/{request_id}
- **Auth:** Query param `?token=<ACC_API_TOKEN>` (SSE can't send headers)
- **Response:** SSE stream of ChatEvent objects
- **Implementation:** Subscribes to EventBus filtered by request_id. Streams events until type="done" or type="error".

### POST /api/chat/shu
- **Auth:** ACC_API_TOKEN (Bearer header)
- **Body:** `ChatRequest`
- **Response:** `{ "success": true, "sent_at": "..." }`
- **Timeout:** 15s for the HTTP POST to Shu's Tailscale endpoint
- **Implementation:** HTTP POST to `http://100.85.6.14:8765/msg` with `{"from": "arete", "content": "<message>", "type": "chat", "timestamp": "<ISO8601>"}`. Also appends to `~/from_shu.jsonl` as an outbound record.

### GET /api/chat/shu/messages
- **Auth:** ACC_API_TOKEN (Bearer header)
- **Query params:** `?since=<ISO8601>&limit=50`
- **Response:** `{ "messages": [ChatMessage...], "has_more": bool }`
- **Implementation:** Reads `~/from_shu.jsonl`, filters `sender == "shu"` (NOT "shu-trading"), returns messages after `since` timestamp.

### GET /api/chat/arete/models
- **Auth:** ACC_API_TOKEN
- **Response:** `{ "models": [...], "current": "..." }`
- **Implementation:** Reads available models from Hermes config or `hermes model list`.

### GET /api/chat/claude/models
- **Auth:** ACC_API_TOKEN
- **Response:** `{ "models": [...], "current": "kimi-k2.6:cloud" }`
- **Implementation:** Reads `~/ollama_cloud_models_cache.json`. Falls back to hardcoded list.

### DELETE /api/chat/{agent}/cancel
- **Auth:** ACC_API_TOKEN
- **Response:** `{ "success": true, "cancelled": true }`
- **Implementation:** Sends SIGTERM to the running subprocess for the agent. Publishes ChatEvent(type="cancelled"). Cleans up process.

### SSE Auth Pattern for Chat
The existing SSE endpoint `/api/events` is exempt from auth because EventSource can't send custom headers. The new `/api/chat/claude/stream/{request_id}` endpoint uses a **query-param token**: `?token=<ACC_API_TOKEN>`. This is read from `localStorage` on the frontend and appended to the SSE URL. The token is validated server-side against `ACC_API_TOKEN` env var.

**Security consideration:** Query params appear in server logs and browser history. Mitigated because: (1) this is localhost-only, (2) the token is already stored in localStorage for other API calls, (3) we use a short-lived request-specific token in future versions. For v1, query-param token is acceptable.

## 6. State Management

### Server-side state (in-memory + SQLite)
- `_chat_sessions: dict[str, ChatSession]` — active sessions by agent, in-memory for fast access
- `_chat_processes: dict[str, asyncio.subprocess.Process]` — running subprocesses by agent
- `_chat_mutex: dict[str, asyncio.Lock]` — one lock per agent for concurrency control
- SQLite `chat_sessions` + `chat_messages` tables — durable persistence, rehydrated on startup

### Client-side state
- `useChat` hook manages:
  - `messages: ChatMessage[]` — chat history for current agent
  - `activeAgent: string` — current tab
  - `isProcessing: boolean` — whether a request is in-flight
  - `session: ChatSession | null` — current session info
  - `streamingContent: string` — in-progress streaming text (Claude Code)
- Messages stored in React state, rehydrated from `GET /api/chat/{agent}/messages?session_id=X` on mount
- No localStorage for chat messages — server is source of truth

## 7. Security Model

### Subprocess Security
- ALL subprocess calls use `asyncio.create_subprocess_exec()` with explicit arg list — NEVER `shell=True`
- User message is passed as a **command-line argument**, not interpolated into a shell string
- For messages containing quotes or special chars, pass via **stdin pipe** instead of CLI arg:
  ```python
  proc = await asyncio.create_subprocess_exec(
      "hermes", "chat", "-q", "--quiet", "--max-turns", "1",
      stdin=asyncio.subprocess.PIPE,
      stdout=asyncio.subprocess.PIPE,
      stderr=asyncio.subprocess.PIPE,
  )
  proc.stdin.write(message.encode())
  proc.stdin.write_eof()
  ```
- This eliminates shell injection entirely — the message never touches a shell interpreter

### SSE Auth
- `/api/chat/claude/stream/{request_id}?token=X` — token validated server-side
- Token stripped from logged URLs (server-side URL redaction middleware)

### Rate Limiting
- Per-path rate limits: `/api/chat/arete` 10/min, `/api/chat/claude` 10/min, `/api/chat/shu` 20/min
- Uses existing slowapi infrastructure

### Cost Control
- Optional `max_budget_usd` param on ChatRequest (default: 1.0)
- For Claude Code: pass `--max-budget-usd` flag to subprocess
- For ARETE: no native budget support — rely on max_turns=1

### Input Validation
- Message max length: 10,000 chars (enforced by Pydantic)
- Model name: validated against known model list (prevents path traversal)
- Session ID: validated as UUID format (prevents injection)

## 8. Deployment Architecture

No changes to existing deployment. Chat panel is:
- A new tab in the existing FastAPI app
- New `server/chat/` Python package (no new pip dependencies beyond stdlib)
- New `web/src/chat/` React components (no new npm dependencies)
- New SQLite tables created on startup (existing init_db pattern)
- Runs on same 127.0.0.1:8643
- Requires `hermes` in PATH (already available)
- Requires `claude.exe` at `/mnt/c/Users/Iniolu/.local/bin/claude.exe` (already available)
- Requires Tailscale connectivity to 100.85.6.14 for Shu chat
