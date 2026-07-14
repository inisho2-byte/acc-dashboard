# PRD — Agent Chat Panel

## Goal
Add a live terminal-style chat panel to the ACC Dashboard enabling direct conversation with ARETE (Hermes CLI), Claude Code (Ollama-launched CLI), and Shu (Tailscale mailbox).

## Target User
SilverX — single operator managing multiple AI agents from one dashboard. Technical, prefers minimal UI, runs ARETE on WSL laptop + Shu on desktop via Tailscale.

## Core Features
1. **3-channel chat interface** — ARETE, Claude Code, Shu — each with distinct connection method (subprocess, streaming subprocess, async HTTP)
2. **Terminal-style chat UI** — dark theme, JetBrains Mono, orange accents, left info sidebar + right chat pane, modeled after the Gemini Code reference
3. **Session continuity** — ARETE and Claude Code sessions persist within a server run (session IDs stored server-side)
4. **Model selection** — dropdown populated from Hermes config (ARETE) and Ollama cloud model cache (Claude Code)
5. **Streaming output** — Claude Code streams token-by-token via SSE; ARETE returns full response; Shu is async (send + poll)
6. **Tool call rendering** — Claude Code tool_use/tool_result blocks shown as collapsible inline cards
7. **Chat history** — messages stored server-side in SQLite, rehydrated on page refresh
8. **Cancel support** — stop button kills the running subprocess and inserts [cancelled] marker
9. **Auto-scroll with override** — scrolls to bottom on new content unless user scrolled up, then shows "new messages" badge

## Explicitly Out of Scope
- Multi-user chat (this is a single-operator dashboard)
- Chat with agents beyond the 3 listed (Codex, Kimi, etc. — future extensibility only, not built now)
- File attachments / image uploads in chat messages
- Persistent sessions across server restarts (session IDs lost on restart — v2 feature)
- Full PTY interactive mode for any agent
- Voice input/output
- Chat message search (existing search engine covers sessions)
- Mobile-responsive layout (desktop-only for v1)

## Success Criteria
- User can send a message to any of the 3 agents and receive a response in the chat panel
- Claude Code responses stream token-by-token with visible tool call cards
- ARETE responses show a progress indicator during the 30-180s wait
- Shu messages show sent/delivered/response state badges
- Chat history persists across tab switches within the same browser session
- Switching models via dropdown works without losing chat context
- Cancel button terminates a running subprocess within 2s
- No shell injection possible via user input

## User Journeys

### Journey 1: Chat with ARETE
1. User clicks "chat" tab in activity monitor
2. ARETE tab is selected by default (first agent in tab bar)
3. Left sidebar shows: status (online/offline), current model, session ID (null), turns (0)
4. User types "check the dashboard health" and presses Enter
5. Input clears, user message appears right-aligned in chat
6. Progress indicator: "ARETE is thinking..." with animated dots (0-10s), then elapsed timer (>10s)
7. After 30-180s, ARETE response appears left-aligned with agent icon
8. Session ID, turn count, duration update in sidebar
9. User types follow-up — sent with --resume <session_id> for context continuity

### Journey 2: Chat with Claude Code
1. User clicks "CLAUDE" tab
2. Left sidebar shows: status, current model (kimi-k2.6:cloud), model dropdown
3. User types "fix the typecheck errors" and presses Enter
4. User message appears right-aligned
5. Claude Code response streams token-by-token — text appears character by character
6. When Claude Code invokes a tool, a collapsible card appears: [🔧 Bash: ls -la]
7. Tool result appears inside the card (auto-collapsed if >15 lines)
8. Stream completes, turn count increments, cost updates in sidebar

### Journey 3: Send task to Shu
1. User clicks "SHU" tab
2. Left sidebar shows: Tailscale status (reachable/unreachable), peer IP, last response time
3. User types "run the forex scanner" and presses Enter
4. User message appears right-aligned with "Sent" badge (gray)
5. Badge transitions to "Processing" (orange pulse) after Shu acknowledges
6. User can continue using other tabs while waiting
7. When Shu's response arrives in ~/from_shu.jsonl, badge turns to "Complete" (green)
8. Shu's response appears left-aligned in chat
9. If Shu doesn't respond in 5min, badge shows "No response" (amber) with retry link

## Constraints
- C1 (HARD): No TypeScript. Frontend is pure JSX.
- C2 (HARD): No new external state management library (no Zustand, Redux, etc.)
- C3 (HARD): All subprocess calls must use create_subprocess_exec (never shell=True) to prevent injection
- C4 (HARD): SSE endpoints for chat must be exempt from ACC_API_TOKEN auth (EventSource can't send headers) OR use query-param token
- C5 (SOFT): Match existing ACC dashboard visual style (cyan ARETE, purple Shu, orange accents)
- C6 (SOFT): Chat panel should not exceed 500 lines of JSX (split into sub-components if needed)
- C7 (HARD): Long-running chat routes must be in LONG_RUNNING_PREFIXES (180s timeout)
- C8 (HARD): Max one pending request per agent channel (mutex per agent)
- C9 (SOFT): Cost awareness — show estimated cost per message in sidebar where available
