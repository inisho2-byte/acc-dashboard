# Sidebar Redesign Research — ACC Dashboard

## Current State (22 items, flat list)

OPS, AGENTS, TASKS, SCHED, CONTENT, Sessions, Errors, Skills, Search, Briefing, Dashboard, Activity, Context, Memory, Mailbox, Pipeline, Trends, Health, Vault, Cron, Trading, Claude Code, Chat, Projects

That's 22 items in a single flat scrollable column. Miller's Law (7±2) says this is ~3x beyond usable working memory.

---

## Research Sources

### GitHub Dashboard Patterns

| Pattern | Source | Stars | Top-Level | Grouping | Best For |
|---------|--------|-------|-----------|----------|----------|
| Product Area Switcher | Dub.co | 23.6k | 2-4 icons | Named sections | 15-30+ items |
| Collapsible Parent Categories | Cal.com | 73k+ | 5 parents | Parent headers | Settings/admin |
| Collapsible MegaMenu Tree | Grafana | 74k | 8-12 roots | Auto from tree | Data/ops dashboards |
| Named SidebarGroups | shadcn-admin | — | 3 groups | SidebarGroupLabel | Standard admin |
| Sectioned Collapsible | Metabase | 40k+ | 6 sections | SidebarHeading | Content apps |
| Grouped Menu Dividers | Supabase | — | 5-8 groups | Uppercase mono | Developer tools |

### Key Patterns Extracted

#### Dub.co — Two-Panel Area Switcher
- Left icon strip (64px) + right detail panel (240px)
- Each product area shows its own navigation
- Sections within areas: named sections with icon + label items
- Badge system for counts ("99+", "New")
- Overflow detection: >10 items → scroll with gradient fade

#### Cal.com — Collapsible Parent Categories
- VerticalTabItem with parent-child nesting
- Children render as sub-links under expanded parent
- Tracking metadata per item for analytics

#### Grafana — MegaMenu with Collapsible Tree
- MAX_DEPTH = 2 enforced
- Expand/collapse state persisted in localStorage
- Active parent auto-expands
- Special "Bookmarks" section for pinned items
- Dockable sidebar: pin or flyout

#### shadcn-admin — SidebarGroup Pattern
- `<SidebarGroup>` + `<SidebarGroupLabel>` + `<SidebarGroupContent>`
- Collapsible with Radix primitives
- When sidebar collapsed → DropdownMenu flyout
- Badge system for counts

### Design System Research

| System | Key Takeaway |
|--------|-------------|
| Material Design 3 | Nav drawer min 256dp; nav rail 72dp collapsed; pill active indicator |
| Ant Design | ItemGroup with uppercase headers; inlineCollapse mode |
| Atlassian | Group labels ("Forms and input"); badges; expand/collapse per group |
| Apple HIG | Sidebars for 5+ content areas; section headers in semibold; disclosure triangles |
| shadcn/ui | SidebarGroupLabel + SidebarMenuBadge; collapse to icon-only; 7+ sidebar variants |
| Linear | Workflow-based grouping (Intake → Plan → Build → Monitor); verbs not nouns |

### NN/g Research Findings

1. Show nav on larger screens — never hamburger only
2. Put menus in expected locations (left sidebar)
3. Don't cover the screen with menus
4. Communicate current location (active state)
5. Communicate available options (nav = system scope)
6. Progressive disclosure: show most important first, offer more on request
7. Initial display signals importance — items shown first perceived as most important

### Operator Mental Model (from research)

Operators think in these groupings:
1. "What's broken?" → Incidents, alerts, active problems (URGENT)
2. "What's the current state?" → Status, health, metrics (MONITORING)
3. "What's running?" → Deployments, pipelines, jobs (OPERATIONS)
4. "How do I configure things?" → Settings, rules, integrations (CONFIG)
5. "Who's doing what?" → Team, audit, access (GOVERNANCE)

---

## Design Principles Synthesized

1. Group by OPERATOR WORKFLOW, not system architecture
2. Show 5-7 top-level groups with 3-5 items each
3. Incident/alert items UNGROUPED and ALWAYS VISIBLE at top
4. Always show full sidebar on desktop
5. Support collapse-to-icons mode
6. Cmd+K command palette as complement
7. Badges for live status (running agents, errors, etc.)
8. Collapsible groups with remembered state (localStorage)
9. Pin footer (user/settings never scroll away)
10. Cosmic aesthetic: section dividers as gradient lines, muted cyan headers