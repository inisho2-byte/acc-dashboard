import { useState, useEffect, useRef } from "react";
import { FONTS } from "../styles/theme.js";
import * as api from "../api.js";
import Sparkline from "./Sparkline.jsx";

export default function AgentCard({ agent, delay, sparklineData }) {
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [availableModels, setAvailableModels] = useState([]);
  const [swapping, setSwapping] = useState(false);
  const menuRef = useRef(null);

  // Close menu on outside click
  useEffect(() => {
    if (!showModelMenu) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowModelMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showModelMenu]);

  const fetchModels = async () => {
    const res = await api.getAgentModels(agent.id);
    if (res?.models) setAvailableModels(res.models);
  };

  const handleModelSwap = async (model) => {
    setSwapping(true);
    const res = await api.swapModel(agent.id, model);
    setShowModelMenu(false);
    setSwapping(false);
    if (res?.status === "preference_saved") {
      // Model preference saved but requires restart
      window.__toast?.({ type: "success", title: "MODEL PREFERENCE SAVED", body: `Model set to ${model}. Restart agent to apply.` });
    } else {
      window.__toast?.({ type: "error", title: "MODEL SWAP FAILED", body: res?.error || "Unknown error" });
    }
  };

  const c = agent.color || "#00d4ff";
  const hasErrors = (agent.error_count || 0) > 0;
  return (
    <div className="panel fade-up" style={{ padding: "18px", animationDelay: `${delay}ms`, position: "relative", overflow: "hidden" }}>
      {hasErrors && (
        <div style={{ position: "absolute", top: 8, right: 8, background: "#ff4444", color: "#fff", borderRadius: "50%", width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONTS.mono, fontSize: 9, fontWeight: 700 }} title={`${agent.error_count} error(s)`}>
          {agent.error_count > 9 ? "9+" : agent.error_count}
        </div>
      )}
      <div style={{ position: "absolute", top: 0, right: 0, width: 80, height: 80, borderRadius: "0 12px 0 80px", background: `${c}08`, pointerEvents: "none" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div className="agent-orb">
          <div className="pulse-ring" style={{ color: c, opacity: 0.5 }} />
          <div className="orb-core" style={{ background: `${c}18`, color: c, border: `1px solid ${c}40` }}>
            {agent.name.slice(0, 2)}
          </div>
          <div className="orb-dot1" style={{ background: c, marginTop: -2.5, marginLeft: -2.5 }} />
          <div className="orb-dot2" style={{ background: `${c}99`, marginTop: -2.5, marginLeft: -2.5 }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: FONTS.sans, fontWeight: 700, fontSize: 16, color: "#e8f4fd", letterSpacing: "0.06em" }}>{agent.name}</span>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: agent.status === "online" ? "#00ff88" : "#ff4444", display: "inline-block" }} className={agent.status === "online" ? "live-dot" : ""} />
          </div>
          <div style={{ fontFamily: FONTS.mono, fontSize: 10, color: `${c}99`, letterSpacing: "0.08em", marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
            <span>{agent.model || "—"}</span>
            <span>·</span>
            <span>{agent.host || "—"}</span>
          </div>
        </div>
        <span className="label-tag" style={{ background: agent.status === "online" ? "#00ff8815" : "#ff444415", color: agent.status === "online" ? "#00ff88" : "#ff4444", border: `1px solid ${agent.status === "online" ? "#00ff8830" : "#ff444430"}` }}>{agent.status?.toUpperCase() || "UNKNOWN"}</span>
      </div>
      <div style={{ marginTop: 14, padding: "10px 12px", background: "rgba(0,212,255,0.04)", borderRadius: 6, border: "1px solid rgba(0,212,255,0.08)" }}>
        <div style={{ fontFamily: FONTS.mono, fontSize: 10, color: "rgba(180,220,255,0.45)", letterSpacing: "0.08em", marginBottom: 4 }}>ACTIVE TASK</div>
        <div style={{ fontFamily: FONTS.sans, fontSize: 12, color: "rgba(200,230,255,0.8)", lineHeight: 1.4 }}>{agent.task || "Idle"}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 12 }}>
        {[["UPTIME", agent.uptime || "—"], ["SESSIONS", agent.sessions ?? "—"], ["MODEL", agent.modelShort || agent.model?.split("/").pop() || "—"]].map(([k, v]) => (
          <div key={k} style={{ textAlign: "center", padding: "8px 4px", background: "rgba(255,255,255,0.02)", borderRadius: 6, border: "1px solid rgba(255,255,255,0.04)", cursor: k === "MODEL" ? "pointer" : "default", position: "relative" }}
            onClick={k === "MODEL" ? () => { setShowModelMenu(true); fetchModels(); } : undefined}
          >
            <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(150,180,220,0.5)", letterSpacing: "0.1em" }}>{k}</div>
            <div style={{ fontFamily: FONTS.mono, fontSize: 13, fontWeight: 700, color: c, marginTop: 3 }}>{v}</div>
            {k === "MODEL" && (
              <div style={{ fontFamily: FONTS.mono, fontSize: 7, color: "rgba(0,212,255,0.4)", marginTop: 1 }}>SWAP ▼</div>
            )}
          </div>
        ))}
      </div>

      {/* Model swap dropdown */}
      {showModelMenu && (
        <div ref={menuRef} style={{ position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)", zIndex: 50, background: "rgba(10,18,32,0.97)", border: "1px solid rgba(0,212,255,0.25)", borderRadius: 6, padding: "6px 0", minWidth: 180, boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(0,212,255,0.5)", letterSpacing: "0.12em", padding: "4px 12px 6px", borderBottom: "1px solid rgba(0,212,255,0.1)" }}>AVAILABLE MODELS</div>
          {availableModels.length > 0 ? availableModels.map(m => (
            <button
              key={m}
              disabled={swapping}
              onClick={() => handleModelSwap(m)}
              style={{
                display: "block", width: "100%", padding: "6px 12px", border: "none", background: m === agent.modelShort || m === agent.model ? "rgba(0,212,255,0.12)" : "transparent",
                color: m === agent.modelShort || m === agent.model ? "#00d4ff" : "rgba(200,230,255,0.7)",
                fontFamily: FONTS.mono, fontSize: 10, cursor: swapping ? "not-allowed" : "pointer", textAlign: "left", letterSpacing: "0.04em"
              }}
            >
              {m === agent.modelShort || m === agent.model ? "● " : "○ "}{m.split("/").pop()}
            </button>
          )) : (
            <div style={{ padding: "6px 12px", fontFamily: FONTS.mono, fontSize: 9, color: "rgba(150,180,220,0.3)" }}>Loading models...</div>
          )}
          <div style={{ padding: "6px 12px 4px", borderTop: "1px solid rgba(0,212,255,0.1)", fontFamily: FONTS.mono, fontSize: 7, color: "rgba(150,180,220,0.3)", letterSpacing: "0.06em" }}>Restart agent to apply</div>
        </div>
      )}

      {sparklineData?.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(150,180,220,0.35)", letterSpacing: "0.1em" }}>ACTIVITY</div>
          <Sparkline data={sparklineData} color={c} width={160} height={24} fillOpacity={0.08} />
        </div>
      )}
    </div>
  );
}