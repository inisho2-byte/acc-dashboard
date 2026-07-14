/**
 * ACC Dashboard — Navigation Configuration
 *
 * SINGLE SOURCE OF TRUTH for sidebar groups and tab metadata.
 * All navigation is derived from NAV_GROUPS. Do NOT create separate
 * TABS, TAB_LABELS, or NAV_ITEMS arrays — use the derived exports.
 *
 * Group architecture:
 *   COMMAND — pinned, never collapses (alertable items: errors, health)
 *   WORK    — collapsible, default expanded
 *   INTEL   — collapsible
 *   TOOLS   — collapsible
 *   AGENTS  — collapsible
 */

export const NAV_GROUPS = [
  {
    id: "command",
    label: "COMMAND",
    icon: "⊕",
    color: "#00d4ff",
    collapsible: false,
    defaultExpanded: true,
    items: [
      { id: "overview", label: "OPS", icon: "⊕" },
      { id: "agents", label: "AGENTS", icon: "⬡" },
      { id: "errors", label: "ERRORS", icon: "✖", badge: "errorCount" },
      { id: "health", label: "HEALTH", icon: "◯", dot: "healthStatus" },
    ],
  },
  {
    id: "work",
    label: "WORK",
    icon: "☐",
    color: "#f59e0b",
    collapsible: true,
    defaultExpanded: true,
    items: [
      { id: "tasks", label: "TASKS", icon: "☐" },
      { id: "schedule", label: "SCHED", icon: "◴" },
      { id: "cron", label: "CRON", icon: "◷" },
      { id: "pipeline", label: "PIPELINE", icon: "▸" },
      { id: "content", label: "CONTENT", icon: "🗎" },
      { id: "briefing", label: "BRIEF", icon: "◈" },
    ],
  },
  {
    id: "intel",
    label: "INTEL",
    icon: "◎",
    color: "#a78bfa",
    collapsible: true,
    defaultExpanded: false,
    items: [
      { id: "sessions", label: "SESSIONS", icon: "◎" },
      { id: "memory", label: "MEMORY", icon: "◊" },
      { id: "trends", label: "TRENDS", icon: "◢" },
    ],
  },
  {
    id: "tools",
    label: "TOOLS",
    icon: "✦",
    color: "#2dd4bf",
    collapsible: true,
    defaultExpanded: false,
    items: [
      { id: "search", label: "SEARCH", icon: "⌕" },
      { id: "skills", label: "SKILLS", icon: "✦" },
      { id: "vault", label: "VAULT", icon: "◆" },
      { id: "mailbox", label: "MAILBOX", icon: "✉" },
      { id: "ibcb", label: "IBCB", icon: "📡" },
      { id: "projects", label: "PROJECTS", icon: "⬢" },
    ],
  },
  {
    id: "agents",
    label: "AGENTS",
    icon: "⬡",
    color: "#34d399",
    collapsible: true,
    defaultExpanded: false,
    items: [
      { id: "claude-code", label: "CLAUDE", icon: "⬡" },
      { id: "chat", label: "CHAT", icon: "💬" },
      { id: "trading", label: "TRADING", icon: "⧫" },
    ],
  },
];

// ── Derived arrays (computed once at module level) ──

export const ALL_TABS = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id));

export const TAB_LABELS = Object.fromEntries(
  NAV_GROUPS.flatMap((g) => g.items.map((i) => [i.id, i.label]))
);

export const TAB_META = Object.fromEntries(
  NAV_GROUPS.flatMap((g) =>
    g.items.map((i) => [i.id, { ...i, group: g.id, groupColor: g.color }])
  )
);

// Group color map (for section headers and accent borders)
export const GROUP_COLORS = Object.fromEntries(
  NAV_GROUPS.map((g) => [g.id, g.color])
);

// Keyboard shortcut map (1-4 for the 4 COMMAND items)
export const SHORTCUT_MAP = {};
NAV_GROUPS[0].items.forEach((item, i) => {
  SHORTCUT_MAP[i + 1] = item.id;
});