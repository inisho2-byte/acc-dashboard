import { useState, useRef, useCallback, useEffect } from "react";
import { FONTS } from "../styles/theme.js";

const COLLAPSED_WIDTH = 56;
const EXPANDED_WIDTH = 200;

const NAV_ITEMS = [
  { id: "overview", label: "OPS", icon: "⊕", key: "0" },
  { id: "agents", label: "AGENTS", icon: "⬡", key: "2" },
  { id: "tasks", label: "TASKS", icon: "☐", key: "3" },
  { id: "schedule", label: "SCHED", icon: "◴", key: "4" },
  { id: "content", label: "CONTENT", icon: "🗎", key: "5" },
  { id: "sessions", label: "Sessions", icon: "◎", key: "6" },
  { id: "errors", label: "Errors", icon: "✖", key: "2" },
  { id: "skills", label: "Skills", icon: "✦", key: "3" },
  { id: "search", label: "Search", icon: "⌕", key: "4" },
  { id: "briefing", label: "Briefing", icon: "◈", key: "5" },
  { id: "errors-dashboard", label: "Dashboard", icon: "▣", key: "6" },
  { id: "activity", label: "Activity", icon: "◐", key: "7" },
  { id: "context", label: "Context", icon: "◫", key: "8" },
  { id: "memory", label: "Memory", icon: "◊", key: "9" },
  { id: "mailbox", label: "Mailbox", icon: "✉" },
  { id: "pipeline", label: "Pipeline", icon: "▸" },
  { id: "trends", label: "Trends", icon: "◢" },
  { id: "health", label: "Health", icon: "◯" },
  { id: "vault", label: "Vault", icon: "◆" },
  { id: "cron", label: "Cron", icon: "◷" },
  { id: "trading", label: "Trading", icon: "⧫" },
  { id: "claude-code", label: "Claude Code", icon: "⬡" },
  { id: "chat", label: "Chat", icon: "💬" },
  { id: "projects", label: "Projects", icon: "⬢" },
];

export { COLLAPSED_WIDTH, EXPANDED_WIDTH };

export default function Sidebar({ activeTab, onTabChange, onOpenPalette, expanded, onToggleExpand }) {
  const [tooltip, setTooltip] = useState(null);
  const navListRef = useRef(null);

  const width = expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH;

  const handleMouseEnter = useCallback((id, label, key, e) => {
    if (expanded) return; // no tooltips when expanded
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({ id, label, key, x: rect.right + 8, y: rect.top + rect.height / 2 });
  }, [expanded]);

  // Dismiss tooltip on nav list scroll to prevent stale positioning
  useEffect(() => {
    const navEl = navListRef.current;
    if (!navEl) return;
    const onScroll = () => setTooltip(null);
    navEl.addEventListener("scroll", onScroll, { passive: true });
    return () => navEl.removeEventListener("scroll", onScroll);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setTooltip(null);
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
 <div style={{ padding: expanded ? "12px 10px 8px" : "12px 0 8px", display: "flex", justifyContent: expanded ? "flex-start" : "center", alignItems: "center" }}>
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
 const icon = e.currentTarget.querySelector('[data-brand-icon]');
 if (icon) icon.style.borderColor = "#00d4ff";
 if (icon) icon.style.boxShadow = "0 0 12px rgba(0,212,255,0.3)";
 const chevron = e.currentTarget.querySelector('[data-chevron]');
 if (chevron) chevron.style.opacity = "1";
 }}
 onMouseLeave={(e) => {
 const icon = e.currentTarget.querySelector('[data-brand-icon]');
 if (icon) icon.style.borderColor = "#00d4ff40";
 if (icon) icon.style.boxShadow = "none";
 const chevron = e.currentTarget.querySelector('[data-chevron]');
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
 {/* Expand/collapse chevron — bottom-right corner of logo */}
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
      <div style={{ padding: expanded ? "0 10px 8px" : "0 0 8px", display: "flex", justifyContent: expanded ? "flex-start" : "center" }}>
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
          {expanded && <span style={{ fontSize: 10, whiteSpace: "nowrap" }}>SEARCH</span>}
        </button>
      </div>

      {/* DIVIDER */}
      <div style={{ margin: expanded ? "0 10px" : "0 10px", height: 1, background: "rgba(0,212,255,0.06)" }} />

      {/* NAV ITEMS — scrollable */}
      <div
        ref={navListRef}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          padding: "6px 0",
          flex: 1,
          overflowY: "auto",
          scrollbarWidth: "none",
          alignItems: expanded ? "stretch" : "center",
        }}
      >
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              aria-label={item.label}
              title={item.label}
              onMouseEnter={(e) => handleMouseEnter(item.id, item.label, item.key, e)}
              onMouseLeave={handleMouseLeave}
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
              {/* Active left accent */}
              {isActive && (
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: "20%",
                    bottom: "20%",
                    width: 3,
                    borderRadius: 2,
                    background: "#c27a5a",
                    boxShadow: "0 0 8px rgba(194,122,90,0.4)",
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
              {expanded && item.key && (
                <span
                  style={{
                    fontFamily: FONTS.mono,
                    fontSize: 9,
                    color: "rgba(0,212,255,0.25)",
                    marginLeft: "auto",
                    flexShrink: 0,
                  }}
                >
                  {item.key}
                </span>
              )}
            </button>
          );
        })}
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
          <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: "#e8f4fd", letterSpacing: "0.04em" }}>
            {tooltip.label}
          </div>
          {tooltip.key && (
            <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.5)", letterSpacing: "0.08em", marginTop: 2 }}>
              {tooltip.key}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
