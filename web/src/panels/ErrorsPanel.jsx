import { useState } from "react";
import DOMPurify from "dompurify";
import ErrorDashboard from "./ErrorDashboard";
import { FONTS, SEVERITY, getSeverity } from "../styles/theme.js";
import PanelLayout from "../components/PanelLayout";
import EmptyState from "../components/EmptyState";

/** Compute message-based severity for an error item */
function getErrorSeverity(msg) {
  const m = (msg || "").toLowerCase();
  if (/critical|fatal|crash/.test(m)) return SEVERITY.CRITICAL;
  if (/timeout|connection|refused/.test(m)) return SEVERITY.HIGH;
  if (/warning|deprecated/.test(m)) return SEVERITY.MEDIUM;
  return SEVERITY.LOW;
}

const SEGMENT_STYLE = {
  display: "inline-flex",
  alignItems: "center",
  gap: 0,
  background: "rgba(0,212,255,0.08)",
  borderRadius: 4,
  padding: "1px 2px",
};

const SEGMENT_BTN = (active) => ({
  fontFamily: FONTS.mono,
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "1px",
  padding: "4px 12px",
  border: "none",
  borderRadius: 3,
  cursor: "pointer",
  color: active ? "#00d4ff" : "#9ca3af",
  background: active ? "rgba(0,212,255,0.15)" : "transparent",
  borderBottom: active ? "2px solid #00d4ff" : "2px solid transparent",
  transition: "all 0.15s ease",
});

export default function ErrorsPanel({ errors }) {
  const [view, setView] = useState("list"); // "list" | "dashboard"

  const criticalCount = errors.filter(e => e.severity === "critical").length;
  const panelStats = [
    { label: "Total", value: errors.length },
    ...(criticalCount > 0 ? [{ label: "Critical", value: criticalCount }] : []),
  ];

  const actions = (
    <div style={SEGMENT_STYLE}>
      <button style={SEGMENT_BTN(view === "list")} onClick={() => setView("list")}>List</button>
      <button style={SEGMENT_BTN(view === "dashboard")} onClick={() => setView("dashboard")}>Dashboard</button>
    </div>
  );

  return (
    <PanelLayout
      title="ERRORS"
      icon="✖"
      accentColor="#00d4ff"
      stats={panelStats}
      actions={actions}
    >
      {errors.length === 0 ? (
        <EmptyState icon="✖" title="No errors yet" description="All critical systems nominal" style={{ background: SEVERITY.INFO.bg, border: `1px solid ${SEVERITY.INFO.color}30` }} />
      ) : view === "list" ? (
        renderErrorsList(errors)
      ) : (
        <ErrorDashboard errors={errors} />
      )}
    </PanelLayout>
  );
}

function renderErrorsList(errors) {
  return (
    <div className="panel-content-list">
      {errors.map((e, i) => {
        const sev = getErrorSeverity(e.message);
        const isCritical = sev === SEVERITY.CRITICAL;
        return (
          <div
            key={i}
            className="fade-up"
            style={{
              animationDelay: `${i * 80}ms`,
              padding: "10px 14px",
              borderRadius: 6,
              background: sev.bg,
              border: `1px solid ${sev.color}30`,
              borderLeft: isCritical ? `3px solid ${SEVERITY.CRITICAL.color}` : undefined,
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
            }}
          >
            <span
              style={{ width: 6, height: 6, borderRadius: "50%", background: sev.color, display: "inline-block", marginTop: 5, flexShrink: 0 }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                {/* Severity badge — 12px tall pill */}
                <span
                  style={{
                    fontFamily: FONTS.mono,
                    fontSize: 9,
                    fontWeight: 600,
                    color: sev.color,
                    letterSpacing: "0.1em",
                    padding: "1px 6px",
                    borderRadius: 9,
                    height: 12,
                    lineHeight: "12px",
                    background: `${sev.color}20`,
                    border: `1px solid ${sev.color}40`,
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  {sev.label}
                </span>
                <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: "rgba(150,180,220,0.5)" }}>
                  {e.agent_id?.toUpperCase() || "?"} · {e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : ""}
                </span>
              </div>
              <div style={{ fontFamily: FONTS.sans, fontSize: 12, color: "rgba(200,200,180,0.8)" }}>{e.message || "(no detail)"}</div>
            </div>
          </div>
        );
      })}
      {errors.length === 0 && (
        <EmptyState icon="✖" title="All systems nominal" description="No errors recorded" />
      )}
    </div>
  );
}