import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { FONTS } from "../styles/theme.js";
import { NAV_GROUPS, ALL_TABS, SHORTCUT_MAP, GROUP_COLORS, TAB_META } from "../navConfig.js";
import SidebarGroup from "./SidebarGroup.jsx";

const COLLAPSED_WIDTH = 56;
const EXPANDED_WIDTH = 200;

export { COLLAPSED_WIDTH, EXPANDED_WIDTH };

export default function Sidebar({
  activeTab,
  onTabChange,
  onOpenPalette,
  expanded,
  onToggleExpand,
  errorCount,
  healthStatus,
  agents,
}) {
  const [tooltip, setTooltip] = useState(null);
  const navListRef = useRef(null);

  // Compute group badge counts
  const groupBadges = useMemo(() => {
    const badges = {};
    NAV_GROUPS.forEach((group) => {
      if (group.id === "command") {
        badges[group.id] = errorCount || 0;
      } else if (group.id === "work") {
        badges[group.id] = 0; // pending tasks — not yet available
      } else if (group.id === "intel") {
        badges[group.id] = 0;
      } else if (group.id === "tools") {
        badges[group.id] = 0;
      } else if (group.id === "agents") {
        badges[group.id] = Array.isArray(agents)
          ? agents.filter((a) => a.status === "up" || a.status === "online" || a.status === "active").length
          : 0;
      } else {
        badges[group.id] = 0;
      }
    });
    return badges;
  }, [errorCount, agents]);

  // Compute healthStatus from agents
  const computedHealthStatus = useMemo(() => {
    if (!Array.isArray(agents) || agents.length === 0) return "healthy";
    const anyDown = agents.some(a => {
      const s = (a.status || "").toLowerCase();
      return s === "offline" || s === "down" || s === "error" || s === "crashed";
    });
    if (anyDown) return "down";
    const anyDegraded = agents.some(a => {
      const s = (a.status || "").toLowerCase();
      return s === "slow" || s === "warning" || s === "degraded";
    });
    if (anyDegraded) return "degraded";
    return "healthy";
  }, [agents]);

  const width = expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH;

  const handleMouseEnter = useCallback(
    (id, label, e) => {
      if (expanded) return;
      const rect = e.currentTarget.getBoundingClientRect();
      setTooltip({ id, label, x: rect.right + 8, y: rect.top + rect.height / 2 });
    },
    [expanded]
  );

  const handleMouseLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  // Dismiss tooltip on nav list scroll
  useEffect(() => {
    const navEl = navListRef.current;
    if (!navEl) return;
    const onScroll = () => setTooltip(null);
    navEl.addEventListener("scroll", onScroll, { passive: true });
    return () => navEl.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: width,
        transition: "width 0.2s ease",
        overflow: "hidden",
      }}
    >
      {/* BRAND — click to toggle expand/collapse */}
      <div
        style={{
          padding: expanded ? "12px 10px 8px" : "12px 0 8px",
          display: "flex",
          justifyContent: expanded ? "flex-start" : "center",
          alignItems: "center",
        }}
      >
        <button
          onClick={onToggleExpand}
          aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
          title={expanded ? "Collapse (Ctrl+\\)" : "Expand (Ctrl+\\)"}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: expanded ? 8 : 0,
            padding: 0,
            position: "relative",
          }}
          onMouseEnter={(e) => {
            const icon = e.currentTarget.querySelector("[data-brand-icon]");
            if (icon) {
              icon.style.borderColor = "#00d4ff";
              icon.style.boxShadow = "0 0 12px rgba(0,212,255,0.3)";
            }
            const chevron = e.currentTarget.querySelector("[data-chevron]");
            if (chevron) chevron.style.opacity = "1";
          }}
          onMouseLeave={(e) => {
            const icon = e.currentTarget.querySelector("[data-brand-icon]");
            if (icon) {
              icon.style.borderColor = "#00d4ff40";
              icon.style.boxShadow = "none";
            }
            const chevron = e.currentTarget.querySelector("[data-chevron]");
            if (chevron) chevron.style.opacity = expanded ? "0.5" : "0.4";
          }}
        >
          {/* Logo mark */}
          <div
            data-brand-icon
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              background: "linear-gradient(135deg, #00d4ff22, #7c3aed33)",
              border: "1px solid #00d4ff40",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              position: "relative",
              transition: "border-color 0.15s, box-shadow 0.15s",
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                border: "2px solid #00d4ff",
                background: "rgba(0,212,255,0.2)",
              }}
            />
            {/* Expand/collapse chevron */}
            <span
              data-chevron
              style={{
                position: "absolute",
                bottom: -3,
                right: -3,
                width: 14,
                height: 14,
                borderRadius: 3,
                background: "rgba(10,18,32,0.95)",
                border: "1px solid rgba(0,212,255,0.2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 8,
                color: "rgba(0,212,255,0.7)",
                lineHeight: 1,
                opacity: expanded ? 0.5 : 0.4,
                transition: "opacity 0.15s",
              }}
            >
              {expanded ? "◁" : "▷"}
            </span>
          </div>
          {expanded && (
            <span
              style={{
                fontFamily: FONTS.mono,
                fontSize: 10,
                color: "rgba(0,212,255,0.7)",
                letterSpacing: "0.1em",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              ARETE CC
            </span>
          )}
        </button>
      </div>

      {/* SEARCH — opens command palette */}
      <div
        style={{
          padding: expanded ? "0 10px 8px" : "0 0 8px",
          display: "flex",
          justifyContent: expanded ? "flex-start" : "center",
        }}
      >
        <button
          onClick={onOpenPalette}
          title="Search (Ctrl+K)"
          style={{
            width: expanded ? "100%" : 36,
            height: 36,
            borderRadius: 8,
            border: "1px solid rgba(0,212,255,0.12)",
            background: "rgba(0,212,255,0.04)",
            display: "flex",
            alignItems: "center",
            justifyContent: expanded ? "flex-start" : "center",
            gap: expanded ? 8 : 0,
            cursor: "pointer",
            color: "rgba(0,212,255,0.5)",
            fontSize: 14,
            transition: "all 0.15s ease",
            padding: expanded ? "0 10px" : 0,
            fontFamily: expanded ? FONTS.mono : undefined,
            letterSpacing: expanded ? "0.04em" : undefined,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(0,212,255,0.08)";
            e.currentTarget.style.borderColor = "rgba(0,212,255,0.25)";
            e.currentTarget.style.color = "#00d4ff";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(0,212,255,0.04)";
            e.currentTarget.style.borderColor = "rgba(0,212,255,0.12)";
            e.currentTarget.style.color = "rgba(0,212,255,0.5)";
          }}
        >
          <span style={{ flexShrink: 0, lineHeight: 1 }}>⌕</span>
          {expanded && (
            <span style={{ fontSize: 10, whiteSpace: "nowrap" }}>SEARCH</span>
          )}
        </button>
      </div>

      {/* DIVIDER */}
      <div
        style={{
          margin: expanded ? "0 10px" : "0 10px",
          height: 1,
          background: "rgba(0,212,255,0.06)",
        }}
      />

      {/* NAV GROUPS — scrollable */}
      <div
        ref={navListRef}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 0,
          padding: "4px 0",
          flex: 1,
          overflowY: "auto",
          scrollbarWidth: "none",
          alignItems: expanded ? "stretch" : "center",
        }}
      >
        {NAV_GROUPS.map((group) => (
          <SidebarGroup
            key={group.id}
            group={group}
            activeTab={activeTab}
            onTabChange={onTabChange}
            expanded={expanded}
            groupBadge={groupBadges[group.id] || null}
            errorCount={errorCount || 0}
            healthStatus={healthStatus || computedHealthStatus}
          />
        ))}
      </div>

      {/* TOOLTIP — only in collapsed mode */}
      {!expanded && tooltip && (
        <div
          style={{
            position: "fixed",
            left: tooltip.x,
            top: tooltip.y,
            transform: "translateY(-50%)",
            zIndex: 1000,
            background: "rgba(10,18,32,0.95)",
            border: "1px solid rgba(0,212,255,0.2)",
            borderRadius: 8,
            padding: "6px 12px",
            pointerEvents: "none",
            backdropFilter: "blur(12px)",
            boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
          }}
        >
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 11,
              color: "#e8f4fd",
              letterSpacing: "0.04em",
            }}
          >
            {tooltip.label}
          </div>
        </div>
      )}
    </div>
  );
}