import { useState, useEffect, useCallback } from "react";
import DOMPurify from "dompurify";
import * as api from "../api";
import { FONTS } from "../styles/theme.js";

export default function BriefingPanel() {
  const [briefing, setBriefing] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hours, setHours] = useState(() => {
    const stored = typeof window !== "undefined" && localStorage.getItem("acc_last_checkin");
    if (stored) {
      const diffMs = Date.now() - new Date(stored).getTime();
      const diffHrs = Math.ceil(diffMs / 3600000);
      return Math.min(Math.max(diffHrs, 1), 168);
    }
    return 24;
  });

  const loadBriefing = useCallback(async () => {
    setLoading(true);
    const res = await api.getBriefing(hours);
    setBriefing(res);
    localStorage.setItem("acc_last_checkin", new Date().toISOString());
    setLoading(false);
  }, [hours]);

  useEffect(() => { loadBriefing(); }, [loadBriefing]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.5)", letterSpacing: "0.16em" }}>
          {briefing ? `BRIEFING · LAST ${briefing.since_hours}H` : "BRIEFING"}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <select
            value={hours}
            onChange={e => setHours(Number(e.target.value))}
            style={{ padding: "4px 8px", background: "rgba(0,212,255,0.06)", border: "1px solid rgba(0,212,255,0.2)", borderRadius: 4, fontFamily: FONTS.mono, fontSize: 9, color: "#e8f4fd", outline: "none", cursor: "pointer" }}
          >
            <option value={6}>6h</option>
            <option value={12}>12h</option>
            <option value={24}>24h</option>
            <option value={48}>48h</option>
            <option value={72}>72h</option>
          </select>
          <button
            onClick={loadBriefing}
            disabled={loading}
            style={{ padding: "4px 10px", background: loading ? "rgba(0,212,255,0.08)" : "rgba(0,212,255,0.15)", border: "1px solid rgba(0,212,255,0.3)", borderRadius: 4, color: "#00d4ff", fontFamily: FONTS.mono, fontSize: 9, cursor: "pointer" }}
          >
            {loading ? "..." : "REFRESH"}
          </button>
        </div>
      </div>

      {loading && !briefing && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: "rgba(150,180,220,0.3)" }}>Loading briefing...</span>
        </div>
      )}

      {briefing && (
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Narrative */}
          {briefing.narrative && (
            <div style={{ fontFamily: FONTS.sans, fontSize: 12, color: "rgba(200,230,255,0.85)", lineHeight: 1.5, padding: "10px 14px", background: "rgba(0,212,255,0.04)", border: "1px solid rgba(0,212,255,0.1)", borderRadius: 6 }}>
              {briefing.narrative}
            </div>
          )}

          {/* Summary */}
          <div className="panel" style={{ padding: "12px 14px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 8 }}>
              {[
                ["EVENTS", briefing.summary?.total_events ?? "—"],
                ["SESSIONS", briefing.summary?.arete_sessions ?? "—"],
                ["MESSAGES", briefing.summary?.shu_messages ?? "—"],
                ["CRON", briefing.summary?.cron_jobs_run ?? "—"],
                ["ERRORS", briefing.summary?.errors ?? "—", briefing.summary?.errors > 0 ? "#ff4444" : "#00ff88"],
              ].map(([k, v, color]) => (
                <div key={k} style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(150,180,220,0.5)", letterSpacing: "0.1em" }}>{k}</div>
                  <div style={{ fontFamily: FONTS.mono, fontSize: 16, fontWeight: 700, color: color || "#00d4ff", marginTop: 2 }}>{v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Sessions */}
          {briefing.recent_sessions?.length > 0 && (
            <div className="panel" style={{ padding: "12px 14px" }}>
              <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.5)", letterSpacing: "0.14em", marginBottom: 8 }}>RECENT SESSIONS</div>
              {briefing.recent_sessions.map((s, i) => (
                <div key={i} className="fade-up" style={{ animationDelay: `${i * 60}ms`, padding: "6px 0", borderBottom: i < briefing.recent_sessions.length - 1 ? "1px solid rgba(0,212,255,0.05)" : "none" }}>
                  <div style={{ fontFamily: FONTS.sans, fontSize: 12, color: "rgba(200,230,255,0.8)" }}>{s.title}</div>
                  <div style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(150,180,220,0.35)" }}>{s.timestamp ? new Date(s.timestamp).toLocaleString() : ""}</div>
                </div>
              ))}
            </div>
          )}

          {/* Recent Messages */}
          {briefing.recent_messages?.length > 0 && (
            <div className="panel" style={{ padding: "12px 14px" }}>
              <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(167,139,250,0.5)", letterSpacing: "0.14em", marginBottom: 8 }}>RECENT MESSAGES</div>
              {briefing.recent_messages.map((m, i) => (
                <div key={i} className="fade-up" style={{ animationDelay: `${i * 60}ms`, padding: "6px 0", borderBottom: i < briefing.recent_messages.length - 1 ? "1px solid rgba(167,139,250,0.05)" : "none" }}>
                  <div style={{ fontFamily: FONTS.sans, fontSize: 12, color: "rgba(200,230,255,0.8)" }}>{m.preview}</div>
                  <div style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(150,180,220,0.35)" }}>{m.timestamp ? new Date(m.timestamp).toLocaleString() : ""}</div>
                </div>
              ))}
            </div>
          )}

          {/* Projects */}
          {briefing.projects?.length > 0 && (
            <div className="panel" style={{ padding: "12px 14px" }}>
              <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.5)", letterSpacing: "0.14em", marginBottom: 8 }}>PROJECTS</div>
              {briefing.projects.map((p, i) => (
                <div key={i} className="fade-up" style={{ animationDelay: `${i * 60}ms`, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: i < briefing.projects.length - 1 ? "1px solid rgba(0,212,255,0.05)" : "none" }}>
                  <div>
                    <div style={{ fontFamily: FONTS.sans, fontSize: 12, color: "rgba(200,230,255,0.8)" }}>{p.name}</div>
                    <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(150,180,220,0.4)", marginTop: 1 }}>→ {p.next_step || "—"}</div>
                  </div>
                  <span className="label-tag" style={{ background: "rgba(0,212,255,0.08)", color: "rgba(0,212,255,0.7)", border: "1px solid rgba(0,212,255,0.15)" }}>{p.phases}</span>
                </div>
              ))}
            </div>
          )}

          {/* Errors */}
          {briefing.errors?.length > 0 && (
            <div className="panel" style={{ padding: "12px 14px" }}>
              <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(255,68,68,0.5)", letterSpacing: "0.14em", marginBottom: 8 }}>ERRORS</div>
              {briefing.errors.map((e, i) => (
                <div key={i} className="fade-up" style={{ animationDelay: `${i * 60}ms`, padding: "6px 0", borderBottom: i < briefing.errors.length - 1 ? "1px solid rgba(255,68,68,0.05)" : "none" }}>
                  <div style={{ fontFamily: FONTS.sans, fontSize: 12, color: "rgba(255,200,200,0.8)" }}>{DOMPurify.sanitize(e.message || "")}</div>
                  <div style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(150,180,220,0.35)" }}>{e.timestamp ? new Date(e.timestamp).toLocaleString() : ""}</div>
                </div>
              ))}
            </div>
          )}

          {briefing.errors?.length === 0 && briefing.recent_sessions?.length === 0 && briefing.recent_messages?.length === 0 && (
            <div style={{ padding: 20, textAlign: "center", fontFamily: FONTS.mono, fontSize: 10, color: "rgba(150,180,220,0.3)" }}>
              No activity in the last {briefing.since_hours} hours
            </div>
          )}
        </div>
      )}
    </div>
  );
}
