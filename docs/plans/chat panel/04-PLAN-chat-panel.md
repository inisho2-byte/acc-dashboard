# Plan / Roadmap — Agent Chat Panel

## Milestones

### M1: Backend Chat Engine (Foundation)
**Done when:** All 3 chat engines work in isolation (tested via curl). SQLite tables created. Subprocess spawning works for ARETE and Claude Code. Shu HTTP POST works.

### M2: API Routes + SSE Streaming
**Done when:** All 6 chat API endpoints respond correctly. Claude Code SSE streaming works. Cancel endpoint works. Rate limiting applied. Auth enforced.

### M3: Frontend Chat Panel
**Done when:** ChatPanel tab renders with 3 agent tabs. Messages display correctly. Claude Code streams in real-time. ARETE shows progress indicator. Shu shows state badges. Model dropdown works. Chat history rehydrates on page refresh.

### M4: Polish + Integration
**Done when:** Cancel button works. Auto-scroll works. Keyboard shortcuts work. Tool call cards render. DOMPurify applied. AGENTS.md + SKILL.md updated. Manual end-to-end test passes for all 3 agents.

---

## Tasks

### Phase 1 — Backend Chat Engine (M1)

**Task 1.1: Create server/chat/ package structure**
- Objective: Set up the Python package for chat logic
- Files to create:
  - `server/chat/__init__.py` — empty package marker
  - `server/chat/models.py` — Pydantic models (ChatRequest, ChatResponse, ChatEvent)
- Verification: `python -c "from server.chat.models import ChatRequest"` succeeds

**Task 1.2: Create ChatSessionStore (SQLite persistence)**
- Objective: SQLite tables + CRUD for chat sessions and messages
- Files:
  - `server/chat/session_store.py`
- Implementation:
  - `create_session(agent, model) -> ChatSession` — creates UUID, inserts to DB
  - `get_session(session_id) -> ChatSession | None`
  - `get_active_session(agent) -> ChatSession | None` — returns most recent active session for agent
  - `add_message(session_id, role, content, **kwargs) -> ChatMessage`
  - `get_messages(session_id, limit=100, before=None) -> list[ChatMessage]`
  - `deactivate_session(session_id)` — marks session inactive
  - Tables created in `_ensure_tables()` on first use (same pattern as cron_dashboard)
  - Uses existing `server/db/__init__.py` `get_connection()` context manager
- Verification: Unit test creates session, adds messages, reads them back

**Task 1.3: Create AreteChatEngine**
- Objective: Subprocess wrapper for `hermes chat -q`
- File: `server/chat/arete_chat.py`
- Implementation:
  ```python
  class AreteChatEngine:
      def __init__(self, session_store: ChatSessionStore):
          self._store = session_store
          self._lock = asyncio.Lock()
          self._current_proc: asyncio.subprocess.Process | None = None

      async def send(self, message: str, session_id: str | None, model: str | None) -> ChatResponse:
          if self._lock.locked():
              raise HTTPException(409, "ARETE is already processing a request")
          async with self._lock:
              # Create or resume session
              session = await self._get_or_create_session(session_id, model)
              # Build command
              args = ["hermes", "chat", "-q", "--quiet", "--max-turns", "1"]
              if session.external_id:
                  args += ["--resume", session.external_id]
              if model:
                  args += ["-m", model]
              # Spawn subprocess (message via stdin)
              self._current_proc = await asyncio.create_subprocess_exec(
                  *args,
                  stdin=asyncio.subprocess.PIPE,
                  stdout=asyncio.subprocess.PIPE,
                  stderr=asyncio.subprocess.PIPE,
              )
              self._current_proc.stdin.write(message.encode())
              self._current_proc.stdin.write_eof()
              stdout, stderr = await asyncio.wait_for(
                  self._current_proc.communicate(), timeout=180
              )
              self._current_proc = None
              # Parse response
              response_text = stdout.decode().strip()
              # Extract session_id from hermes output if present
              # Store message in DB
              await self._store.add_message(session.id, "user", message)
              await self._store.add_message(session.id, "assistant", response_text)
              return ChatResponse(success=True, response=response_text, session_id=session.id)

      async def cancel(self):
          if self._current_proc and self._current_proc.returncode is None:
              self._current_proc.terminate()
              await asyncio.sleep(0.5)
              if self._current_proc.returncode is None:
                  self._current_proc.kill()
  ```
- Key: message passed via **stdin pipe**, never as CLI arg (prevents injection)
- Verification: Unit test with mocked subprocess; contract test with real `hermes chat -q "hello"`

**Task 1.4: Create ClaudeChatEngine**
- Objective: Subprocess wrapper for `claude.exe -p` with stream-json parsing
- File: `server/chat/claude_chat.py`
- Implementation:
  ```python
  class ClaudeChatEngine:
      def __init__(self, session_store: ChatSessionStore, event_bus: EventBus):
          self._store = session_store
          self._bus = event_bus
          self._lock = asyncio.Lock()
          self._current_proc: asyncio.subprocess.Process | None = None

      async def send(self, message: str, session_id: str | None, model: str, request_id: str) -> dict:
          if self._lock.locked():
              raise HTTPException(409, "Claude Code is already processing a request")
          async with self._lock:
              session = await self._get_or_create_session(session_id, model)
              # Try claude.exe directly first, fall back to ollama launch
              args = self._build_claude_args(message, model, session)
              self._current_proc = await asyncio.create_subprocess_exec(
                  *args,
                  stdout=asyncio.subprocess.PIPE,
                  stderr=asyncio.subprocess.PIPE,
                  cwd="/mnt/c/Users/Iniolu",
              )
              # Read stdout line-by-line, parse as stream-json
              async for line in self._current_proc.stdout:
                  event = self._parse_stream_json(line)
                  if event:
                      chat_event = ChatEvent(
                          type=event.type, channel="claude",
                          request_id=request_id, content=event.content,
                          tool_name=event.tool_name, session_id=session.id
                      )
                      await self._bus.publish(chat_event)
              await self._current_proc.wait()
              self._current_proc = None
              return {"success": True, "request_id": request_id}

      def _build_claude_args(self, message, model, session):
          """Build args list — try direct claude.exe first."""
          args = [CLAUDE_EXE_PATH, "-p", message, "--model", model,
                  "--output-format", "stream-json", "--max-budget-usd", "1.0"]
          if session.external_id:
              args += ["--resume", session.external_id]
          return args

      def _parse_stream_json(self, line: bytes) -> ChatEvent | None:
          """Parse one line of Claude Code stream-json output."""
          # Claude Code emits: {"type":"assistant","subtype":"text","content":"..."}
          # or {"type":"tool_use","name":"Bash","input":"..."}
          # or {"type":"tool_result","output":"..."}
          # or {"type":"result","subtype":"success","result":"..."}
          ...
  ```
- Key: `--output-format stream-json` gives structured events. Parse each line, publish to EventBus.
- Verification: Unit test with mocked subprocess feeding pre-recorded stream-json lines

**Task 1.5: Create ShuChatEngine**
- Objective: HTTP POST to Shu's Tailscale endpoint + JSONL reader
- File: `server/chat/shu_chat.py`
- Implementation:
  ```python
  class ShuChatEngine:
      SHU_URL = "http://100.85.6.14:8765/msg"

      def __init__(self, session_store: ChatSessionStore, http_client: httpx.AsyncClient):
          self._store = session_store
          self._client = http_client
          self._inbox_path = Path.home() / "from_shu.jsonl"

      async def send(self, message: str) -> dict:
          payload = {
              "from": "arete",
              "content": message,
              "type": "chat",
              "timestamp": datetime.now(timezone.utc).isoformat(),
          }
          try:
              resp = await self._client.post(self.SHU_URL, json=payload, timeout=15)
              resp.raise_for_status()
          except (httpx.ConnectError, httpx.TimeoutException) as exc:
              return {"success": False, "error": f"Shu unreachable: {exc}"}
          return {"success": True, "sent_at": payload["timestamp"]}

      async def get_messages(self, since: str | None, limit: int = 50) -> list[dict]:
          """Read ~/from_shu.jsonl, filter sender=='shu', return after since timestamp."""
          ...
  ```
- Key: reuses existing TailscaleMailboxReader logic but filters for chat messages only
- Verification: Unit test with temp JSONL file; integration test with mocked httpx

### Phase 2 — API Routes + SSE (M2)

**Task 2.1: Add chat routes to server/api/__init__.py**
- Objective: Wire the 6 chat endpoints
- Files: `server/api/__init__.py`
- Changes:
  - Import chat engines in `init_adapters()`, add to `global` statement
  - Add routes: POST /api/chat/arete, POST /api/chat/claude, POST /api/chat/shu, GET /api/chat/shu/messages, DELETE /api/chat/{agent}/cancel, GET /api/chat/arete/models, GET /api/chat/claude/models
  - Add `/api/chat/` to LONG_RUNNING_PREFIXES
  - Add per-path rate limits: chat routes 10/min (arete, claude), 20/min (shu)
- Pitfalls:
  - MUST add new globals (`_arete_chat`, `_claude_chat`, `_shu_chat`, `_chat_store`) to the `global` statement in `init_adapters()`
  - Route ordering: static paths BEFORE parameterized paths (don't let `{agent}` catch "claude" or "shu")
  - Import chat modules lazily to avoid circular imports with server/main.py

**Task 2.2: Add SSE stream endpoint for Claude Code**
- Objective: SSE endpoint that fans out ChatEvents to the browser
- File: `server/api/__init__.py` (new route)
- Implementation:
  ```python
  @router.get("/api/chat/stream/{request_id}")
  async def chat_stream(request_id: str, token: str = Query(...)):
      # Validate token against ACC_API_TOKEN
      if ACC_API_TOKEN and token != ACC_API_TOKEN:
          raise HTTPException(401, "Invalid token")
      async def event_generator():
          queue = asyncio.Queue()
          _bus.subscribe(f"chat:{request_id}", queue)
          try:
              while True:
                  event = await asyncio.wait_for(queue.get(), timeout=45)
                  yield f"data: {event.model_dump_json()}\n\n"
                  if event.type in ("done", "error", "cancelled"):
                      break
          except asyncio.TimeoutError:
              yield f"data: {{'type': 'heartbeat'}}\n\n"
          finally:
              _bus.unsubscribe(f"chat:{request_id}", queue)
      return StreamingResponse(event_generator(), media_type="text/event-stream")
  ```
- Key: query-param auth for SSE; 45s internal timeout triggers heartbeat; auto-cleanup on done/error
- Verification: Test with FakeRunner pumping events, SSE client receives them

**Task 2.3: Update EventBus to support chat subscriptions**
- Objective: Add topic-based subscription to server/events.py
- File: `server/events.py`
- Changes: Add `subscribe(topic, queue)` and `unsubscribe(topic, queue)` methods. When publishing, check if the event has a topic key and route to matching subscribers.
- Verification: Unit test: publish event with topic, subscriber receives it

### Phase 3 — Frontend Chat Panel (M3)

**Task 3.1: Create useChat.js hook**
- Objective: Central hook managing chat state for all 3 agents
- File: `web/src/chat/useChat.js`
- Implementation:
  - State: messages, activeAgent, isProcessing, sessions, streamingContent
  - Methods: sendMessage(agent, text), cancelRequest(agent), switchAgent(agent), newSession(agent), changeModel(agent, model)
  - SSE subscription for Claude Code: opens EventSource to `/api/chat/stream/{request_id}?token=...`
  - Polling for Shu: every 5s while Shu tab is active AND a message has been sent, call `getShuMessages(since)`
  - Auto-rehydrate on mount: load last session for active agent from `GET /api/chat/{agent}/messages`
- Verification: Manual test in browser

**Task 3.2: Create ChatPanel.jsx**
- Objective: Top-level tab component
- File: `web/src/panels/ChatPanel.jsx`
- Implementation:
  - Renders agent tab bar (ARETE | CLAUDE | SHU)
  - Renders ChatSidebar + ChatTerminal in 2-column grid (5:7 ratio matching reference)
  - Wires useChat hook
  - CSS: `gridTemplateColumns: "240px minmax(0, 1fr)"` (avoid overflow pitfall from CSS grid docs)
- Style: dark theme (#141416 background), JetBrains Mono for terminal text, orange (#f97316) accents
  - User messages: right-aligned, bg-[#27272a], orange "User" label
  - Agent messages: left-aligned, bg-[#18181b], cyan for ARETE, amber for Claude, purple for Shu
  - Code blocks: bg-[#0b0b0c] inner box, copy button
- Verification: Renders without errors, tab switching works

**Task 3.3: Create ChatSidebar.jsx**
- Objective: Left info panel per agent
- File: `web/src/chat/ChatSidebar.jsx`
- Content per agent:
  - ARETE: status orb (from existing /api/health), model dropdown, session ID, turns, duration, "New Session" button
  - Claude: status, model dropdown (from ollama_cloud_models_cache), session ID, turns, cost, "New Session" button
  - Shu: Tailscale reachability, peer IP (100.85.6.14), last response time, message count
- Style: bg-[#18181b], border-r, parameter rows with label/value pairs (matching reference "System Parameters" section)

**Task 3.4: Create ChatTerminal.jsx + MessageList.jsx**
- Objective: Right chat pane with scrollable messages
- Files:
  - `web/src/chat/ChatTerminal.jsx` — terminal chrome (header with traffic lights, agent name, session ID)
  - `web/src/chat/MessageList.jsx` — scrollable container with auto-scroll logic
- MessageList auto-scroll logic:
  - Track `isNearBottom` = scrollPosition + viewportHeight >= scrollHeight - 150
  - On new message: if isNearBottom, scroll to bottom; else show "↓ New messages" floating button
  - On ARETE full-response arrival: scroll to START of new response, not bottom
- Verification: Messages render, scroll behavior correct

**Task 3.5: Create message sub-components**
- Files:
  - `web/src/chat/UserMessage.jsx` — right-aligned bubble, orange "User" label
  - `web/src/chat/AgentMessage.jsx` — left-aligned bubble with agent icon, markdown-like rendering (code blocks, bold, lists), DOMPurify sanitized
  - `web/src/chat/ToolCallCard.jsx` — collapsible card: [🔧 ToolName] → expands to show input/output, auto-collapsed if >15 lines
  - `web/src/chat/SystemMessage.jsx` — muted, border-left styled (matching reference)
- Verification: Each renders correctly with sample data

**Task 3.6: Create ChatInput.jsx**
- File: `web/src/chat/ChatInput.jsx`
- Implementation:
  - Terminal-style input bar: agent prefix (e.g., "arete $"), textarea, Enter to send, Shift+Enter for newline
  - Stop button (red) replaces send button while request is in-flight
  - Progress indicator during ARETE wait: animated dots 0-10s, elapsed timer >10s
  - Disabled state when agent is offline
- Style: bg-[#18181b] border-t, input bg-[#0b0b0c] border focus-within:border-orange-500/50
- Verification: Sends message on Enter, newline on Shift+Enter, stop button cancels

**Task 3.7: Add "chat" tab to App.jsx**
- File: `web/src/App.jsx`
- Changes:
  - Add `import ChatPanel from "./panels/ChatPanel"` 
  - Add "chat" to TABS array
  - Add tab label: `TAB_LABELS = { ..., "chat": "CHAT" }`
  - Render `<ChatPanel />` when `activeTab === "chat"`
- Verification: Chat tab appears in tab bar, clicking it renders ChatPanel

### Phase 4 — Polish + Integration (M4)

**Task 4.1: ARETE progress feedback**
- Objective: Show meaningful progress during 30-180s ARETE wait
- Implementation:
  - In AreteChatEngine: publish heartbeat ChatEvents every 10s while subprocess is running
  - Frontend: ChatInput shows 3 states: (1) "ARETE is thinking..." (animated dots, 0-10s), (2) "ARETE is thinking... 45s elapsed" (>10s), (3) Response arrives
- Verification: Send a complex ARETE query, see progress states in UI

**Task 4.2: Shu state badges**
- Objective: Show sent/processing/complete/no-response states for Shu messages
- Implementation:
  - After POST to Shu: show "Sent" gray badge
  - Poll for response: if response appears, show "Complete" green badge
  - After 5min without response: show "No response" amber badge with "Retry" link
  - Toast notification when Shu response arrives while user is on another tab
- Verification: Send message to Shu, observe badge transitions

**Task 4.3: Cancel button end-to-end**
- Objective: Stop a running subprocess from the UI
- Implementation:
  - Frontend: Stop button → `DELETE /api/chat/{agent}/cancel`
  - Backend: sends SIGTERM to process, waits 2s, SIGKILL if still alive
  - Publishes ChatEvent(type="cancelled") to SSE
  - Frontend: inserts [Cancelled] system message in chat
- Verification: Start a long ARETE query, click stop, see cancelled message within 3s

**Task 4.4: Auto-scroll behavior**
- Objective: Smart scroll — auto-scroll when at bottom, stop when scrolled up
- Implementation: Task 3.4 logic + "New messages" floating badge
- Verification: Send message while at bottom (auto-scrolls), scroll up, send message (badge appears), click badge (scrolls down)

**Task 4.5: Copy code blocks**
- Objective: Copy button on every code block
- Implementation: In AgentMessage.jsx, detect `<code>` blocks, render copy button, `navigator.clipboard.writeText()`
- Verification: Click copy on a code block, paste elsewhere, content matches

**Task 4.6: DOMPurify for all chat content**
- Objective: Sanitize all external content (agent responses, tool outputs) with DOMPurify
- Implementation: `{DOMPurify.sanitize(content || "")}` in AgentMessage and ToolCallCard
- Verification: Send a message that returns HTML-like content, verify it's escaped not rendered

**Task 4.7: Update AGENTS.md and SKILL.md**
- Files:
  - `AGENTS.md` — add chat panel section to Pillar 3 (directory topology) + Pillar 4 (operational boundaries for chat subprocess lifecycle)
  - `~/.hermes/skills/software-development/acc-dashboard/SKILL.md` — add chat panel to frontend pages, API routes, data flow, pitfalls
- Key pitfalls to document:
  - `claude.exe` from WSL requires Windows path, not WSL path
  - `hermes chat -q` via stdin pipe, not CLI arg (injection prevention)
  - SSE query-param auth (not header auth)
  - Long-running prefix for /api/chat/ routes
  - Mutex per agent (409 on concurrent requests)

**Task 4.8: End-to-end manual test**
- Objective: Verify all 3 channels work in the live dashboard
- Steps:
  1. Start dashboard (backend + frontend)
  2. Open chat tab
  3. Send "hello" to ARETE → verify response appears
  4. Switch to Claude tab → send "echo hello" → verify streaming + tool cards
  5. Switch to Shu tab → send "test" → verify sent badge, then response badge
  6. Test cancel: send long query to ARETE, click stop → verify cancelled
  7. Test model switch: change ARETE model, send message → verify new model used
  8. Test page refresh: refresh browser, return to chat tab → verify history rehydrated
  9. Test concurrent: send to ARETE, immediately try to send again → verify 409 error shown

---

## Dependency Graph

```
1.1 ──→ 1.2 ──→ 1.3 (AreteChatEngine needs SessionStore)
                  1.4 (ClaudeChatEngine needs SessionStore + EventBus)
                  1.5 (ShuChatEngine needs SessionStore)
                          │
                          ▼
                     2.1 (API routes need all 3 engines)
                     2.2 (SSE stream needs EventBus + ClaudeChatEngine)
                     2.3 (EventBus updates needed by 2.2)
                          │
                          ▼
                     3.1 (useChat hook needs API endpoints)
                     3.2 ──→ 3.3, 3.4, 3.5, 3.6 (sub-components)
                     3.7 (App.jsx integration)
                          │
                          ▼
                     4.1-4.8 (polish, independent of each other)
```

## Risk Mitigation

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|-----------|
| `ollama launch claude -- -p` doesn't work (no passthrough) | Medium | High | Fallback: call `claude.exe -p` directly with `--settings` flag to inject Ollama provider config. Or use PTY mode as last resort |
| `hermes chat -q` output parsing fails (format changes) | Low | Medium | Parse stdout flexibly — capture everything between known markers. Log raw output at DEBUG |
| Shu never responds | High | Low | 5min timeout + "No response" badge + retry. This is expected async behavior, not a bug |
| Subprocess zombies on server crash | Medium | Medium | On server startup, scan for orphan processes by PID. On shutdown (SIGTERM handler), kill all running chat subprocesses |
| Claude Code stream-json format changes | Low | High | Parse defensively — unknown event types logged and skipped, not crashed. Pin Claude Code version in docs |
| WSL subprocess spawn takes >5s | Medium | Low | Show "Starting session..." indicator during first spawn. Accept overhead — it's a one-time cost per session |
| SSE connection limit (6 per domain) | Low | Medium | Only 1 SSE connection per chat session. Close on tab hide, reopen on tab show |
