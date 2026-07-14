import { useState, useCallback, useEffect } from "react";
import { FONTS, SEVERITY, getSeverity } from "../styles/theme.js";

export default function SidebarGroup({ group, activeTab, onTabChange, expanded, groupBadge, errorCount, healthStatus }) {
  // Always call the hook — never conditionally
  const [collapsed, setCollapsed] = useCollapsedState(group.id, group.defaultExpanded);
  const isCollapsed = group.collapsible ? collapsed : false;

  const totalItems = group.items.length;
  const activeInGroup = group.items.some((item) => item.id === activeTab);

  const handleToggle = useCallback(() => {
    if (group.collapsible) {
      setCollapsed((prev) => !prev);
    }
  }, [group.collapsible]);

  return (
    <div style={{ marginBottom: expanded ? 4 : 2 }}>
      {/* Group header — always visible */}
      {expanded && (
        <div
          onClick={group.collapsible ? handleToggle : undefined}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: group.collapsible
              ? "6px 10px 3px"
              : "4px 10px 2px",
            cursor: group.collapsible ? "pointer" : "default",
            userSelect: "none",
            ...(group.collapsible ? { transition: "background 0.15s" } : {}),
          }}
          onMouseEnter={(e) => {
            if (group.collapsible)
              e.currentTarget.style.background = "rgba(0,212,255,0.04)";
          }}
          onMouseLeave={(e) => {
            if (group.collapsible)
              e.currentTarget.style.background = "transparent";
          }}
        >
          <span
            style={{
              fontFamily: FONTS.mono,
              fontSize: 9,
              letterSpacing: "0.14em",
              color: group.color,
              opacity: expanded ? 0.7 : 0.5,
              transition: "opacity 0.15s, color 0.15s",
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            {group.label}
            {groupBadge != null && groupBadge > 0 && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  background: group.color,
                  color: "#fff",
                  fontSize: 10,
                  fontWeight: 700,
                  marginLeft: 6,
                  lineHeight: 1,
                  fontFamily: FONTS.mono,
                }}
              >
                {groupBadge}
              </span>
            )}
          </span>
          {group.collapsible && expanded && (
            <span
              style={{
                fontFamily: FONTS.mono,
                fontSize: 9,
                color: isCollapsed
                  ? "rgba(150,180,220,0.25)"
                  : "rgba(150,180,220,0.4)",
                transition: "transform 0.2s ease, color 0.15s",
                transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                display: "inline-block",
              }}
            >
              ▾
            </span>
          )}
        </div>
      )}

      {/* Items container — uses max-height animation */}
      <div
        style={{
          overflow: "hidden",
          transition: isCollapsed ? "max-height 0.2s ease, opacity 0.15s ease" : "max-height 0.3s ease, opacity 0.2s ease",
          maxHeight: isCollapsed ? 0 : "500px",
          opacity: isCollapsed ? 0 : 1,
        }}
      >
        {group.items.map((item) => (
          <SidebarItem
            key={item.id}
            item={item}
            groupColor={group.color}
            isActive={activeTab === item.id}
            onTabChange={onTabChange}
            expanded={expanded}
            errorCount={errorCount}
            healthStatus={healthStatus}
          />
        ))}
      </div>

      {/* Group divider — gradient line */}
      <div
        style={{
          margin: expanded ? "4px 10px 0" : "2px 6px 0",
          height: 1,
          background: `linear-gradient(90deg, ${group.color}30, transparent)`,
          opacity: 0.6,
        }}
      />
    </div>
  );
}

function SidebarItem({ item, groupColor, isActive, onTabChange, expanded, errorCount, healthStatus }) {
  // Severity-colored badge for error count
  let badgeEl = null;
  if (item.badge === "errorCount" && errorCount > 0) {
    let badgeBg;
    if (errorCount >= 10) badgeBg = SEVERITY.CRITICAL.color;
    else if (errorCount >= 5) badgeBg = SEVERITY.HIGH.color;
    else badgeBg = SEVERITY.MEDIUM.color;
    badgeEl = (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: 16,
          height: 16,
          borderRadius: 8,
          background: badgeBg,
          color: "#fff",
          fontSize: 9,
          fontWeight: 700,
          lineHeight: 1,
          fontFamily: FONTS.mono,
          padding: "0 4px",
          marginLeft: expanded ? "auto" : 0,
          flexShrink: 0,
        }}
      >
        {errorCount}
      </span>
    );
  }

  // Health status dot
  let healthDot = null;
  if (item.dot === "healthStatus") {
    let dotColor;
    if (healthStatus === "degraded") dotColor = "#facc15"; // yellow
    else if (healthStatus === "down") dotColor = "#ff4444"; // red
    else dotColor = "#00ff88"; // green = all healthy (default)
    healthDot = (
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: dotColor,
          display: "inline-block",
          marginLeft: expanded ? 6 : 0,
          flexShrink: 0,
          boxShadow: `0 0 4px ${dotColor}88`,
        }}
        className="live-dot"
      />
    );
  }

  return (
    <button
      onClick={() => onTabChange(item.id)}
      aria-label={item.label}
      title={item.label}
      style={{
        width: expanded ? "calc(100% - 12px)" : 40,
        height: 36,
        marginLeft: expanded ? 6 : 0,
        marginRight: expanded ? 6 : 0,
        borderRadius: expanded ? 6 : 10,
        border: "none",
        background: isActive
          ? "linear-gradient(135deg, rgba(194,122,90,0.22), rgba(194,122,90,0.08))"
          : "transparent",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: expanded ? "flex-start" : "center",
        gap: expanded ? 8 : 0,
        transition: "all 0.15s ease",
        position: "relative",
        flexShrink: 0,
        padding: expanded ? "0 10px" : 0,
      }}
      onMouseOver={(e) => {
        if (!isActive) e.currentTarget.style.background = "rgba(0,212,255,0.06)";
      }}
      onMouseOut={(e) => {
        if (!isActive) e.currentTarget.style.background = "transparent";
      }}
    >
      {/* Active left accent — group color */}
      {isActive && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: "20%",
            bottom: "20%",
            width: 3,
            borderRadius: 2,
            background: groupColor,
            boxShadow: `0 0 8px ${groupColor}66`,
          }}
        />
      )}
      <span
        style={{
          fontSize: 14,
          color: isActive ? "#e8a87c" : "rgba(150,180,220,0.5)",
          transition: "color 0.15s",
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        {item.icon}
      </span>
      {expanded && (
        <span
          style={{
            fontFamily: FONTS.mono,
            fontSize: 10,
            color: isActive ? "#e8a87c" : "rgba(150,180,220,0.6)",
            letterSpacing: "0.04em",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            transition: "color 0.15s",
          }}
        >
          {item.label.toUpperCase()}
        </span>
      )}
      {healthDot}
      {badgeEl}
    </button>
  );
}

/**
 * Persist collapsed state in localStorage so user preference survives refresh.
 * Keyed per group id: acc-sidebar-group-{groupId}
 */
function useCollapsedState(groupId, defaultExpanded) {
  const storageKey = `acc-sidebar-group-${groupId}`;
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored !== null ? stored === "true" : !defaultExpanded;
    } catch {
      return !defaultExpanded;
    }
  });

  // Persist to localStorage on change
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(collapsed));
    } catch { /* localStorage unavailable */ }
  }, [collapsed, storageKey]);

  // Sync across tabs via storage event
  useEffect(() => {
    const handler = (e) => {
      if (e.key === storageKey && e.newValue !== null) {
        setCollapsed(e.newValue === "true");
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [storageKey]);

  return [collapsed, setCollapsed];
}