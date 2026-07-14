import { useState, useMemo, useCallback } from "react";
import TimelinePanel from "./TimelinePanel";
import SessionRow from "../components/SessionRow";
import PanelLayout from "../components/PanelLayout";
import EmptyState from "../components/EmptyState";
import { FONTS } from "../styles/theme.js";

const SUB_TAB_STYLE = {
  display: "inline-flex",
  alignItems: "center",
  gap: 0,
  background: "rgba(0,212,255,0.08)",
  borderRadius: 4,
  padding: "1px 2px",
};

const SUB_TAB_BTN = (active) => ({
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

export default function SessionsPanel({
  sessions,
  filteredSessions,
  sessionFilter,
  setSessionFilter,
  selectedSessionIds,
  setSelectedSessionIds,
  selectAll,
  clearSelection,
  toggleSession,
  setSelectedSession,
  exportCSV,
  exportJSON,
}) {
  const [subTab, setSubTab] = useState("sessions"); // "sessions" | "activity"

  const stats = sessions.length > 0 ? [
    { label: "Total", value: sessions.length },
  ] : null;

  const actions = (
    <div style={SUB_TAB_STYLE}>
      <button style={SUB_TAB_BTN(subTab === "sessions")} onClick={() => setSubTab("sessions")}>Sessions</button>
      <button style={SUB_TAB_BTN(subTab === "activity")} onClick={() => setSubTab("activity")}>Activity</button>
    </div>
  );

  return (
    <PanelLayout
      title="SESSIONS"
      icon="◎"
      accentColor="#a78bfa"
      stats={stats}
      actions={actions}
    >
      {subTab === "sessions" ? (
        renderSessionsView({
          filteredSessions,
          sessionFilter,
          setSessionFilter,
          selectedSessionIds,
          setSelectedSessionIds,
          selectAll,
          clearSelection,
          toggleSession,
          setSelectedSession,
          exportCSV,
          exportJSON,
        })
      ) : (
        <TimelinePanel />
      )}
    </PanelLayout>
  );
}

function renderSessionsView({
  filteredSessions,
  sessionFilter,
  setSessionFilter,
  selectedSessionIds,
  selectAll,
  clearSelection,
  toggleSession,
  setSelectedSession,
  exportCSV,
  exportJSON,
}) {
  return (
    <>
      {!filteredSessions?.length && !sessionFilter && (
        <EmptyState
          icon="◎"
          title="No sessions"
          description="No agent sessions have been recorded yet"
        />
      )}
      {filteredSessions?.length > 0 && (
        <>
          <div className="session-header">
            <input
              className="filter-input"
              value={sessionFilter}
              onChange={(e) => setSessionFilter(e.target.value)}
              placeholder="Filter sessions..."
            />
            {["arete", "shu", "running"].map((tag) => (
              <button
                key={tag}
                onClick={() => setSessionFilter(tag)}
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 8,
                  letterSpacing: "0.06em",
                  padding: "3px 8px",
                  borderRadius: 3,
                  border: `1px solid ${sessionFilter === tag ? "rgba(0,212,255,0.4)" : "rgba(0,212,255,0.15)"}`,
                  background: sessionFilter === tag ? "rgba(0,212,255,0.12)" : "transparent",
                  color: sessionFilter === tag ? "#00d4ff" : "rgba(0,212,255,0.5)",
                  cursor: "pointer",
                }}
              >
                {tag.toUpperCase()}
              </button>
            ))}
            {sessionFilter && (
              <button
                onClick={() => setSessionFilter("")}
                style={{ fontFamily: FONTS.mono, fontSize: 8, color: "#ff8888", background: "transparent", border: "none", cursor: "pointer" }}
              >
                CLEAR
              </button>
            )}
          </div>
          <div className="session-columns">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              <input
                type="checkbox"
                ref={(el) => {
                  if (el) {
                    el.checked = filteredSessions.length > 0 && filteredSessions.every((s) => selectedSessionIds.has(s.id));
                    el.indeterminate = selectedSessionIds.size > 0 && selectedSessionIds.size < filteredSessions.length;
                  }
                }}
                onChange={(e) => {
                  e.stopPropagation();
                  if (e.target.checked) selectAll();
                  else clearSelection();
                }}
                style={{ width: 14, height: 14, accentColor: "#00d4ff", cursor: "pointer" }}
              />
            </div>
            {["AGENT", "STATUS", "TASK", "TOKENS", "DURATION", "TIME"].map((h) => (
              <span key={h} className="mono-label">
                {h}
              </span>
            ))}
          </div>
          {selectedSessionIds.size > 0 && (
            <div className="selection-bar">
              <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: "#00d4ff", letterSpacing: "0.1em" }}>
                {selectedSessionIds.size} SELECTED
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={exportCSV}
                  style={{
                    fontFamily: FONTS.mono,
                    fontSize: 8,
                    letterSpacing: "0.1em",
                    padding: "3px 8px",
                    borderRadius: 3,
                    border: "1px solid rgba(0,212,255,0.2)",
                    background: "rgba(0,212,255,0.08)",
                    color: "#00d4ff",
                    cursor: "pointer",
                  }}
                >
                  EXPORT CSV
                </button>
                <button
                  onClick={exportJSON}
                  style={{
                    fontFamily: FONTS.mono,
                    fontSize: 8,
                    letterSpacing: "0.1em",
                    padding: "3px 8px",
                    borderRadius: 3,
                    border: "1px solid rgba(0,212,255,0.2)",
                    background: "rgba(0,212,255,0.08)",
                    color: "#00d4ff",
                    cursor: "pointer",
                  }}
                >
                  EXPORT JSON
                </button>
                <button
                  onClick={clearSelection}
                  style={{
                    fontFamily: FONTS.mono,
                    fontSize: 8,
                    letterSpacing: "0.1em",
                    padding: "3px 8px",
                    borderRadius: 3,
                    border: "1px solid rgba(255,68,68,0.2)",
                    background: "rgba(255,68,68,0.08)",
                    color: "#ff8888",
                    cursor: "pointer",
                  }}
                >
                  CLEAR
                </button>
              </div>
            </div>
          )}
          <div style={{ overflowY: "auto", flex: 1 }}>
            {filteredSessions.map((s, i) => (
              <SessionRow
                key={s.id || i}
                s={s}
                idx={i}
                onClick={setSelectedSession}
                selected={selectedSessionIds.has(s.id)}
                id={s.id}
                onToggle={toggleSession}
              />
            ))}
          </div>
        </>
      )}
      {sessionFilter && filteredSessions?.length === 0 && (
        <EmptyState
          icon="◎"
          title="No matching sessions"
          description={`No sessions match "${sessionFilter}"`}
          action={{ label: "Clear filter", onClick: () => setSessionFilter("") }}
        />
      )}
    </>
  );
}