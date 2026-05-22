import { FONTS } from "../styles/theme.js";

export default function SessionDetail({ session, onClose }) {
  if (!session) return null;

  const isArete = session.agent_id === "arete";
  const agentColor = isArete ? "#00d4ff" : "#a78bfa";

  const bodyText = session.body || session.preview || "(no content)";

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", justifyContent: "flex-end" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} />
      <div style={{ position: "relative", width: 420, maxWidth: "90vw", height: "100vh", background: "rgba(5,14,35,0.95)", borderLeft: "1px solid rgba(0,212,255,0.2)", overflowY: "auto", padding: 24, animation: "fade-up 0.3s ease" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <span className="label-tag" style={{ background: `${agentColor}15`, color: agentColor, border: `1px solid ${agentColor}30`, fontSize: 10 }}>{session.agent_id?.toUpperCase() || "AGENT"}</span>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, color: "rgba(200,220,255,0.6)", cursor: "pointer", padding: "4px 10px", fontFamily: FONTS.mono, fontSize: 10 }}>ESC</button>
        </div>

        <h2 style={{ fontFamily: FONTS.sans, fontSize: 22, fontWeight: 700, color: "#e8f4fd", marginBottom: 4 }}>{session.title}</h2>
        <div style={{ fontFamily: FONTS.mono, fontSize: 10, color: "rgba(150,180,220,0.5)", letterSpacing: "0.08em", marginBottom: 16 }}>{session.id}</div>

        <div style={{ padding: "12px 14px", borderRadius: 8, background: "rgba(0,212,255,0.05)", border: "1px solid rgba(0,212,255,0.15)", marginBottom: 16 }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.6)", letterSpacing: "0.12em", marginBottom: 6 }}>CONTENT</div>
          <div style={{ fontFamily: FONTS.sans, fontSize: 13, color: "rgba(200,230,255,0.9)", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: "50vh", overflowY: "auto" }}>{bodyText}</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {[
            ["LAST ACTIVE", session.last_active ? new Date(session.last_active).toLocaleString() : "-"],
            ["TOKENS", session.token_count ?? "-"],
            ["DURATION", session.duration_seconds ? `${Math.floor(session.duration_seconds / 60)}m ${session.duration_seconds % 60}s` : "-"],
            ["STATUS", session.status?.toUpperCase() || "-"],
          ].map(([k, v]) => (
            <div key={k} style={{ textAlign: "center", padding: "8px 4px", background: "rgba(255,255,255,0.02)", borderRadius: 6, border: "1px solid rgba(255,255,255,0.04)" }}>
              <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(150,180,220,0.5)", letterSpacing: "0.1em" }}>{k}</div>
              <div style={{ fontFamily: FONTS.mono, fontSize: 13, fontWeight: 700, color: agentColor, marginTop: 3 }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
