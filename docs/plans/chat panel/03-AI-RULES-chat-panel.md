# AI Rules — Agent Chat Panel

## Language/Framework Rules
- **Backend:** Python 3.12+, async-first, Pydantic v2 models, no `any` types
- **Frontend:** React 18 + JSX (NOT TypeScript). No `.ts`/`.tsx` files
- **No new npm dependencies** unless explicitly approved. No react-virtuoso, no markdown-it (use existing DOMPurify)
- **No new pip dependencies** unless explicitly approved. Subprocess + stdlib only
- **All subprocess calls** use `asyncio.create_subprocess_exec()` with explicit arg lists. `shell=True` is a firing offense
- **All Python functions** have type annotations on all parameters and return types
- **No class components** in React. Functional components + hooks only

## Security Rules
- **S1:** User messages NEVER interpolated into shell commands. Pass via stdin pipe or as explicit exec args
- **S2:** Model names validated against a known allowlist (from config or cache file). Reject any model name containing `/`, `..`, or path separators
- **S3:** Session IDs validated as UUID format before use in subprocess args or DB queries
- **S4:** SSE endpoints use query-param token auth (EventSource limitation). Token validated server-side against ACC_API_TOKEN
- **S5:** All chat routes require ACC_API_TOKEN auth (except SSE which uses query-param)
- **S6:** Subprocess stdout/stderr captured completely — never leaks to the HTTP response unfiltered
- **S7:** Chat messages sanitized with DOMPurify before rendering (same pattern as DispatchPanel)
- **S8:** Rate limiting: 10/min for ARETE and Claude chat, 20/min for Shu chat
- **S9:** No logging of full user messages at INFO level (log length + session_id only, content at DEBUG)
- **S10:** Max message length 10,000 chars enforced by Pydantic. Return 422 on violation

## Code Style
- Python: ruff check passes, no bare except, no unused imports
- JSX: match existing panel patterns (DispatchPanel, TradingPanel as reference)
- ChatPanel.jsx must NOT exceed 200 lines — split into sub-components in `web/src/chat/`
- Each sub-component: <150 lines
- `useChat.js` hook: <200 lines
- Server-side: each engine file <200 lines
- API routes for chat in `server/api/__init__.py`: add new router or keep in same file but sectioned clearly

## Testing Rules
- Unit tests for: session_store.py, Pydantic models, subprocess arg construction
- Integration tests for: chat API routes with mocked subprocesses (FakeRunner pattern)
- Contract tests (marked @pytest.mark.slow): one real `hermes chat -q "echo hello"` test, one real `claude.exe -p "echo hello" --max-budget-usd 0.01` test
- No tests that require Shu to be online — mock the Tailscale HTTP POST
- Frontend: no automated tests required (manual verification via browser)
- Mock pattern: `FakeRunner` class that yields pre-recorded JSONL events with configurable delays

## Performance Rules
- Max 1 pending subprocess per agent (mutex lock). Return 409 if already processing
- Subprocess timeout: 180s for ARETE/Claude, 15s for Shu POST
- Chat messages API: paginated, max 100 messages per request
- SQLite queries for chat: use indexes on (session_id, created_at)
- No N+1 queries: load messages for a session in one query
- SSE heartbeat every 30s to detect dead connections
- JSONL polling for Shu: 5s interval, only while Shu tab is active (not when tab is hidden)

## Documentation Rules
- Every public function in server/chat/ has a docstring
- Every React component has a brief JSDoc comment
- AGENTS.md updated with chat panel architecture section
- acc-dashboard SKILL.md updated with chat panel pitfalls
