import DOMPurify from "dompurify";
import { FONTS } from "../styles/theme.js";

export default function ErrorDashboard({ errors }) {
  const areteErrors = errors.filter(e => e.agent_id === "arete" || !e.agent_id);
  const shuErrors   = errors.filter(e => e.agent_id === "shu");

  const timeline = [...errors].sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return tb - ta;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%" }}>
      {/* Top bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.5)", letterSpacing: "0.16em" }}>
          ERROR DASHBOARD
        </div>
      </div>

      {/* Error Summary */}
      <div className="panel" style={{ padding: "12px 14px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.5)", letterSpacing: "0.12em", marginBottom: 6 }}>ARETE ERRORS</div>
            <div style={{ fontFamily: FONTS.mono, fontSize: 22, fontWeight: 700, color: areteErrors.length > 0 ? "#ff4444" : "#00ff88" }}>
              {areteErrors.length}
            </div>
            {areteErrors.slice(0, 3).map((e, i) => (
              <div key={i} style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(150,180,220,0.4)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {DOMPurify.sanitize(e.message || "")}
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(167,139,250,0.5)", letterSpacing: "0.12em", marginBottom: 6 }}>SHU ERRORS</div>
            <div style={{ fontFamily: FONTS.mono, fontSize: 22, fontWeight: 700, color: shuErrors.length > 0 ? "#ff4444" : "#00ff88" }}>
              {shuErrors.length}
            </div>
            {shuErrors.slice(0, 3).map((e, i) => (
              <div key={i} style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(150,180,220,0.4)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {DOMPurify.sanitize(e.message || "")}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Error Timeline */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.5)", letterSpacing: "0.14em", marginBottom: 8 }}>ERROR TIMELINE · {timeline.length}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {timeline.map((e, i) => {
            const isArete = e.agent_id === "arete" || !e.agent_id;
            const agentColor = isArete ? "#00d4ff" : "#a78bfa";
            const time = e.timestamp ? new Date(e.timestamp) : null;
            const timeStr = time ? time.toLocaleTimeString() : "—";
            return (
              <div key={i} className="fade-up" style={{ animationDelay: `${i * 50}ms`, display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 12px", borderRadius: 6, background: "rgba(245,158,11,0.03)", border: "1px solid rgba(245,158,11,0.1)" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#f59e0b", display: "inline-block", flexShrink: 0 }} />
                  {i < timeline.length - 1 && (
                    <div style={{ width: 1, flex: 1, background: "rgba(245,158,11,0.15)", minHeight: 8 }} />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                    <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: agentColor, letterSpacing: "0.08em" }}>
                      {e.agent_id?.toUpperCase() || "ARETE"}
                    </span>
                    <span style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(150,180,220,0.35)" }}>{timeStr}</span>
                  </div>
                  <div style={{ fontFamily: FONTS.sans, fontSize: 12, color: "rgba(200,200,180,0.85)", lineHeight: 1.4 }}>
                    {e.message || "(no detail)"}
                  </div>
                  {e.detail && (
                    <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(150,180,220,0.35)", marginTop: 2 }}>
                      {e.detail}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {timeline.length === 0 && (
            <div style={{ padding: 16, textAlign: "center", fontFamily: FONTS.mono, fontSize: 10, color: "rgba(0,255,136,0.4)", border: "1px solid rgba(0,255,136,0.1)", borderRadius: 8 }}>
              ✓ No errors recorded
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
