# Military-Grade Dashboard Research Report

**ACC Dashboard — Dark Cosmic Theme Implementation Guide**

Date: 2026-05-27  
Version: 1.0  

---

## Executive Summary

This report synthesizes patterns from 20+ sources spanning military Command & Control (C2) systems, NASA Mission Control, industry observability platforms (Grafana, Datadog, Kibana), Network Operations Centers (NOCs), Security Operations Centers (SOCs), and War Room dashboards. The goal is to extract actionable, implementable design patterns for the ACC Dashboard — a dark-themed, cosmic/space operations React dashboard monitoring AI agents, tasks, schedules, content pipelines, errors, health scores, sessions, memory, vault files, search, trading, and more.

The core thesis: **military-grade dashboards optimize for one thing above all else — situational awareness in under 3 seconds.** Every design decision flows from this imperative.

---

## 1. Information Density — Data Points Per Screen & Cognitive Overload Prevention

### Military C2 Pattern: The "Big Board" Doctrine

Military C2 systems (e.g., NORAD's command center, Aegis Combat System, NORAD Cheyenne Mountain) display 50–200+ data elements simultaneously on wall-sized displays. Individual console operators typically manage 15–35 data points within their immediate field of view, with peripheral awareness of 20+ more on shared displays.

**Key principle: Layered Information Architecture**

- **Layer 0 (Peripheral)**: Ambient status — color-coded borders, pulsing indicators visible without direct attention. Operators "feel" system state through ambient cues.
- **Layer 1 (Glance)**: Key metrics in large type — 5–7 critical numbers visible at arm's length. This is the "commander's glance" layer.
- **Layer 2 (Scanning)**: Detailed panels visible with eye movement but no clicking. Typically 15–25 data points organized in a grid.
- **Layer 3 (Drill-down)**: Requires a click/hover to access. This is where detailed context lives — logs, history, granular charts.

### NASA Mission Control Pattern: Console Specialization

NASA's Mission Control Center (MCC-H at Johnson Space Center) uses a specialized console model. Each flight controller position (called a "console" or "room" position — e.g., BOOST, FAO, GNC, EECOM) is responsible for a specific subsystem. The key design insight:

- **Each console shows 8–12 primary telemetry readouts** in the top half of the screen
- **Trending data in the bottom half** — time-series strips showing the last 30 minutes to 6 hours
- **No console shows everything.** The FLIGHT director position sees a curated summary strip across the top of the room's main display wall

### Observability Platform Patterns

**Grafana** dashboards follow a documented best-practice hierarchy:
- Top row: Summary stats (the "stat panel" pattern — large single values with sparklines)
- Middle rows: Time-series charts organized by subsystem
- Bottom rows: Tables and logs

**Datadog** organizes their default dashboards around the USE method (Utilization, Saturation, Errors) for infrastructure and the RED method (Rate, Errors, Duration) for services. Each dashboard typically contains 6–12 panels, with the most critical metric in the top-left position.

**Kibana** uses a panel-based grid where each visualization occupies a defined grid cell. Dashboards commonly contain 10–24 panels, with filtering controls at the top.

### Actionable Recommendations for ACC Dashboard

1. **Implement the 4-Layer Information Architecture:**
   - Layer 0: Ambient indicators — pulsing cyan dot for healthy, pulsing red for critical, subtle glow on the sidebar icons for active tabs
   - Layer 1: Commander's Strip — a persistent top bar showing 5–7 key metrics (overall health score, active agents count, active errors, pending tasks, queue depth)
   - Layer 2: Main panel content — organized per-tab, 8–15 data points per view
   - Layer 3: Drill-down modals/slide-overs for detail

2. **Density Budget: 25–35 visible data elements per screen.** Military research (Wickens' Multiple Resource Theory, 2002) shows that cognitive capacity for parallel monitoring caps around 7±2 independent data streams, with up to 25–35 manageable when using strong visual grouping and consistent patterns.

3. **Use visual grouping, not whitespace, to organize.** Military displays use thin bordered sections within a dense layout. Group-related metrics (e.g., all health scores together, all schedule metrics together) with subtle borders or background tint changes rather than wide spacing.

4. **Progressive disclosure is mandatory.** Display a summary metric (e.g., "12 active errors") and require a click to see the error list. Never dump 200 log lines on a dashboard view.

---

## 2. Alert Hierarchy — Severity Levels, Color Systems, Escalation

### Military Alert Standard: DEFCON-Inspired Severity

The U.S. military's DEFCON system (Defense Readiness Condition) defines 5 levels, ascending in severity:

| Level | Name | Military Meaning | Dashboard Analog |
|-------|------|-------------------|-------------------|
| 5 | NORMAL | Lowest state of readiness, peacetime | All systems nominal |
| 4 | INCREASED | Above normal readiness, intelligence threat | Elevated monitoring, non-critical anomalies |
| 3 | ELEVATED | Increased force readiness | Active errors detected, health score declining |
| 2 | HIGH | Next step to nuclear war | System degradation, cascading failures |
| 1 | MAXIMUM | Nuclear war imminent | Total system failure, data loss |

NATO's APP-6/APP-6A military symbology standard (MIL-STD-2525C equivalent) uses an affiliation color system:
- **Red** = Hostile/Enemy
- **Blue** = Friendly/Own forces
- **Green** = Neutral
- **Yellow** = Unknown/Assumed friend

This maps directly to our dashboard severity model.

### Observability Platform Severity Models

**Grafana Alerting** uses alert states with color coding:
- 🔴 **Firing** (red) — Alert condition is currently true
- 🟢 **Normal** (green) — No alert condition met
- 🔵 **Pending** (blue) — Alert is about to fire, awaiting evaluation
- ⚪ **No Data** (gray) — Insufficient data to evaluate
- 🟡 **Alerting** (variant) — Typically mapped to warning level

**Datadog Monitors** use a 3-tier priority system:
- **P1/Critical** (red) — Immediate action required
- **P2/Warning** (orange/yellow) — Degraded but functional
- **P3/Info** (blue) — Informational, no action needed

**Google SRE** (from the SRE Workbook) recommends alerting on SLO burn rate:
- **Short window burn** (1-hour window, 14.4x rate) → Page immediately (red alert)
- **Long window burn** (6-hour window, 6x rate) → Page on-call (orange alert)
- **Multi-window composite** → Reduced noise through AND logic across windows

### Escalation Path Pattern

Military and ops centers follow a consistent escalation model:

1. **Detection** → System detects anomaly (automated, ~1 second)
2. **Triage** → Operator assessment (human, ~30–60 seconds)
3. **Acknowledge** → Operator acknowledges and owns the alert
4. **Diagnose** → Root cause investigation
5. **Remediate** → Fix applied
6. **Resolve** → Confirmed fix, alert clears
7. **Post-incident review** → Optional, for severity ≥ P2

### Actionable Recommendations for ACC Dashboard

1. **Adopt a 5-level severity system mapped to the cosmic theme:**

   | Severity | Label | Color (Cosmic Theme) | Hex | Action Required |
   |----------|-------|----------------------|-----|-----------------|
   | 5/CRITICAL | CRITICAL | Bright Red | `#ff1744` | Immediate action, siren alert |
   | 4/HIGH | HIGH | Orange | `#ff9100` | Acknowledge within 5 min |
   | 3/MEDIUM | ELEVATED | Yellow/Amber | `#ffd600` | Monitor closely |
   | 2/LOW | ADVISORY | Cyan | `#00d4ff` | Awareness only |
   | 1/INFO | NOMINAL | Green | `#00e676` | No action needed |

2. **Implement colorblind-safe patterns.** Military standards (MIL-STD-2525) require that color encoding NEVER be the sole indicator. Always pair color with:
   - Shape (triangle for warning, circle for normal, diamond for unknown, square for critical)
   - Text label (show severity name)
   - Pattern fill (striped/dashed borders for stale data)

3. **Alert state machine:** Every alert should track: `FIRING → ACKNOWLEDGED → RESOLVED` with timestamps at each transition. Unacknowledged alerts escalate visually (increase size, add pulse animation, add audible cue after 5 minutes).

4. **Implement acknowledgment UX:** Click on an alert to acknowledge it. This dims it slightly but keeps it visible. Never allow dismissal without acknowledgment. Use `/api/alerts/{id}/ack` endpoint.

5. **Siren/Audible Alert Pattern:** Reserve audible alerts (Web Audio API beep) only for CRITICAL severity. Military ops centers use distinct tones:
   - 1 short beep = new warning
   - 2 short beeps = new critical  
   - Continuous tone = system failure (never used unless truly catastrophic)

---

## 3. Color Systems — Military/Ops Color Standards & Dark Mode

### Military Color Standards

MIL-STD-2525D (NATO APP-6D) defines the definitive color scheme for military situation displays:

| Affiliation | Fill Color | Border Color | Meaning |
|-------------|-----------|-------------|---------|
| Friendly | Cyan/Blue | Blue | Own assets, nominal |
| Hostile | Red | Red | Enemy, critical threat |
| Neutral | Green | Green | Neither, benign |
| Unknown | Yellow | Yellow | Unidentified, uncertain |

**Critical design rule from MIL-STD-2525D:** Colors are supplementary — they reinforce information already conveyed by shape and label. The standard explicitly states that tactical displays must remain usable in monochrome (green phosphor) mode, as military displays must work in degraded conditions including night-vision compatibility.

### NASA Mission Control Color Usage

NASA's MCC uses a distinctive dark-background color scheme that has evolved since the 1960s:
- **Background:** Near-black (teletype-green phosphor in Apollo era, now dark navy/charcoal)
- **Nominal readings:** Green text on dark background (inherited from green phosphor CRTs)
- **Caution/Warning:** Yellow text with yellow border outlines
- **Emergency/Critical:** Red text with red flashing borders
- **Data labels:** Dim white/gray (distinguishable from live data)
- **Frozen/stale data:** Reverse video (white background, dark text) or strikethrough

### Dark Mode Universality in Ops Dashboards

Every major ops platform defaults to dark mode:
- **Grafana** — Default dark theme since inception. Their design rationale: "Operators work in dimly lit rooms; dark backgrounds reduce eye strain during extended monitoring sessions."
- **Datadog** — Default dark theme (introduced 2020, now standard). Their dashboard backgrounds use `#1a1a2e` to `#222233` range.
- **Kibana** — Dark mode option since 7.x, default in security/SOC contexts.
- **War Rooms** — Physical war rooms (NOC, SOC) universally use dark backgrounds because (a) overhead lighting is dim, (b) wall displays are easier to read, (c) color-coded alerts stand out dramatically against dark backgrounds.

### The Physics of Dark Theme + Alert Colors

On dark backgrounds, the human eye's cone cells are in a dark-adapted (scotopic) state, making them hypersensitive to:
- **Red light** — perceived as brightest warning color on dark backgrounds (rods are least sensitive to red, so red preserves night vision while still being visible)
- **Cyan/blue-green** — perceived as highest contrast on dark backgrounds for nominal/safe states
- **Amber/yellow** — optimal warning color because it sits at the peak of the photopic luminosity function

This is precisely why the ACC Dashboard's chosen palette (cyan `#00d4ff`, purple accents, dark backgrounds) is physically optimal for an ops dashboard.

### Actionable Recommendations for ACC Dashboard

1. **Adopt this exact color palette for the cosmic theme:**

   | Role | Color Name | Hex | Use Case |
   |------|-----------|-----|----------|
   | Background - primary | Void Black | `#0a0a0f` | Main canvas background |
   | Background - surface | Dark Nebula | `#12121a` | Card/panel backgrounds |
   | Background - elevated | Nebula Surface | `#1a1a2e` | Hover states, dropdowns |
   | Border - subtle | Space Edge | `#2a2a3e` | Card borders, dividers |
   | Text - primary | Star White | `#e8e8f0` | Primary text, data values |
   | Text - secondary | Nebula Gray | `#6b7280` | Labels, metadata |
   | Accent - primary | Cosmic Cyan | `#00d4ff` | Active states, links, nominal |
   | Accent - secondary | Nebula Purple | `#b388ff` | Secondary emphasis, agent indicators |
   | Severity - critical | Alert Red | `#ff1744` | Critical errors, system failure |
   | Severity - high | Alert Orange | `#ff9100` | High-priority warnings |
   | Severity - medium | Alert Amber | `#ffd600` | Elevated status |
   | Severity - low | Cyan Blue | `#00d4ff` | Advisory (same as accent) |
   | Severity - nominal | Star Green | `#00e676` | Healthy, all-clear |
   | Stale/Unknown | Dim Gray | `#4a4a5e` | Unknown state, stale data |

2. **Never use pure white (`#ffffff`) on dark backgrounds.** Pure white creates excessive contrast and eye fatigue. Use `#e8e8f0` (Star White) or `#d0d0e0` for text.

3. **Never use saturated purple as the sole indicator** — it's perceptually ambiguous for color-blind users. Always pair with shape/icon/text.

4. **Stale data indicator pattern (from NASA):** When a data point hasn't been updated within its freshness window, dim it to 40% opacity and overlay a subtle diagonal stripe pattern (CSS `repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(74,74,94,0.3) 2px, rgba(74,74,94,0.3) 4px)`). Add a timestamp showing last update.

5. **Implement a monochrome fallback toggle.** This is a military-grade accessibility requirement. In monochrome mode, all severity levels should be distinguishable via shape/icon alone:
   - Critical = ✕ (cross) icon + solid fill
   - Warning = △ (triangle) icon + striped fill
   - Nominal = ○ (circle) icon + solid fill
   - Unknown = ◇ (diamond) icon + dotted border

---

## 4. Layout Patterns — Grid Systems, Cards, Sidebars, 22 Tabs

### Military C2 Layout: The Console Wall Model

Military C2 centers (NORAD, Aegis, THAAD) use a "console wall" layout:
- **Top 15%** — Status summary strip (force readiness, threat level, time)
- **Left 10%** — Navigation/selector (unit selection, view mode)
- **Center 65%** — Primary content area (map, data grid, situational display)
- **Right 10%** — Contextual detail panel (selected item detail)
- **Bottom 10%** — Log/alert ticker

This maps almost perfectly to modern dashboard layouts.

### NASA MCC Layout: Console Position Rows

NASA's FCR (Flight Control Room) organizes console positions in rows:
- **Front Row (Flight, CapCom, FAO)** — The decision-makers
- **Second Row (GNC, EECOM, SURGEON)** — Critical subsystem monitors
- **Third Row (NETWORK, BOOST, INCO)** — Support functions
- **Rear Row (additional support)** — Specialists called upon as needed

Each position has two 20-inch displays showing 8–12 telemetry readouts, with the ability to page through additional screens.

### Observability Platform Layout Patterns

**Grafana** dashboard layout:
- 24-column grid system (standard)
- Row-based organization: top rows = summary, bottom rows = detail
- Panels with consistent spacing (8px gutters)
- Collapsible row headers to manage dashboard density
- Variable dropdowns at the top for filtering
- Time range selector (always visible, top-right corner)

**Datadog** dashboard layout:
- Free-form grid with snap-to-grid option
- "Stream" (real-time log/metric) panels at the bottom
- Template variables in a top bar
- Group-by widgets for organizing related metrics
- Default dashboard shows ~6–10 widgets per screen

**Kibana** dashboard layout:
- 48-column grid
- Panels can span any number of columns
- Top bar: time range, KQL search bar, filter pills
- Panels support drilldowns (click → navigate to another dashboard with context)
- Collapsible sections for grouping

### Handling 20+ Tabs/Sections

The ACC Dashboard has 22 tabs across 5 groups. This is a significant information architecture challenge. Military and ops platforms solve this with:

1. **Tab Groups / Folders** — The ACC Dashboard already uses 5 groups (COMMAND, WORK, INTEL, TOOLS, AGENTS). This is correct.
2. **Keyboard Navigation** — Military consoles use hotkeys extensively. `Ctrl+1` through `Ctrl+5` for groups, `1-9` for tabs within groups.
3. **Most-Recently-Used (MRU)** — Show the last 3+ visited items in a "recent" section.
4. **Command Palette** — Like VS Code's `Ctrl+Shift+P`, a `Ctrl+K` command palette for instant tab navigation.
5. **Contextual Auto-Navigation** — When an alert fires, auto-navigate to the relevant tab (e.g., error alert → auto-switch to Errors tab).

### Actionable Recommendations for ACC Dashboard

1. **Implement the Console Wall Layout:**

   ```
   ┌──────────────────────────────────────────────────────────────┐
   │  ★ COMMANDER'S STRIP  (5-7 key metrics, always visible)   │ ← 48px, sticky
   ├──────┬───────────────────────────────────────┬──────────────┤
   │      │                                       │              │
   │ NAV  │          PRIMARY CONTENT              │   DETAIL     │
   │ BAR  │          (Main tab content)            │   PANEL      │
   │      │                                       │  (optional)  │
   │GRP1  │                                       │              │
   │GRP2  │                                       │  Shows on    │
   │GRP3  │                                       │  item select │
   │GRP4  │                                       │              │
   │GRP5  │                                       │              │
   │──── │                                       │              │
   │ SRCH │                                       │              │
   ├──────┴───────────────────────────────────────┴──────────────┤
   │  ▶ ALERT TICKER  (scrolling recent alerts, bottom bar)     │ ← 32px, sticky
   └──────────────────────────────────────────────────────────────┘
   ```

2. **Sidebar navigation:** Collapsible groups with `+`/`-` toggles. Each tab shows a tiny status dot (green/yellow/red). Active tab highlighted with cyan left-border. Width: 200px expanded, 48px collapsed (icon-only mode).

3. **Commander's Strip (top bar):** Always visible, never scrollable. Shows:
   - System Health Score (0–100)
   - Active Agents (count, colored by status)
   - Active Errors (count, severity color)
   - Pending Tasks (count)
   - Last Data Refresh (timestamp + freshness indicator)
   - Current Time (UTC + local)

4. **Alert Ticker (bottom bar):** Similar to Bloomberg Terminal's news ticker or military LOGREP displays. Shows the last 5 alerts scrolling right-to-left, with severity color coding. Click to open the full alert panel.

5. **Card sizing standards:**
   - Stat card: 1 unit (shows single metric + sparkline)
   - Chart card: 2 units wide × 1–2 units tall
   - Table card: full width × 2 units tall
   - Detail card: full width × variable height (in detail panel)

6. **Grid: 12-column CSS grid** with 8px gutters. Card sizes snap to grid units. On 1920px screens, aim for 4 stat cards per row (3 grid columns each).

---

## 5. Data Freshness — Polling Intervals, Real-Time vs. Periodic, Stale Indicators

### Military C2 Data Freshness

Military systems use a concept called "track freshness" from the Tactical Data Link (TDL) standard (Link 16 / MIL-STD-6016):
- **Time-critical tracks** (weapons, hostile): 2-second update cycle
- **Tactical tracks** (friendly positions): 12-second update cycle
- **Strategic tracks** (weather, logistics): 60-second update cycle
- **Administrative data** (unit status, supply levels): 300-second (5 min) update cycle

Each data point carries a "time of information" (TOI) stamp. Data older than 2× its expected update rate is flagged as "stale" and older than 3× is flagged as "lost."

### NASA MCC Data Freshness

NASA's MCC processes telemetry in real-time from the ISS at varying rates:
- **Critical life support telemetry:** 1 Hz (updated every second)
- **Engineering telemetry:** 0.1–1 Hz (every 1–10 seconds)
- **Experiment data:** 0.01–0.1 Hz (every 10–100 seconds)
- **Ground-system status:** Polled every 30–60 seconds

Key NASA principle: **The display refresh rate must be at least 2× the data rate to avoid aliasing.** If data arrives every 2 seconds, the display must refresh at least every second.

### Observability Platform Freshness Patterns

**Grafana** allows per-panel refresh intervals:
- Default: dashboard-level interval (10s, 30s, 1m, 5m, 15m, 30m, 1h, 6h, 12h, 24h)
- Live mode: uses streaming for panels that support it (1s refresh)
- Each panel can have independent query intervals

**Datadog** uses:
- Real-time mode: 2-second refresh (for active dashboards)
- Default: 10–30 second auto-refresh (browser tab focused)
- Background: pauses refresh when tab not visible (battery optimization)
- Live tail mode: streaming logs/metrics as they arrive

**Kibana** uses:
- Auto-refresh intervals: 5s, 10s, 30s, 1m, 5m, 15m, 30m, 1h
- Real-time mode for log streaming
- Dashboard-level refresh control

### Actionable Recommendations for ACC Dashboard

1. **Implement a tiered freshness model matching the data type:**

   | Data Category | Update Interval | Freshness Timeout | Stale Threshold |
   |---------------|----------------|-------------------|-----------------|
   | Agent health & status | 5s (SSE push) | 15s | 30s |
   | Active errors & alerts | 5s (SSE push) | 15s | 30s |
   | Task queue status | 10s | 30s | 60s |
   | Health scores | 30s | 90s | 180s |
   | Schedule/cron data | 60s | 180s | 300s |
   | Vault analytics | 300s (5 min) | 600s | 900s |
   | Briefing content | On-demand | 300s | 600s |
   | Search results | On-demand | N/A (instant) | N/A |

2. **SSE (Server-Sent Events) for all push data.** The ACC Dashboard already uses SSE via `EventSource`. Keep this pattern. For polling fallback, use exponential backoff reconnection (1s → 2s → 4s → 8s → 16s → 32s cap).

3. **Visual freshness indicators:**
   - **Fresh (<1× interval):** Normal rendering, no indicator needed
   - **Aging (1–2× interval):** Subtle `opacity: 0.9` and a small "clock" icon with minutes since update
   - **Stale (2–3× interval):** `opacity: 0.7`, diagonal stripe overlay, amber timestamp
   - **Lost (>3× interval):** `opacity: 0.5`, red timestamp, "DATA STALE" label, pulse animation on the card border

4. **Timestamp display:** Always show relative time for recent data ("2s ago", "just now") and absolute timestamps for older data ("14:32:05 UTC"). Use `toLocaleString()` for local time, always show UTC in tooltip.

5. **Connection status indicator:** In the Commander's Strip, show a live connection indicator:
   - 🟢 Connected (SSE active)
   - 🟡 Reconnecting (SSE reconnecting with backoff)
   - 🔴 Disconnected (SSE failed, polling fallback)
   - Show last successful data timestamp

---

## 6. Interaction Patterns — Drill-Down, Filtering, Keyboard Shortcuts, Command Palettes

### Military C2 Interaction Patterns

Aegis Combat System (U.S. Navy) and similar C2 systems use a specific interaction model:
1. **Select → Context → Act:** Click an entity (ship, aircraft) → See context menu → Choose action (track, engage, identify)
2. **Hotkeys for time-critical actions:** F1-F12 for common operations, number keys for weapon selection
3. **Trackpad-style panning:** For map views, drag to pan, scroll to zoom
4. **Multi-select for batch operations:** Ctrl+Click to select multiple tracks, then apply action to all

### NASA MCC Interaction

NASA MCC operators use a "call-sign protocol" for communication, but their console interaction pattern is:
1. **Screen pages:** Each console has multiple "pages" of displays accessed via function keys (F1-F8)
2. **Keyboard-driven:** Operators rarely use mice during critical operations; they use dedicated keyboard clusters
3. **Highlight and expand:** Any telemetry value can be "boxed" (highlighted) to show trend history
4. **Alarm acknowledgment:** Dedicated ACK button that silences the audible alarm but keeps the visual cue

### Observability Platform Interaction Patterns

**Grafana:**
- Time range picker (top-right, always accessible)
- Template variables (dropdown filters at the top)
- Click-drag to zoom on time series
- Legend click to toggle series visibility
- Panel menu (inspect, edit, share, panel JSON)
- Keyboard: `Ctrl+K` for search, `d` for dashboard search, `e` for edit mode

**Datadog:**
- Time range selector with quick presets (15min, 1h, 4h, 1d)
- Template variables for scoped views
- Click on metric → drill-down to host/service level
- Full-screen mode for individual panels
- Keyboard shortcuts: `/` for search, `t` for time range, `f` for fullscreen

**Kibana:**
- KQL (Kibana Query Language) search bar (always visible at top)
- Filter pills (clickable chips showing active filters)
- Time picker with relative/absolute options
- Drilldowns: click on visualization → navigate to target dashboard with context
- Dashboard panel interactions: select range, click to filter

### Command Palette Pattern

The command palette (popularized by VS Code, adopted by Grafana 9+) is essential for dashboards with 20+ navigation targets:

- **Trigger:** `Ctrl+K` or `Cmd+K`
- **Display:** Modal overlay with search input
- **Behavior:** Fuzzy search across all tabs, actions, and settings
- **Categories:** Tab Navigation, Actions (refresh, export), Settings (theme, notifications)
- **Keyboard-only operation:** Arrow keys to navigate, Enter to select, Escape to close

### Actionable Recommendations for ACC Dashboard

1. **Implement a command palette** (`Ctrl+K`):
   ```
   ┌─────────────────────────────────────────────────┐
   │ 🔍 Search tabs, actions, agents...              │
   ├─────────────────────────────────────────────────┤
   │ COMMAND                                         │
   │  ⌘1  Overview (Health)                          │
   │  ⌘2  Agent Status                              │
   │  ⌘3  Errors & Alerts                           │
   │ WORK                                           │
   │  ⌘4  Tasks                                     │
   │  ⌘5  Schedule                                  │
   │  ⌘6  Content Pipeline                          │
   │ INTEL                                          │
   │  ⌘7  Search                                    │
   │  ⌘8  Memory                                    │
   │ TOOLS                                          │
   │  ⌘9  Vault Files                               │
   │  ⌘0  Agent Sessions                            │
   │ ─                                              │
   │ ACTIONS                                        │
   │  ↻  Refresh All Data                           │
   │  ⚡ Export Dashboard State                     │
   │  🎨 Toggle Theme                               │
   └─────────────────────────────────────────────────┘
   ```

2. **Keyboard shortcuts (military-grade hotkeys):**
   - `Ctrl+K` — Command palette
   - `1–9` — Quick tab navigation (within current group)
   - `Ctrl+1–5` — Switch group (COMMAND/WORK/INTEL/TOOLS/AGENTS)
   - `Ctrl+R` — Refresh current view
   - `Ctrl+Shift+A` — Acknowledge all visible alerts
   - `Esc` — Close modal/command palette
   - `/` — Focus search within current tab
   - `?` — Show keyboard shortcut help

3. **Drill-down pattern:** Click any metric card → slide-in detail panel on the right. The detail panel should show:
   - Full time-series history
   - Related metrics (correlated data)
   - Active alerts for this metric
   - Quick actions (acknowledge, silence, export)

4. **Filtering:** Each tab should have filter controls. Use pill-style filters (clickable tags) for categorical filters and dropdowns for multi-select. Active filters should be always visible.

5. **Bulk operations:** Multi-select with Ctrl+Click, then batch acknowledge/silence/export.

---

## 7. Status at a Glance — 3-Second Assessment

### The Military "OODA Loop" and Dashboard Design

Colonel John Boyd's OODA Loop (Observe → Orient → Decide → Act) is the theoretical foundation for ops dashboards. The "Observe" and "Orient" phases must happen in under 3 seconds. This requires:

1. **Pre-attentive processing** — Visual cues processed in under 250ms (color, shape, position, size)
2. **Consistent spatial location** — The same information always appears in the same screen location
3. **Progressive disclosure** — Summary → Detail, never the reverse

### The "Red Is Bad" Principle

Every ops domain we studied (military, NASA, NOC, SOC, Grafana, Datadog) converges on the same principle:

**If the dashboard shows any red, something requires immediate human attention. If there is no red, the system is operating within normal parameters.**

This means:
- Red should NEVER be used for decorative purposes
- Red should NEVER appear in a "nominal" state
- Red should trigger both visual and (optionally) audible alerts
- The absence of red IS information — it means "all clear"

### NATO Status at a Glance Pattern

NATO C2 displays use a "status board" concept:
- Each unit/system gets a single row or card
- The card shows exactly 3 things: (1) unit name/ID, (2) current status in a single word/letter, (3) status color
- The operator can scan 30+ units and identify any problems in under 3 seconds

### Observability Platform Patterns

**Datadog** achieves 3-second assessment through:
- **Status colors on every widget** — green/red/yellow badges on all monitors
- **Host map** — Color-coded grid showing health of every host
- **APM service map** — Lines between services colored by latency/error rate
- **Monitor status summary** — A single row showing: `[OK: 145] [WARN: 3] [CRIT: 1] [NO DATA: 0]`

**Grafana** achieves this through:
- **Stat panels** — Single large number with color threshold (green/yellow/red)
- **Alerting dashboard** — A dedicated "alert status overview" with green/red indicators per alert rule
- **Dashboard links** — Top-level overview dashboard linking to detailed sub-dashboards

### Actionable Recommendations for ACC Dashboard

1. **Implement a "System Health Compass" — the single most important UI element:**

   ```
   ╔════════════════════════════╗
   ║  ARETE COMMAND CENTER     ║
   ║                            ║
   ║     ╭───────╮              ║
   ║     │ ◉ 87  │  ← Circular  ║
   ║     │/100   │    progress   ║
   ║     ╰───────╯    ring       ║
   ║                            ║
   ║  Agents: 3▲ 1▼ 2●          ║
   ║  Errors: ⚠ 2  🔴 0  🟢 12  ║
   ║  Tasks:  5 pending         ║
   ║  Last:    3s ago           ║
   ╚════════════════════════════╝
   ```

2. **The 3-Second Test:** An operator looking at the dashboard for the first time should be able to answer these questions in 3 seconds:
   - Is the system healthy? (Look at health score + color)
   - Are there active problems? (Look for any red/orange)
   - What needs attention right now? (Look at alert count badges)
   - When did data last update? (Look at timestamp in Commander's Strip)

3. **Color-coded status dots on EVERY sidebar tab:** Each tab icon should have a small dot (8px) in the corner:
   - 🟢 if all items in that tab are nominal
   - 🟡 if there are warnings
   - 🔴 if there are critical issues
   - ⚪ if data is stale/unknown

4. **Health Score decomposition:** The overall health score (0–100) should be drillable. Click on it to see a breakdown:
   - Agent availability: 25% weight
   - Error rate: 25% weight
   - Task completion: 20% weight
   - Schedule adherence: 15% weight
   - Data freshness: 15% weight

5. **Alert count badge in Commander's Strip:** Show `[🔴 0 | 🟡 2 | ⚪ 0]` with the count of active alerts by severity. This mirrors military "force status" readouts.

---

## 8. Error Display — Surfacing, Grouping, and Resolving

### Military Error Handling: FAIL-SAFE and FAULT Displays

Military systems (particularly Aegis BMD and aircraft cockpits) use a structured error hierarchy:

1. **MASTER CAUTION/WARNING light** — A single amber or red light that illuminates whenever ANY caution or warning condition exists. The operator then looks at the specific subsystem display to identify which system triggered the master alert.

2. **CAUTION (Amber)** — Degraded condition, system can continue operating but requires attention. Examples: redundancy lost, performance degraded, approaching limit.

3. **WARNING (Red)** — Hazardous condition requiring immediate action. Examples: system failure, approaching danger, loss of critical capability.

4. **FAULT/ADVISORY (White)** — Informational, does not require action but notable. Examples: maintenance due, minor parameter deviation.

### NASA MCC Error Handling

NASA MCC uses the "ECO" model for anomalies:
- **E**mergency — Immediate threat to crew/mission (red)
- **C**aution — Degradation requiring attention (yellow)
- **O」perational note — Informational, no action needed (white/green)

Each console position has a dedicated "annunciator panel" — a grid of labeled lights that illuminate for specific conditions. When a condition triggers, the light illuminates and a tone sounds. The operator presses ACK to silence the tone, then investigates.

### Observability Platform Error Patterns

**Grafana Alerting:**
- Alert states: `Normal`, `Pending`, `Firing`, `No Data`, `Error`
- Alert routing via notification policies (label-based routing)
- Alert grouping: Related alerts with matching labels are grouped into a single notification
- Alert silencing: Manual or scheduled silences for maintenance windows
- Alert inhibition: Higher-severity alerts can suppress lower-severity alerts for the same resource

**Datadog Error Tracking:**
- Error grouping by stack trace fingerprint
- Issue status: `Active`, `Muted`, `Resolved`
- Error trend graphs showing frequency over time
- First/Last seen timestamps
- Affected user count and session count
- Integration with APM traces for each error instance

**Kibana Error Handling:**
- Kibana Alerting with Rule types and Actions
- Alert lifecycle: `Active`, `Acknowledged`, `Recovered`
- Error grouping in Observability UI
- Stack trace deduplication
- Correlation with logs and traces

### Actionable Recommendations for ACC Dashboard

1. **Implement a 3-tier error classification:**

   | Tier | Name | Color | Criteria | Auto-Resolve |
   |------|------|-------|----------|-------------|
   | 1 | CRITICAL | `#ff1744` Red | System failure, data loss, cascading errors | No — requires manual ACK |
   | 2 | WARNING | `#ff9100` Orange | Degraded performance, elevated error rate | Yes — if condition clears for 5 min |
   | 3 | ADVISORY | `#ffd600` Yellow | Notable but non-impactful, informational | Yes — if condition clears for 15 min |

2. **Error grouping by fingerprint:**
   - Group errors by: `agent_id + error_type + message_pattern`
   - Show group count (e.g., "ConnectionError to Hermes API — seen 47 times in last hour")
   - Expandable to see individual error instances
   - Similar errors with different timestamps should be collapsed under one group header

3. **Error timeline visualization:**
   - Show errors as blocks on a horizontal timeline (similar to GitHub's contribution graph)
   - Color intensity = error frequency in that time bucket
   - Click a block to see errors for that time period
   - Default view: last 24 hours, with 1-hour buckets

4. **Error detail slide-in panel:**
   When clicking an error group, show:
   - Error message (full)
   - Stack trace (if available)
   - Agent/system that generated it
   - First occurrence / Last occurrence timestamps
   - Occurrence count and frequency
   - Related errors (same agent, similar message)
   - Action buttons: `Acknowledge`, `Mute` (suppress for duration), `Create Task`

5. **Error escalation path:**
   ```
   Error Detected → Auto-classified (CRITICAL/WARNING/ADVISORY)
     ↓
   Advisory → Log only, no notification, auto-resolve in 15 min
     ↓
   Warning → Show in alert ticker + badge count, auto-resolve if clears
     ↓
   Critical → Alert ticker + badge + audible notification + auto-navigate to relevant tab
     ↓
   Unacked Critical (5 min) → Escalate visual (pulse animation, larger badge)
     ↓
   Unacked Critical (15 min) → Escalate to external notification (if configured)
   ```

6. **Error dashboard layout:**
   ```
   ┌──────────────────────────────────────────────────┐
   │ ⚠ ERRORS & ALERTS                                │
   ├─────────┬────────────────────────────────────────┤
   │ Filter  │ CRITICAL (1)  WARNING (3)  INFO (12)   │
   │ All     │ ─────────────────────────────────────  │
   │ Agent   │ 🔴 Hermes API unreachable              │
   │ Type    │    47 occurrences · Last 2s ago        │
   │ Time    │    ConnectionError · hermes_adapter    │
   │         │ ─────────────────────────────────────  │
   │         │ 🟡 Task queue growing (12 pending)     │
   │         │    3 occurrences · Last 45s ago         │
   │         │ ─────────────────────────────────────  │
   │         │ 🟡 Storage usage at 78%                │
   │         │    1 occurrence · Last 5 min ago        │
   │         │ ─────────────────────────────────────  │
   │         │ 📋 Advisory: 3 agents using old config  │
   │         │    3 occurrences · Last 1 hour ago     │
   │         │ ─────────────────────────────────────  │
   └─────────┴────────────────────────────────────────┘
   ```

---

## 9. Comprehensive Design Specification — ACC Dashboard Theme

### Typography Scale (Military-Inspired, Dark-Optimized)

Military displays use a consistent typographic hierarchy. Based on this research:

| Level | Size | Weight | Color | Use |
|-------|------|--------|-------|-----|
| Display | 32px | 700 | Star White | Health score, commander's readout |
| H1 | 24px | 600 | Star White | Dashboard section titles |
| H2 | 18px | 600 | Star White | Card titles |
| H3 | 14px | 500 | Nebula Gray | Card subtitles |
| Body | 14px | 400 | Star White | Primary text |
| Body Dim | 14px | 400 | Nebula Gray | Metadata, labels |
| Small | 12px | 400 | Nebula Gray | Timestamps, badges |
| Mono | 13px | 400 | Cosmic Cyan | Data values, codes, timestamps |

**Font recommendation:** Use a monospace font for data values (JetBrains Mono, Fira Code) and a clean sans-serif for UI text (Inter, Source Sans Pro). Military displays traditionally use monospaced fonts because data alignment is critical for rapid scanning.

### Spacing Scale (8px Grid)

All spacing uses multiples of 8px, following the military display grid principle:

```
4px   — Micro (icon padding, badge spacing)
8px   — XS (card inner padding, label gaps)
12px  — SM (card padding, between related items)
16px  — MD (card borders, section gaps)
24px  — LG (between card groups, tab content padding)
32px  — XL (between major sections)
48px  — 2XL (page margins, top-level section breaks)
```

### Animation & Motion Guidelines

Military displays use motion conservatively. Motion should:
1. **Direct attention** — Alerts pulse, new data slides in
2. **Reduce cognitive load** — Animated transitions between views, not abrupt changes
3. **Never distract** — No decorative animations during normal operation

**Permitted animations:**
- Alert pulse: `opacity 0.5 → 1.0`, 2s cycle, ease-in-out (critical only)
- Fade-in: 150ms, for new data appearing
- Slide-in: 150ms, for panels opening
- Progress ring animation: smooth 1s cycle for health score ring

**Prohibited animations:**
- Continuous rotation (spinning loaders after 3s — use skeleton instead)
- Bounce effects
- Particle effects on data cards (allowed on the background starfield only)
- Auto-scrolling content (use manual scroll or pagination)

### The "Cosmic Theme" — Final Specification

The ACC Dashboard's cosmic/space operations theme is perfectly aligned with military-grade ops dashboards. Dark space backgrounds with cyan and purple accents mirror the aesthetic of actual NASA mission control and military C2 systems. Here's the synthesis:

**Visual Identity:**
- Background: Deep space black (`#0a0a0f`) with subtle star field (particles)
- Primary accent: Cosmic Cyan (`#00d4ff`) — used for active states, links, nominal indicators
- Secondary accent: Nebula Purple (`#b388ff`) — used for agent identifiers, secondary emphasis
- Status colors: Red/Orange/Amber/Green severity system (see Section 2)
- Typography: Monospace for data, Sans-serif for UI
- Icons: Outline style, 1.5px stroke, 20px default size
- Borders: Thin (1px), subtle (`#2a2a3e`), slightly brighter on hover
- Shadows: Subtle, using theme colors (cyan glow for active elements)

**The "Ops Ready" Mode:**
Add a toggle for "Ops Ready" mode that:
- Increases all font sizes by 2px
- Adds higher contrast between background and text
- Removes all decorative elements (star particles)
- Shows a persistent connection status indicator
- Enables audible alerts for CRITICAL events
- Enlarges click targets to minimum 44px touch targets
- This mirrors the military concept of switching from "peacetime display" to "battle stations" mode

---

## Sources Consulted

1. MIL-STD-2525D / NATO APP-6D — Military symbology standard for situation displays
2. DEFCON System — U.S. defense readiness condition levels (5→1 severity scale)
3. NASA Mission Control Center (MCC-H) — Console position model, telemetry display patterns
4. Aegis Combat System — U.S. Navy C2 console interaction model
5. NORAD/Cheyenne Mountain Complex — "Big Board" display patterns
6. Grafana Alerting Documentation — Alert states, notification policies, grouping
7. Grafana Dashboard Best Practices — USE/RED methods, panel organization
8. Datadog Monitor Types & Severity — P1/P2/P3 priority, dashboard density
9. Datadog Dashboard Design — Dark theme defaults, widget patterns
10. Kibana Dashboard Documentation — Drilldowns, filter pills, grid system
11. Google SRE Workbook — Alerting on SLOs, burn-rate based alerting
12. PagerDuty On-Call Best Practices — Alert routing, escalation, noise reduction
13. Wickens' Multiple Resource Theory (2002) — Cognitive limits on parallel monitoring
14. DEFCON Level Classification — Graduated severity levels in military context
15. THAAD Missile Defense C2 System — Track freshness and data aging patterns
16. Tactical Data Link (Link 16 / MIL-STD-6016) — Data update rate tiers
17. Kibana Alerting & Actions — Alert lifecycle management
18. Datadog Error Tracking — Error grouping, fingerprinting, stack trace deduplication
19. Grafana Command Palette (`Ctrl+K`) — Navigation for complex dashboards
20. Aircraft Cockpit Design (FAA Human Factors) — Annunciator panels, CAUTION/WARNING hierarchy
21. Bloomberg Terminal Design — Ticker bar pattern, high-density information display
22. Atlassian Incident Management — Post-incident review, severity classification

---

## Appendix A: Quick-Reference Design Tokens

```css
/* ACC Dashboard — Military-Grade Cosmic Theme Tokens */
:root {
  /* Backgrounds */
  --bg-void:          #0a0a0f;    /* Primary canvas background */
  --bg-nebula:        #12121a;    /* Card/panel surface */
  --bg-nebula-hover:  #1a1a2e;    /* Hover state */
  --bg-elevated:      #222240;    /* Modals, dropdowns */
  
  /* Borders */
  --border-subtle:    #2a2a3e;    /* Card borders */
  --border-active:    #00d4ff;    /* Active/focused element border */
  
  /* Text */
  --text-primary:     #e8e8f0;    /* Primary text */
  --text-secondary:   #6b7280;    /* Labels, metadata */
  --text-muted:       #4a4a5e;    /* Disabled/stale */
  
  /* Accents */
  --accent-cyan:      #00d4ff;    /* Primary accent */
  --accent-purple:    #b388ff;    /* Secondary accent */
  --accent-cyan-dim:  rgba(0, 212, 255, 0.15);  /* Cyan background tint */
  --accent-purple-dim: rgba(179, 136, 255, 0.15); /* Purple background tint */
  
  /* Severity */
  --sev-critical:     #ff1744;    /* Critical - immediate action */
  --sev-high:         #ff9100;    /* High - acknowledge within 5 min */
  --sev-medium:       #ffd600;    /* Medium - monitor closely */
  --sev-low:          #00d4ff;    /* Low - awareness only */
  --sev-nominal:      #00e676;    /* Nominal - all clear */
  --sev-unknown:      #4a4a5e;    /* Unknown/stale */
  
  /* Spacing (8px grid) */
  --space-xs:         4px;
  --space-sm:         8px;
  --space-md:         12px;
  --space-lg:         16px;
  --space-xl:         24px;
  --space-2xl:       32px;
  --space-3xl:        48px;
  
  /* Timing */
  --refresh-realtime:  5s;
  --refresh-default:   30s;
  --refresh-slow:      60s;
  --stale-threshold:   2x;   /* Data older than 2× interval = stale */
  --lost-threshold:    3x;   /* Data older than 3× interval = lost */
  
  /* Animation */
  --transition-fast:   150ms;
  --transition-normal: 300ms;
  --pulse-duration:    2000ms;
  
  /* Typography */
  --font-data:        'JetBrains Mono', 'Fira Code', monospace;
  --font-ui:          'Inter', 'Source Sans Pro', system-ui, sans-serif;
  
  /* Sizing */
  --sidebar-width:    200px;
  --sidebar-collapsed: 48px;
  --commander-strip:  48px;
  --alert-ticker:     32px;
  --min-click-target: 44px;
}
```

---

## Appendix B: Alert State Machine

```
┌──────────┐   condition met   ┌──────────┐   threshold exceeded  ┌──────────┐
│  NORMAL  │ ───────────────→ │  PENDING │ ────────────────────→ │  FIRING  │
│ (green)  │                   │ (blue)   │                       │  (red)   │
└──────────┘                   └──────────┘                       └──────────┘
      ▲                                                               │
      │                                                               │
      │ condition cleared                                             │
      │                                                               │ operator
      │ condition cleared                                              │ acknowledges
      │ (auto-resolve if clear for 5/15 min)                           │
      │                                                               ▼
      │                                                         ┌──────────┐
      │                                                         │  ACKED   │
      │                                                         │ (dimmed) │
      │                                                         └──────────┘
      │                                                               │
      │                               condition clears               │
      └───────────────────────────────────────────────────────────── ┘
```

Alert metadata per instance:
```json
{
  "id": "alert-uuid",
  "fingerprint": "agent:hermes+type:ConnectionError",
  "severity": "critical",
  "severity_score": 5,
  "title": "Hermes API unreachable",
  "description": "Connection refused to :8642/health",
  "source": "hermes_adapter",
  "state": "firing",
  "created_at": "2026-05-27T23:05:00Z",
  "updated_at": "2026-05-27T23:10:00Z",
  "fired_at": "2026-05-27T23:06:00Z",
  "acked_at": null,
  "resolved_at": null,
  "occurrence_count": 47,
  "labels": {
    "agent": "hermes",
    "error_type": "ConnectionError",
    "adapter": "hermes_adapter"
  },
  "annotations": {
    "summary": "Hermes health endpoint unreachable",
    "runbook_url": "/docs/runbooks/hermes-connection-error",
    "dashboard_url": "/agents/hermes"
  }
}
```

---

*End of Research Report*