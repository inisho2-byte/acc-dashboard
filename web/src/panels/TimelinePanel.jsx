import { useState, useEffect, useCallback } from "react";
import * as api from "../api";
import { FONTS, AGENT_COLORS } from "../styles/theme.js";

const EVENT_COLORS = {
  session: "#00d4ff",
  message: "#a78bfa",
  cron: "#00ff88",
  error: "#ff4444",
  vault_change: "#f59e0b",
};

const AGENT_LABELS = {
  arete: "ARETE",
  shu: "SHU",
  vault: "VAULT",
};

export default function TimelinePanel() {
  const [events, setEvents] = useState(null);
  const [loading, setLoading] = useState(true);
  const [agentFilter, setAgentFilter] = useState("");

  const loadEvents = useCallback(async () => {
    setLoading(true);
    const res = agentFilter
      ? await api.getAgentActivity(agentFilter, 50)
      : await api.getActivity(50);
    setEvents(res);
    setLoading(false);
  }, [agentFilter]);

  useEffect(() => {
    loadEvents();
    const interval = setInterval(loadEvents, 15000);
    return () => clearInterval(interval);
  }, [loadEvents]);

  const eventDot = (type) => {
    const color = EVENT_COLORS[type] || "rgba(150,180,220,0.4)";
    return (
      <span style={{ color, fontSize: 10, marginRight: 6, lineHeight: 1 }}>
        ●
      </span>
    );
  };

  const agentBadge = (agentId) => {
    const label = AGENT_LABELS[agentId] || (agentId || "").toUpperCase();
    const color = AGENT_COLORS[agentId] || "#f59e0b";
    return (
      <span
        style={{
          fontFamily: FONTS.mono,
          fontSize: 9,
          fontWeight: 700,
          color,
          background: `${color}15`,
          border: `1px solid ${color}30`,
          borderRadius: 3,
          padding: "2px 6px",
          letterSpacing: "0.06em",
          display: "inline-block",
        }}
      >
        {label}
      </span>
    );
  };

  const typeBadge = (type) => {
    const color = EVENT_COLORS[type] || "rgba(150,180,220,0.4)";
    return (
      <span
        style={{
          fontFamily: FONTS.mono,
          fontSize: 8,
          color,
          background: `${color}10`,
          border: `1px solid ${color}20`,
          borderRadius: 3,
          padding: "1px 5px",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          display: "inline-block",
        }}
      >
        {type?.replace(/_/g, " ")}
      </span>
    );
  };

  const filterButton = (label, value) => {
    const active = agentFilter === value;
    return (
      <button
        key={label}
        onClick={() => setAgentFilter(value)}
        style={{
          fontFamily: FONTS.mono,
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.06em",
          padding: "4px 10px",
          borderRadius: 4,
          cursor: "pointer",
          border: active
            ? "1px solid rgba(0,212,255,0.5)"
            : "1px solid rgba(0,212,255,0.12)",
          background: active
            ? "rgba(0,212,255,0.15)"
            : "rgba(0,212,255,0.04)",
          color: active ? "#00d4ff" : "rgba(150,180,220,0.5)",
          transition: "all 0.15s ease",
        }}
      >
        {label}
      </button>
    );
  };

  const formatTimestamp = (ts) => {
    if (!ts) return "";
    try {
      return new Date(ts).toLocaleTimeString();
    } catch {
      return ts;
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div
          style={{
            fontFamily: FONTS.mono,
            fontSize: 9,
            color: "rgba(0,212,255,0.5)",
            letterSpacing: "0.16em",
          }}
        >
          ACTIVITY TIMELINE
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {["ALL", "ARETE", "SHU"].map((label) =>
            filterButton(label, label === "ALL" ? "" : label.toLowerCase())
          )}
        </div>
      </div>

      {/* Loading state */}
      {loading && !events && (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span
            style={{
              fontFamily: FONTS.mono,
              fontSize: 10,
              color: "rgba(150,180,220,0.3)",
              animation: "pulse 1.5s ease-in-out infinite",
            }}
          >
            ⏳ Loading activity...
          </span>
        </div>
      )}

      {/* Empty state */}
      {!loading && events && (!events?.events || events.events.length === 0) && (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span
            style={{
              fontFamily: FONTS.mono,
              fontSize: 10,
              color: "rgba(150,180,220,0.3)",
              letterSpacing: "0.06em",
            }}
          >
            No activity recorded
          </span>
        </div>
      )}

      {/* Event list */}
      {events?.events?.length > 0 && (
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {events.events.map((evt, i) => (
            <div
              key={evt.id || i}
              className="fade-up"
              style={{
                animationDelay: `${(i % 20) * 40}ms`,
                padding: "8px 10px",
                borderRadius: 5,
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.04)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 3,
                }}
              >
                {eventDot(evt.type)}
                {agentBadge(evt.agent_id || evt.agent)}
                {typeBadge(evt.type)}
                <span
                  style={{
                    fontFamily: FONTS.mono,
                    fontSize: 8,
                    color: "rgba(150,180,220,0.35)",
                    marginLeft: "auto",
                    flexShrink: 0,
                  }}
                >
                  {formatTimestamp(evt.timestamp)}
                </span>
              </div>
              <div
                style={{
                  fontFamily: FONTS.sans,
                  fontSize: 11,
                  color: "rgba(200,230,255,0.7)",
                  lineHeight: 1.4,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  paddingLeft: 16,
                }}
              >
                {evt.summary || evt.message || evt.description || ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
