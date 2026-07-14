# ACC Dashboard — Full Audit Report

**Date:** 2026-05-27  
**Auditor:** ARETE (Scout deep research + live audit)  
**Dashboard URL:** http://127.0.0.1:8643 (Tailscale: http://100.82.7.2:8643)

---

## Executive Summary

22 tabs across 5 sidebar groups. 21 of 27 API endpoints return 200. 6 endpoints are broken (3 × 500, 1 × 422, 1 × 404, 1 × 500 for briefing). Several tabs overlap significantly. Information density is low on many panels. No consistent empty/error/loading states. The sidebar grouping is good but some panels are dead weight.

**Overall production readiness: 5.5/10**

---

## API Endpoint Status

| Status | Count | Endpoints |
|--------|-------|-----------|
| ✅ 200 OK | 21 | overview, agents, errors, health/score, memory, trends, skills, vault/vitals, cron, cron/dashboard, schedule, pipeline, content, board, trading, mailbox, health, monitoring, projects, ibcb, inference/usage |
| ❌ 500 Error | 4 | sessions, activity, context-gaps, briefing |
| ❌ 422 Validation | 1 | search (requires `?q=` query param — not a real error, just needs param) |
| ❌ 404 Not Found | 1 | dispatch |

**Root cause of 500s:** Assertion errors on uninitialized adapters. `_hermes.recent_sessions()` and `_shu.recent_sessions()` likely fail because Shu adapter isn't connected. `_activity`, `_context`, and `_briefing` engines also have assertion failures or missing dependencies.

---

## Tab-by-Tab Audit

### COMMAND Group (pinned, never collapses) — Score: 6/10

#### 1. OPS (Overview) — Score: 7/10
- **What works:** Live agent status, VPS stats, activity chart, session counters
- **What's broken:** Slow initial load ("INITIALIZING OVERVIEW..." state). Canvas sparkline redraws create CPU overhead. Stats strip data occasionally stale.
- **Missing:** No loading skeleton — just "INITIALIZING" text. No error state if `/api/overview` fails.
- **Redundancy:** Some overlap with Health panel (both show agent status).
- **Military-grade issue:** No "status at a glance" strip that conveys system health in <3 seconds. No severity indicators on cards.

#### 2. AGENTS — Score: 6/10
- **What works:** Agent cards with status, model info, 7-day activity bars
- **What's broken:** Only shows 5 agents (arete, shu, claude-code, scout, scribe). Missing reach and dev agents. Some cards show stale data.
- **Missing:** No agent health check latency. No circuit breaker status display. No last-error indicator per agent.
- **Redundancy:** Overlaps with Health panel.
- **Military-grade issue:** No unified health compass. Agent cards don't show incident/alert indicators.

#### 3. ERRORS — Score: 4/10
- **What works:** Shows error list from `/api/errors`
- **What's broken:** Minimal display. No grouping. No fingerprinting. No severity classification.
- **Missing:** No error dashboard (separate tab exists but disconnected). No auto-ack. No escalation path. No time-series view.
- **Military-grade issue:** CRITICAL — In military dashboards, errors are THE most prominent element. Red bordered, pulsing, audible-alert-capable. Here they're just a list.

#### 4. HEALTH — Score: 5/10
- **What works:** Shows health score, individual agent health
- **What's broken:** Minimal display. Score number without context (what's good? what's bad?).
- **Missing:** No health history/trend. No thresholds visualization. No SLA/SLO indicators.
- **Military-grade issue:** No color-coded health bands (green/yellow/red). No degraded state indicator.

---

### WORK Group — Score: 5/10

#### 5. TASKS — Score: 7/10
- **What works:** 3-column kanban (Pending/In Progress/Done). Add task modal. Delete/move buttons.
- **What works well:** Independent of SSE, optimistic updates with revert.
- **What's broken:** No drag-and-drop. Priority chips but no sorting options. No filtering.
- **Missing:** No task assignment. No due dates. No tags. No search.

#### 6. SCHED (Schedule) — Score: 6/10
- **What works:** Shows hermes and system cron jobs. Schedule display with next-run times.
- **What's broken:** Read-only. No way to trigger or edit jobs.
- **Missing:** No calendar view. No job history. No run logs.

#### 7. CRON — Score: 5/10
- **What works:** Shows cron dashboard with job details
- **What's broken:** Overlaps heavily with Schedule. Same data, different view.
- **Redundancy:** HIGH — Schedule and Cron show the same information. The council review already decided to keep them separate for security reasons, but the UX doesn't differentiate them enough.
- **Missing:** No run/trigger button. No last-run status/result.

#### 8. PIPELINE — Score: 4/10
- **What works:** Shows Scout→Scribe→Reach pipeline status
- **What's broken:** Minimal visual representation. Doesn't show pipeline history or current items in flight.
- **Missing:** No pipeline re-run. No stage-level detail. No failure visualization.

#### 9. CONTENT — Score: 5/10
- **What works:** Content items display and edit
- **What's broken:** Basic CRUD without rich editing.
- **Missing:** No version history. No diff view. No approval workflow.

#### 10. BRIEF — Score: 2/10
- **What works:** NOTHING — `/api/briefing` returns 500
- **What's broken:** Panel loads but shows errors or empty state. Entire endpoint is broken.
- **Action:** Fix the briefing endpoint or disable the tab.

---

### INTEL Group — Score: 3/10

#### 11. SESSIONS — Score: 2/10
- **What works:** NOTHING — `/api/sessions` returns 500
- **What's broken:** Entire endpoint broken. Panel is dead.
- **Action:** Fix the Shu adapter initialization or make sessions resilient to Shu being offline.

#### 12. ACTIVITY — Score: 2/10
- **What works:** NOTHING — `/api/activity` returns 500
- **What's broken:** `_activity` engine assertion failure.
- **Action:** Fix the activity engine initialization.

#### 13. CONTEXT — Score: 2/10
- **What works:** NOTHING — `/api/context-gaps` returns 500
- **What's broken:** `_context` engine assertion failure.
- **Action:** Fix or disable.

#### 14. MEMORY — Score: 5/10
- **What works:** Shows agent memory dump for arete
- **What's broken:** Basic JSON display. No search. No edit. No diff between agents.
- **Missing:** No memory search. No memory timeline. No gap analysis.

#### 15. TRENDS — Score: 5/10
- **What works:** Shows session/error trend data
- **What's broken:** Basic charts without drill-down. No time range selector.
- **Missing:** No session duration trends. No cost trends. No model usage trends.

---

### TOOLS Group — Score: 5/10

#### 16. SEARCH — Score: 4/10
- **What works:** Full-text search across sessions, vault, skills
- **What's broken:** Requires `?q=` parameter via URL — search input may not work. No auto-index trigger.
- **Missing:** No search suggestions. No faceted filters. No result previews.

#### 17. SKILLS — Score: 5/10
- **What works:** Lists available skills
- **What's broken:** Basic list display without categories.
- **Missing:** No skill search. No run button. No usage statistics.

#### 18. VAULT — Score: 5/10
- **What works:** Vault file vitals and analytics
- **What's broken:** Basic display.
- **Missing:** No file browser. No content preview.

#### 19. DASHBOARD (errors-dashboard) — Score: 3/10
- **What works:** Shows ErrorDashboard component
- **Redundancy:** CRITICAL — This is the SAME data as the ERRORS tab but in dashboard format. The merged errors panel (per navConfig design) was supposed to merge these, but they still exist as separate tabs.
- **Action:** Merge into the ERRORS tab as an internal List/Dashboard toggle (per the sidebar redesign proposal).

#### 20. MAILBOX — Score: 5/10
- **What works:** Tailscale feed panel showing message feed
- **What's broken:** Shows raw message data. No filtering.
- **Missing:** No reply functionality. No compose.

#### 21. PROJECTS — Score: 5/10
- **What works:** Project cards with details
- **What's broken:** Basic display.
- **Missing:** No project progress tracking. No kanban link.

---

### AGENTS Group — Score: 5/10

#### 22. CLAUDE CODE — Score: 4/10
- **What works:** Shows Claude Code sessions
- **What's broken:** Read-only view. No interaction.
- **Missing:** No task status. No diff view.

#### 23. CHAT — Score: 5/10
- **What works:** Chat interface with agent selection
- **What's broken:** Basic chat without rich formatting.
- **Missing:** No conversation history persistence. No file attachment.

#### 24. TRADING — Score: 5/10
- **What works:** Shows Shu trading messages
- **What's broken:** Read-only feed without trade execution.
- **Missing:** No position tracking. No P&L. No alerts.

---

## Critical Findings Summary

### Broken (Must Fix — P0)
1. **4 API endpoints return 500:** `/api/sessions`, `/api/activity`, `/api/context-gaps`, `/api/briefing` — all assertion failures on uninitialized adapters. Makes 5 tabs completely dead.
2. **Errors tab is too weak** — In an ops dashboard, errors should be the MOST prominent element, not a plain list.

### Redundant (Should Merge — P0)
3. **Schedule + Cron overlap** — Same data, different views. Needs clear differentiation or merger.
4. **Errors + Errors-Dashboard** — Two tabs for the same data source. Should be one tab with List/Dashboard toggle.

### Missing (Should Add — P1)
5. **No loading skeletons** — Just "INITIALIZING..." text and blank screens.
6. **No error boundaries per panel** — One broken panel can crash the whole dashboard if ErrorBoundary doesn't catch it.
7. **No global search (Ctrl+K)** — CommandPalette component exists but isn't wired.
8. **No severity color system** — No consistent red/yellow/green for health/errors/status.
9. **No stale data indicators** — No "last updated X seconds ago" or timestamp on data.

### Low Quality (Should Improve — P2)
10. **Briefing panel** — Completely broken (500). Remove or fix.
11. **Pipeline panel** — Minimal, needs better visualization.
12. **Context/Memory** — Raw JSON dumps, not usable.
13. **Trends** — No time range selector, no drill-down.
14. **IBCB Feed** — Not in sidebar nav, orphaned panel (only accessible via direct URL or if linked).

### Not in NavConfig (Orphaned)
15. **DispatchPanel.jsx** — Exists in panels/ but not in sidebar.
16. **IBCBFeedPanel.jsx** — Has an API endpoint but not in the sidebar.
17. **TailscaleFeedPanel.jsx** — Mapped under "mailbox" in navConfig. Confusing naming.

---

## Tab Consolidation Recommendations

| Current | Recommendation | Reason |
|---------|---------------|--------|
| Errors + Errors-Dashboard | **Merge into Errors with List/Dashboard toggle** | Same data, same purpose |
| Schedule + Cron | **Keep separate but add visual differentiation** | Security profiles differ per council review |
| Sessions + Activity | **Merge into Sessions with Activity tab** | Activity is a view of session data |
| Context + Memory | **Merge into Memory with Context sub-tab** | Both are about agent knowledge state |
| Briefing | **Fix or remove** | Currently broken (500) |
| IBCB Feed | **Add to TOOLS group or remove** | Orphaned panel |

---

## Military-Grade Design Gaps

Based on the Scout research report (`military-dashboard-research.md`):

1. **No health compass** — Military dashboards provide system status at <3 second glance. We have no unified status indicator.
2. **No severity hierarchy** — All errors look the same. No CRITICAL/WARNING/INFO classification.
3. **No alert ticker** — No bottom-of-screen scrolling alert bar for incidents.
4. **No stale data indicators** — Operators can't tell if data is 5 seconds or 5 minutes old.
5. **No keyboard navigation** — Ctrl+K command palette exists in code but isn't functional.
6. **Low information density** — Many panels show 3-5 data points per screen. Military dashboards show 25-35.
7. **No audit trail** — No operator action log (who acknowledged what, when).
8. **No escalation paths** — No "escalate to human" or "create incident" buttons.

---

## Overall Scores by Group

| Group | Score | Notes |
|-------|-------|-------|
| COMMAND | 6/10 | Core data works but errors/health are too weak |
| WORK | 5/10 | Tasks is good, Schedule/Cron redundant, Pipeline/Content basic |
| INTEL | 3/10 | 3 of 5 tabs completely broken (500 errors) |
| TOOLS | 5/10 | Search needs work, Dashboard redundant, Skills/Vault basic |
| AGENTS | 5/10 | Chat works, others are read-only |

**Overall: 5.5/10** — Functional for core monitoring but not production-ready for ops use. 5 dead tabs, 2 redundant tabs, no severity system, no loading states.