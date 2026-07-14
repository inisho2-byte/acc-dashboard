# ACC Dashboard — Sidebar Redesign Proposal

## Problem

Current sidebar: **22 items in a flat list**. Miller's Law (7±2) says this is ~3x beyond usable working memory. Visual clutter, no hierarchy, no wayfinding cues.

## Design Pattern

**Pattern: Collapsible Section Groups with Pinned Command Bar**

Based on research across Dub.co (area switcher), Grafana (collapsible tree), shadcn-admin (SidebarGroup), Linear (workflow grouping), Material Design 3 (nav drawer/rail), and NN/g progressive disclosure guidelines.

Key principles:
1. Group by **operator workflow**, not system architecture
2. **5 groups** with 3-5 items each
3. COMMAND group **never collapses** — always visible, contains alertable items
4. Other groups **collapse with remembered state** (localStorage)
5. Section headers with **cosmic gradient dividers**
6. **Collapse-to-icon mode** (Ctrl+\\) converts groups to dropdown flyouts
7. **Cmd+K palette** auto-generates from group config (fixes current gap)

## Proposed Grouping

```
COMMAND ─────────── pinned, never collapses, always visible
  ⊕  OPS                 system-at-a-glance
  ⬡  Agents              agent cards + statistics
  ✖  Errors              merged error list + dashboard (internal tabs)
  ◯  Health              health scores

WORK ────────────── collapsible, default expanded
  ☐  Tasks               kanban board
  ◴  Schedule             Hermes + system cron
  ▸  Pipeline             content pipeline (Scout→Scribe→Reach)
  🗎  Content             content items
  ◈  Briefing             daily briefing

INTEL ───────────── collapsible
  ◎  Sessions            agent session history
  ◐  Activity            activity timeline
  ◫  Context             context viewer
  ◊  Memory              memory explorer
  ◅  Trends              analytics trends

TOOLS ───────────── collapsible
  ⌕  Search              global search
  ✦  Skills              skill registry
  ◆  Vault               vault vitals
  ✉  Mailbox             Tailscale feed
  ⬢  Projects            project board

AGENTS ──────────── collapsible
  ⬡  Claude Code         Claude Code sessions
  💬 Chat                agent chat
  ⧫  Trading             trading bot
```

**22 items → 5 groups (avg 4.4 items/group)**

## Group Color Coding

Cosmic theme with distinct accent per group:

| Group | Accent Color | Hex |
|-------|-------------|-----|
| COMMAND | Cyan | `#00d4ff` |
| WORK | Amber | `#f59e0b` |
| INTEL | Purple | `#a78bfa` |
| TOOLS | Teal | `#2dd4bf` |
| AGENTS | Pink | `#f472b6` |

Section headers render in the group accent at 50-60% opacity.
A 3px left-border accent strip appears on the active item.
Between groups, a thin gradient divider: `linear-gradient(90deg, {accent}20, transparent)`.

## Collapsed (Icon-Only) Mode

When sidebar collapses to 56px:
- COMMAND items stay as icon-only buttons (never collapse)
- Other groups show their **group icon** with a badge count
- Clicking a group icon opens a **popover flyout** (shadcn pattern) showing the group's items
- Error count badge on the COMMAND group icon when errors are active
- Health dot (green/red) on Health icon

## Visual Structure

```
┌──────────────────────────────────────────────────────┐
│  [⊕] ARETE CC                                   [◁] │
│  ───────────────────────────── gradient ──────────── │
│                                                      │
│  COMMAND ──── (no collapse chevron, always open)      │
│  ⊕  OPS                                              │
│  ⬡  Agents                                           │
│  ✖  Errors                   [3]  ← red badge        │
│  ◯  Health                        ← green dot        │
│                                                      │
│  ─── WORK ────────────────────── ▾ ─── collapse ─── │
│  ☐  Tasks                                            │
│  ◴  Schedule                                         │
│  ▸  Pipeline                                         │
│  🗎  Content                                          │
│  ◈  Briefing                                         │
│                                                      │
│  ─── INTEL ───────────────────── ▾ ─── collapse ─── │
│  ◎  Sessions                                         │
│  ◐  Activity                                         │
│  ◫  Context                                          │
│  ◊  Memory                                           │
│  ◅  Trends                                           │
│                                                      │
│  ─── TOOLS ───────────────────── ▾ ─── collapse ────│
│  ⌕  Search                                           │
│  ✦  Skills                                           │
│  ◆  Vault                                            │
│  ✉  Mailbox                                          │
│  ⬢  Projects                                         │
│                                                      │
│  ─── AGENTS ───────────────────── ▾ ─── collapse ───│
│  ⬡  Claude Code                                      │
│  💬  Chat                                             │
│  ⧫  Trading                                          │
│                                                      │
│  ───────────────────────────── gradient ──────────── │
│  [⚙] Settings                                       │
└──────────────────────────────────────────────────────┘
```

## Merged Panels

| Before (2 tabs) | After (1 tab) | Mechanism |
|---|---|---|
| errors + errors-dashboard | Errors | Internal tabs (List / Dashboard) within one panel |
| Schedule + some Cron overlap | Schedule | Cron data shown in Schedule panel; Cron dashboard link as a deep link |

## Implementation Architecture

### Single Source of Truth: `navConfig.js`

```js
export const NAV_GROUPS = [
  {
    id: 'command',
    label: 'COMMAND',
    icon: '⊕',
    color: '#00d4ff',
    collapsible: false,  // never collapses
    items: [
      { id: 'overview', label: 'OPS', icon: '⊕' },
      { id: 'agents', label: 'AGENTS', icon: '⬡' },
      { id: 'errors', label: 'ERRORS', icon: '✖', badge: 'errorCount' },
      { id: 'health', label: 'HEALTH', icon: '◯', dot: 'healthStatus' },
    ],
  },
  {
    id: 'work',
    label: 'WORK',
    icon: '☐',
    color: '#f59e0b',
    collapsible: true,
    items: [
      { id: 'tasks', label: 'TASKS', icon: '☐' },
      { id: 'schedule', label: 'SCHED', icon: '◴' },
      { id: 'pipeline', label: 'PIPELINE', icon: '▸' },
      { id: 'content', label: 'CONTENT', icon: '🗎' },
      { id: 'briefing', label: 'BRIEF', icon: '◈' },
    ],
  },
  // ... INTEL, TOOLS, AGENTS
];

// Derived arrays (computed once)
export const ALL_TABS = NAV_GROUPS.flatMap(g => g.items.map(i => i.id));
export const TAB_LABELS = Object.fromEntries(
  NAV_GROUPS.flatMap(g => g.items.map(i => [i.id, i.label]))
);
```

### Component Decomposition

```
Sidebar.jsx (orchestrator ~100 lines)
  ├── SidebarBrand (logo + collapse toggle)
  ├── SidebarSearch (command palette trigger)
  └── NAV_GROUPS.map(group => <SidebarGroup>)
      └── SidebarItem (per item)

SidebarGroup.jsx (~80 lines)
  - Collapse/expand with localStorage persistence
  - Group header with accent color gradient divider
  - Chevrons: ▾ expanded, ▸ collapsed
  - Animate max-height transition (200ms ease)

SidebarItem.jsx (~60 lines)
  - Icon + label + optional badge/dot
  - Active state with left-border accent glow
  - Keyboard shortcut display
  - Tooltip in collapsed-icon mode
```

### URL Routing

Groups are **visual only**. URLs stay flat: `#/sessions`, `#/health`, `#/trading`.
No group nesting in URLs — tab IDs remain the same.

### Command Palette

Auto-generated from `NAV_GROUPS`:
```
COMMAND
  → OPS                    ⊕
  → Agents                 ⬡
  → Errors                 ✖
  → Health                 ◯

WORK
  → Tasks                  ☐
  ...

Filter: typing "he" → shows "Health" under COMMAND header
```

## Keyboard Shortcuts

- **1-4**: Switch between COMMAND items (OPS, Agents, Errors, Health)
- **Ctrl+K**: Command palette (full search across all tabs)
- **Ctrl+\\**: Expand/collapse sidebar
- **B**: Circuit breakers (existing)

## Removed Tabs

| Tab | Resolution |
|-----|-----------|
| errors-dashboard | Merged INTO errors panel (internal List/Dashboard toggle) |
| schedule + cron | Keep both as-is; cron is a security-concern item |

Note: "Cron" tab currently lives in the sidebar but isn't in the original 5 documented panels (OPS/Agents/Tasks/Schedule/Content). It was added later. It stays as its own item under WORK alongside Schedule because cron has distinct security implications.

## Key Decisions & Warrants

1. **Errors + Health in COMMAND (not SYSTEMS):** Because they are alertable items that must never be hidden behind a collapsible group. During incidents, operators need 1-click access. Warrant: Security review identified P0 risk of hidden alerts during collapse.

2. **5 groups not 7:** Because 7 groups with avg 3 items each creates excessive nesting overhead. 5 groups with avg 4.4 items each fits Miller's Law and reduces visual noise. Warrant: Architecture review scored 7 groups as over-nested.

3. **Visual-only grouping (URL unchanged):** Because groups are an organizational layer, not a routing layer. Warrant: If groups change, URLs don't break. Flat URLs are resilient to reorganization.

4. **Collapsible groups with localStorage persistence:** Because operators should be able to hide sections they don't use, but their preference should persist across sessions. Warrant: NN/g progressive disclosure research shows initial display signals importance.

5. **Default all groups EXPANDED:** Because new users need to see the full scope. They collapse intentionally. Warrant: Same NN/g finding — initial display signals importance, and hiding items on first visit hides system scope.

## Confidence & Revision Conditions

- **Confidence in grouping: 88%** — Strong alignment with operator mental model, research-backed patterns, council review validated the 5-group structure.
- **Confidence in merged Error panel: 75%** — The two panels share data but have different views. Merging is logical but needs user testing to confirm the internal tab toggle feels natural.
- **I would revise the grouping if:** User testing reveals operators search for "Errors" in a SYSTEMS-group location, or if the OPERATIONS/WORK group naming is confusing.
- **#1 assumption that could change this:** The assumption that COMMAND should contain exactly OPS + Agents + Errors + Health. If the user uses Health rarely and errors-dashboard heavily, we might split differently.