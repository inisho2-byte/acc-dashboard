import { FONTS } from "../styles/theme.js";

export default function SessionRow({ s, idx, onClick, selected, onToggle }) {
  const isArete = s.agent_id === "arete";
  const agentColor = isArete ? "#00d4ff" : "#a78bfa";
  const statusColor = s.status === "active" ? "#00ff88" : s.status === "idle" ? "#f59e0b" : s.status === "running" ? "#f59e0b" : "#666";
  const statusLabel = s.status?.toUpperCase() || "";

  const fmtDuration = (seconds) => {
    if (seconds == null) return "—";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  return (
    <div className={`session-row ${selected ? "selected" : ""}`} style={{ animationDelay: `${idx * 60}ms`, cursor: onClick ? "pointer" : "default" }} onClick={() => onClick?.(s)}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }} onClick={e => { e.stopPropagation(); onToggle?.(); }}>
        <div style={{ width: 14, height: 14, borderRadius: 3, border: `1px solid ${selected ? "#00d4ff" : "rgba(150,180,220,0.3)"}`, background: selected ? "rgba(0,212,255,0.2)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          {selected && <span style={{ color: "#00d4ff", fontSize: 10, lineHeight: 1 }}>✓</span>}
        </div>
      </div>
      <span className="label-tag" style={{ background: `${agentColor}15`, color: agentColor, border: `1px solid ${agentColor}30`, textAlign: "center" }}>{s.agent_id?.toUpperCase().slice(0, 3) || "—"}</span>
      {statusLabel && <span className="label-tag" style={{ background: `${statusColor}15`, color: statusColor, border: `1px solid ${statusColor}30`, textAlign: "center", fontSize: 8 }}>{statusLabel}</span>}
      <span style={{ fontFamily: FONTS.sans, fontSize: 12, color: "rgba(200,230,255,0.75)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title || s.preview || "(session)"}</span>
      <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: "rgba(150,180,220,0.5)", textAlign: "right" }}>{s.token_count != null ? s.token_count : "—"}</span>
      <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: "rgba(150,180,220,0.5)", textAlign: "right" }}>{fmtDuration(s.duration_seconds)}</span>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 5 }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: statusColor, display: "inline-block" }} className={s.status === "running" || s.status === "active" ? "live-dot" : ""} />
        <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(150,180,220,0.45)" }}>{s.last_active ? new Date(s.last_active).toLocaleTimeString() : ""}</span>
      </div>
    </div>
  );
}
