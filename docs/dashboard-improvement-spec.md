# ACC Dashboard — Improvement Specification

**Date:** 2026-05-27  
**Based on:** dashboard-audit.md + military-dashboard-research.md  
**Target:** Production-grade ops dashboard (military-grade)

---

## Section 1: P0 Critical Fixes (Must Fix)

### 1.1 Fix `/api/sessions` — 500 Error
**Root cause:** `_hermes.recent_sessions()` or `_shu.recent_sessions()` fails. The Shu adapter is likely not initialized.
**File:** `server/api/__init__.py` line ~379
**Fix:** Change assertion to graceful degradation:
```python
async def get_sessions(limit: int = 10):
    sessions = []
    if _hermes:
        try:
            sessions.extend(await _hermes.recent_sessions(limit))
        except Exception:
            pass
    if _shu:
        try:
            sessions.extend(await _shu.recent_sessions(limit))
        except Exception:
            pass
    sessions.sort(key=lambda s: s.last_active, reverse=True)
    return sessions[:limit]
```

### 1.2 Fix `/api/activity` — 500 Error
**Root cause:** `_activity` engine assertion failure.
**File:** `server/api/__init__.py` line ~471
**Fix:** Graceful fallback:
```python
async def get_activity(limit, agent_id, event_type):
    if _activity is None:
        return []
    return await _activity.get_timeline(limit=limit, agent_id=agent_id, event_type=event_type)
```

### 1.3 Fix `/api/context-gaps` — 500 Error
**Root cause:** `_context` engine assertion failure.
**File:** `server/api/__init__.py` line ~514
**Fix:** Graceful fallback:
```python
async def get_context_gaps(limit: int = Query(50, le=200)):
    if _context is None:
        return []
    return await _context.get_gaps(limit=limit)
```

### 1.4 Fix `/api/briefing` — 500 Error
**Root cause:** `_briefing` engine assertion failure.
**File:** `server/api/__init__.py` line ~499
**Fix:** Graceful fallback:
```python
async def get_briefing(hours, since):
    if _briefing is None:
        return {"error": "Briefing engine not initialized", "items": []}
    ...
```

### 1.5 Remove `/api/dispatch` — 404
**Root cause:** No route handler for `POST /api/dispatch`.
**Fix:** Either implement or remove the DispatchPanel.jsx reference. The panel exists but isn't in navConfig — remove it from panels/ or add the endpoint.

---

## Section 2: P0 Tab Consolidation

### 2.1 Merge Errors + Errors-Dashboard → Single Errors Panel
**Current:** Two separate tabs (`errors` and `errors-dashboard`) showing the same data.
**Target:** One `errors` tab with internal List/Dashboard toggle (toggle switch in panel header).
**Files to change:**
- `web/src/navConfig.js` — Remove `errors-dashboard` from TOOLS group items
- `web/src/App.jsx` — Change `case "errors"` to render a new `ErrorsPanel.jsx` that contains both views with toggle
- `web/src/panels/ErrorDashboard.jsx` — Merge into new `ErrorsPanel.jsx` as a sub-view
- Derive `ALL_TABS` etc. will auto-update since navConfig is the source of truth

### 2.2 Merge Sessions + Activity → Sessions Panel with Activity Sub-tab
**Current:** `sessions` (500) and `activity` (500) are separate tabs.
**Target:** One `sessions` tab with "List | Activity" toggle.
**Files:**
- `web/src/navConfig.js` — Remove `activity` from INTEL group
- `web/src/App.jsx` — Change `case "sessions"` to render combined panel
- `web/src/panels/TimelinePanel.jsx` — Convert to sub-component of Sessions

### 2.3 Merge Context + Memory → Memory Panel with Context Sub-tab
**Current:** `context` (500) and `memory` (working) are separate.
**Target:** One `memory` tab with "Memory | Context Gaps" toggle.
**Files:**
- `web/src/navConfig.js` — Remove `context` from INTEL group
- `web/src/App.jsx` — Update `case "memory"` to render combined panel
- `web/src/panels/ContextView.jsx` — Convert to sub-component of Memory

### 2.4 Handle Briefing Tab
- If briefing engine is fixable: keep it. If not: remove from navConfig, hide the panel.
- Per audit, it's 500. Try fix first. If briefing engine can't be initialized, add a "Coming Soon" empty state and remove the navConfig entry.

### 2.5 Integrate Orphaned Panels
- **IBCBFeedPanel.jsx** — Add to TOOLS group as `ibcb` id (or remove)
- **DispatchPanel.jsx** — Add to WORK group or remove. Endpoint would need `POST /api/dispatch`.
- **TailscaleFeedPanel.jsx** — Currently mapped as `mailbox`. Rename navConfig label from "MAILBOX" to "NETWORK" or keep "MAILBOX" but clarify it's Tailscale-based.

**After consolidation, navConfig would have:**

| Group | Items |
|-------|-------|
| COMMAND | OPS, AGENTS, ERRORS, HEALTH (4) |
| WORK | TASKS, SCHED, CRON, PIPELINE, CONTENT, BRIEF (6) |
| INTEL | SESSIONS (includes Activity), MEMORY (includes Context), TRENDS (3) |
| TOOLS | SEARCH, SKILLS, VAULT, DASHBOARD → merged into ERRORS, MAILBOX, PROJECTS (4) |
| AGENTS | CLAUDE, CHAT, TRADING (3) |

**Total: 20 → 16 tabs** (removed: errors-dashboard, activity, context; briefing made conditional)

---

## Section 3: P1 UX Improvements (Military-Grade Patterns)

### 3.1 Loading Skeletons
**Pattern:** Every panel shows a pulsing skeleton placeholder while data loads. No "INITIALIZING..." text.
**Implementation:**
- Create `web/src/components/Skeleton.jsx` with variants: `SkeletonRow`, `SkeletonCard`, `SkeletonBar`, `SkeletonCircle`
- Use CSS animation `@keyframes pulse { 0% { opacity: 0.3; } 50% { opacity: 0.6; } 100% { opacity: 0.3; } }`
- Each panel checks `if (loading) return <Skeleton variant="panel" />`

### 3.2 Error Boundaries Per Panel
**Current:** 1 ErrorBoundary wraps all panels in App.jsx.
**Target:** Each panel gets its own ErrorBoundary. If one panel errors, only it crashes — not the whole dashboard.
**Implementation:**
- The `wrap()` function in App.jsx already uses `<ErrorBoundary>`. Ensure it catches and shows a retry button.
- Add a visual error card: icon + message + "Retry" button with a changing `key` prop to force remount.

### 3.3 Severity Color System
**Per MIL-STD-2525D and military dashboard research:**
```css
:root {
  --severity-critical: #ff3b30;  /* Red — immediate action required */
  --severity-high:     #ff9500;  /* Orange — action required soon */
  --severity-medium:   #ffcc00;  /* Yellow — awareness needed */
  --severity-low:      #34c759;  /* Green — nominal/OK */
  --severity-info:      #5ac8fa;  /* Light blue — informational */
  --severity-unknown:  #8e8e93;  /* Gray — no data */
}
```
**Application:**
- Errors tab: classify by severity (error count > 5 = CRITICAL, 1-5 = HIGH)
- Health tab: color the score circle red/yellow/green based on thresholds
- Agent cards: dot indicator green (healthy) / yellow (degraded) / red (down)
- Any status icon: use severity colors consistently

### 3.4 Stale Data Indicators
**Pattern:** Every data-fetching panel shows "Updated Xs ago" or "Updated at HH:MM:SS".
**Implementation:**
- Add `lastUpdated` timestamp to all API responses
- Frontend shows relative time with auto-refresh: "Updated 3s ago" → "Updated 8s ago"
- If data is >60s stale, show yellow WARNING indicator
- If data is >300s stale, show red STALE indicator with "Data may be outdated" message

### 3.5 Health Compass (Overview)
**Pattern:** A single circular status indicator at the top of Overview that conveys system health in <3 seconds.
**Implementation:**
- Add a "Health Compass" component to OverviewPanel
- Circular SVG with 5 segments (one per agent): green = healthy, yellow = degraded, red = down, gray = unknown
- Center shows overall score (0-100)
- Clicking a segment scrolls to the agent detail

### 3.6 Alert Ticker Bar
**Pattern:** A thin bar at the bottom of the screen showing scrolling alerts (like a news ticker or military C2 alert strip).
**Implementation:**
- Add `web/src/components/AlertTicker.jsx`
- Pulls from `/api/errors` and SSE event stream
- Shows: "3 CRITICAL: Agent Shu offline" → "1 HIGH: 5 new errors in last hour"
- Height: 28px fixed, cyan text on dark background, scrolling left
- Click an alert to navigate to the relevant panel
- Can be dismissed per-alert or collapsed

### 3.7 Global Command Palette (Ctrl+K)
**Current:** `CommandPalette.jsx` exists but isn't wired.
**Implementation:**
- Add `useEffect` in App.jsx for `keydown` listener on Ctrl+K / Cmd+K
- Renders `CommandPalette` as overlay
- Items: all 16 tabs (with group labels), "Refresh Data", "Toggle Sidebar", "Search..."
- Filter-as-you-type with fuzzy matching
- Escape to close, Enter to navigate

---

## Section 4: P2 Visual Polish

### 4.1 Group Header Live Stats
- Show badge counts in sidebar group headers
- COMMAND: show error count badge
- WORK: show pending tasks count
- INTEL: show session count
- TOOLS: none needed
- AGENTS: show online agent count

### 4.2 Consistent Panel Layout
- Every panel follows: `PanelHeader` → `StatsStrip` → `Content` → `PanelFooter`
- PanelHeader: title + toggle(s) + "Last updated" timestamp
- StatsStrip: 3-5 key metrics as compact cards
- Content: main panel body (scrollable)
- PanelFooter: actions, pagination, or "View all" links

### 4.3 Better Empty States
- No more blank screens with "No data"
- Each panel has an illustration (CSS-only space/cosmic themed) + message + CTA button
- E.g., "No sessions yet" with a telescope icon and "Start a session →" button

### 4.4 Dark Mode Optimization
- Ensure all text meets WCAG 2.1 AA contrast ratio (4.5:1 for normal text, 3:1 for large text)
- Use `--severity-*` colors at reduced opacity for backgrounds (10-20% opacity fills)
- Add `prefers-color-scheme` media query as fallback

---

## Section 5: Implementation Priority Matrix

| # | Item | Priority | Effort | Impact | Dependencies |
|---|------|----------|--------|--------|--------------|
| 1 | Fix /api/sessions 500 | P0 | S | High | None |
| 2 | Fix /api/activity 500 | P0 | S | High | None |
| 3 | Fix /api/context-gaps 500 | P0 | S | High | None |
| 4 | Fix /api/briefing 500 | P0 | S | High | None |
| 5 | Merge Errors + Dashboard | P0 | M | High | None |
| 6 | Merge Sessions + Activity | P0 | M | Med | #1, #2 |
| 7 | Merge Context + Memory | P0 | M | Med | #3 |
| 8 | Remove / hide dead tabs | P0 | S | Med | #5, #6, #7 |
| 9 | Loading skeletons | P1 | M | High | None |
| 10 | Error boundaries per panel | P1 | S | High | None |
| 11 | Severity color system | P1 | M | High | #10 |
| 12 | Stale data indicators | P1 | S | Med | All APIs |
| 13 | Health compass (Overview) | P1 | M | High | #11 |
| 14 | Alert ticker bar | P1 | L | Med | #11, SSE |
| 15 | Command palette (Ctrl+K) | P1 | M | High | None |
| 16 | Group header live stats | P2 | S | Med | #11 |
| 17 | Consistent panel layout | P2 | L | Med | #9 |
| 18 | Better empty states | P2 | M | Med | None |
| 19 | Dark mode optimization | P2 | S | Low | None |

---

## Section 6: Phased Rollout Plan

### Phase 1: Fix & Consolidate (1-2 days)
- Fix all 500 endpoints (#1-4)
- Merge Errors + Dashboard (#5)
- Merge Sessions + Activity (#6)
- Merge Context + Memory (#7)
- Update navConfig (#8)
- Build and deploy

**Success criteria:** All 16 tabs load without errors. No 500s. Build passes.

### Phase 2: UX & Military-Grade Patterns (2-3 days)
- Add loading skeletons (#9)
- Per-panel error boundaries (#10)
- Severity color system in theme.ts (#11)
- Stale data indicators (#12)
- Health compass on Overview (#13)
- Wire Command Palette (#15)

**Success criteria:** Every panel shows skeleton while loading. Errors are caught per-panel. Severity colors appear on errors, health, agent status. Ctrl+K opens command palette.

### Phase 3: Visual Polish & Advanced (3-5 days)
- Alert ticker bar (#14)
- Group header live stats (#16)
- Consistent panel layout (#17)
- Better empty states (#18)
- Dark mode optimization (#19)

**Success criteria:** Dashboard looks and feels like a military-grade ops center. 25-35 data points visible on Overview. Health status assessable in <3 seconds.