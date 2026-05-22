import { useState, useEffect, useCallback } from "react";
import * as api from "../api";
import { FONTS } from "../styles/theme.js";

const STATE_META = {
  closed:    { color: "#00ff88", bg: "rgba(0,255,136,0.08)", border: "rgba(0,255,136,0.2)", pulse: "circuit-pulse-closed", label: "CLOSED" },
  open:      { color: "#ff4444", bg: "rgba(255,68,68,0.08)", border: "rgba(255,68,68,0.3)", pulse: "circuit-pulse-open", label: "OPEN" },
  half_open: { color: "#f59e0b", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.2)", pulse: "circuit-pulse-half", label: "HALF-OPEN" },
};

export default function CircuitPanel({ onClose, onRefresh, adminToken, onToast }) {
  const [monitoring, setMonitoring] = useState(null);
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(null);
  const [localToken, setLocalToken] = useState(adminToken || "");
  const [showAdmin, setShowAdmin] = useState(false);
  const [tokenVerified, setTokenVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resetMsg, setResetMsg] = useState(null);
  const [liveRetry, setLiveRetry] = useState({});
  const [killSwitchArmed, setKillSwitchArmed] = useState(false);
  const [killSwitchActive, setKillSwitchActive] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const m = await api.getMonitoring();
    setMonitoring(m);
    setLoading(false);
    // Seed live retry map
    const retries = {};
    const circs = m?.circuit_breakers || {};
    Object.entries(circs).forEach(([name, cb]) => {
      if (cb.state === "open" && cb.retry_after > 0) retries[name] = cb.retry_after;
    });
    setLiveRetry(retries);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (Object.keys(liveRetry).length === 0) return;
    const t = setInterval(() => {
      setLiveRetry(prev => {
        const next = {};
        Object.entries(prev).forEach(([name, val]) => {
          const v = val - 1;
          if (v > 0) next[name] = v;
        });
        return next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [Object.keys(liveRetry).length]);

  const verifyToken = useCallback(async () => {
    if (!localToken.trim()) { setResetMsg({ ok: false, text: "Enter admin token" }); return; }
    setVerifying(true);
    const res = await api.resetCircuit("__verify__", localToken.trim());
    setVerifying(false);
    // 404 means token was valid but circuit name wrong — that's a pass
    // 401 means invalid token
    if (res.detail === "Invalid or missing admin token" || res.error === "Authentication failed — check API Token") {
      setTokenVerified(false);
      setResetMsg({ ok: false, text: "Invalid token" });
    } else {
      setTokenVerified(true);
      setResetMsg(null);
    }
  }, [localToken]);

  const doReset = useCallback(async (name) => {
    if (!localToken.trim()) { setResetMsg({ ok: false, text: "Enter admin token" }); return; }
    setResetting(name);
    setResetMsg(null);
    const res = await api.resetCircuit(name, localToken.trim());
    setResetting(null);
    if (res.current_state) {
      setResetMsg({ ok: true, text: `Reset ${name} → ${res.current_state}` });
      await load();
      onRefresh?.();
      onToast?.({ type: "success", title: "CIRCUIT RESET", body: name });
    } else {
      setResetMsg({ ok: false, text: res.detail || res.error || "Reset failed" });
    }
  }, [localToken, load, onRefresh, onToast]);

  const doKillSwitch = useCallback(async () => {
    if (!localToken.trim()) {
      setResetMsg({ ok: false, text: "Enter admin token to arm kill switch" });
      return;
    }
    setKillSwitchActive(true);
    const res = await api.activateKillSwitch(localToken.trim());
    if (res.status === "shutting_down") {
      setResetMsg({ ok: true, text: "KILL SWITCH ACTIVATED — Server shutting down..." });
      onToast?.({ type: "success", title: "KILL SWITCH", body: "Server shutting down" });
    } else {
      setKillSwitchActive(false);
      setKillSwitchArmed(false);
      setResetMsg({ ok: false, text: res.error || "Kill switch failed" });
    }
  }, [localToken, onToast]);

  const circuits = monitoring?.circuit_breakers || {};
  const circuitNames = Object.keys(circuits).sort();

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", justifyContent: "flex-end" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} />
      <div style={{ position: "relative", width: 420, maxWidth: "90vw", height: "100vh", background: "rgba(5,14,35,0.95)", borderLeft: "1px solid rgba(0,212,255,0.2)", overflowY: "auto", padding: 24, animation: "fade-up 0.3s ease" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 10, color: "#00d4ff", letterSpacing: "0.14em" }}>CIRCUIT BREAKERS</div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, color: "rgba(200,220,255,0.6)", cursor: "pointer", padding: "4px 10px", fontFamily: FONTS.mono, fontSize: 10 }}>ESC</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {circuitNames.map((name, i) => {
            const cb = circuits[name];
            const meta = STATE_META[cb.state] || STATE_META.closed;
            const isOpen = cb.state === "open";
            const retry = isOpen ? (liveRetry[name] ?? cb.retry_after) : 0;
            return (
              <div key={name} className="fade-up" style={{ animationDelay: `${i * 80}ms`, padding: "10px 12px", borderRadius: 8, background: meta.bg, border: `1px solid ${meta.border}`, position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: 0, right: 0, width: 40, height: 40, borderRadius: "0 8px 0 40px", background: `${meta.color}08`, pointerEvents: "none" }} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: meta.color, letterSpacing: "0.1em" }}>{meta.label}</span>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.color, display: "inline-block", animation: `${meta.pulse} 2s ease infinite` }} />
                </div>
                <div style={{ fontFamily: FONTS.mono, fontSize: 10, color: "rgba(200,230,255,0.85)", letterSpacing: "0.06em", marginBottom: 6 }}>
                  {name.replace("hermes_", "ARETE ").replace("shu_", "SHU ").toUpperCase()}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontFamily: FONTS.mono, fontSize: 8, color: "rgba(150,180,220,0.4)" }}>
                  <span>{cb.total_calls} calls</span>
                  <span>{cb.failed_calls} fail</span>
                  <span>{cb.state_changes} changes</span>
                </div>
                {isOpen && retry > 0 && (
                  <div style={{ marginTop: 4, fontFamily: FONTS.mono, fontSize: 8, color: "#ff4444" }}>
                    Retry after: {Math.ceil(retry)}s
                  </div>
                )}
              </div>
            );
          })}
          {circuitNames.length === 0 && !loading && (
            <div style={{ gridColumn: "1 / -1", padding: 12, textAlign: "center", fontFamily: FONTS.mono, fontSize: 10, color: "rgba(150,180,220,0.3)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 8 }}>
              No circuit breaker data
            </div>
          )}
        </div>

        <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button
            onClick={() => setShowAdmin(s => !s)}
            style={{ padding: "4px 10px", background: showAdmin ? "rgba(0,212,255,0.12)" : "rgba(0,212,255,0.06)", border: "1px solid rgba(0,212,255,0.2)", borderRadius: 4, color: "#00d4ff", fontFamily: FONTS.mono, fontSize: 9, cursor: "pointer" }}
          >
            {showAdmin ? "HIDE ADMIN" : "ADMIN"}
          </button>
          <button
            onClick={load}
            disabled={loading}
            style={{ padding: "4px 10px", background: loading ? "rgba(0,212,255,0.08)" : "rgba(0,212,255,0.15)", border: "1px solid rgba(0,212,255,0.3)", borderRadius: 4, color: "#00d4ff", fontFamily: FONTS.mono, fontSize: 9, cursor: "pointer" }}
          >
            {loading ? "..." : "REFRESH"}
          </button>
        </div>

        {showAdmin && (
          <div className="fade-in panel" style={{ padding: "12px 14px", marginTop: 12 }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.5)", letterSpacing: "0.14em", marginBottom: 8 }}>ADMIN CONTROLS</div>
            {!tokenVerified ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="password"
                  value={localToken}
                  onChange={e => { setLocalToken(e.target.value); setTokenVerified(false); setResetMsg(null); }}
                  onKeyDown={e => { if (e.key === "Enter" && localToken.trim()) verifyToken(); }}
                  placeholder="Admin token..."
                  style={{ flex: 1, padding: "6px 10px", background: "rgba(0,212,255,0.06)", border: "1px solid rgba(0,212,255,0.2)", borderRadius: 4, fontFamily: FONTS.mono, fontSize: 10, color: "#e8f4fd", outline: "none" }}
                />
                <button
                  onClick={verifyToken}
                  disabled={verifying || !localToken.trim()}
                  style={{ padding: "6px 12px", background: verifying ? "rgba(0,212,255,0.08)" : "rgba(0,212,255,0.15)", border: "1px solid rgba(0,212,255,0.3)", borderRadius: 4, color: "#00d4ff", fontFamily: FONTS.mono, fontSize: 9, cursor: verifying || !localToken.trim() ? "not-allowed" : "pointer" }}
                >
                  {verifying ? "..." : "VERIFY"}
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: "#00ff88", letterSpacing: "0.06em" }}>✓ AUTHENTICATED</span>
                <button
                  onClick={() => { setTokenVerified(false); setLocalToken(""); setKillSwitchArmed(false); setKillSwitchActive(false); }}
                  style={{ padding: "2px 8px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 3, color: "rgba(200,220,255,0.5)", fontFamily: FONTS.mono, fontSize: 8, cursor: "pointer" }}
                >
                  LOCK
                </button>
              </div>
            )}
            {resetMsg && (
              <div style={{ marginBottom: 8, padding: "4px 8px", borderRadius: 3, fontFamily: FONTS.mono, fontSize: 9, background: resetMsg.ok ? "rgba(0,255,136,0.08)" : "rgba(255,68,68,0.08)", color: resetMsg.ok ? "#00ff88" : "#ff4444", border: `1px solid ${resetMsg.ok ? "rgba(0,255,136,0.2)" : "rgba(255,68,68,0.2)"}` }}>
                {resetMsg.text}
              </div>
            )}
            {tokenVerified && (<>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {circuitNames.map(name => {
                const cb = circuits[name];
                const canReset = cb.state === "open" || cb.state === "half_open";
                return (
                  <button
                    key={name}
                    onClick={() => doReset(name)}
                    disabled={!canReset || resetting === name}
                    style={{
                      padding: "5px 10px",
                      background: canReset ? "rgba(255,68,68,0.1)" : "rgba(255,255,255,0.02)",
                      border: `1px solid ${canReset ? "rgba(255,68,68,0.3)" : "rgba(255,255,255,0.06)"}`,
                      borderRadius: 4,
                      color: canReset ? "#ff8888" : "rgba(150,180,220,0.25)",
                      fontFamily: FONTS.mono, fontSize: 9,
                      cursor: canReset ? "pointer" : "not-allowed",
                      letterSpacing: "0.06em",
                    }}
                  >
                    {resetting === name ? <span style={{ display: "inline-block", width: 8, height: 8, border: "2px solid rgba(255,68,68,0.3)", borderTopColor: "#ff4444", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} /> : "RESET"}
                    {" "}{name.replace("hermes_", "ARETE ").replace("shu_", "SHU ").toUpperCase()}
                  </button>
                );
              })}
            </div>

            {/* Kill Switch */}
            <div style={{ marginTop: 16, padding: "12px 14px", border: "1px solid rgba(255,68,68,0.2)", borderRadius: 6, background: "rgba(255,68,68,0.04)" }}>
              <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(255,68,68,0.6)", letterSpacing: "0.14em", marginBottom: 8 }}>KILL SWITCH</div>
              <div style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(150,180,220,0.35)", lineHeight: 1.5, marginBottom: 10 }}>
                Shuts down the dashboard server and all processes. Requires admin token.
              </div>
              {!killSwitchArmed ? (
                <button
                  onClick={() => setKillSwitchArmed(true)}
                  style={{
                    padding: "6px 14px", background: "rgba(255,68,68,0.08)", border: "1px solid rgba(255,68,68,0.25)",
                    borderRadius: 4, color: "#ff6666", fontFamily: FONTS.mono, fontSize: 9, cursor: "pointer",
                    letterSpacing: "0.06em",
                  }}
                >
                  ⚠ ARM KILL SWITCH
                </button>
              ) : (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button
                    onClick={doKillSwitch}
                    disabled={killSwitchActive}
                    style={{
                      padding: "6px 14px", background: killSwitchActive ? "rgba(255,68,68,0.15)" : "#ff4444",
                      border: `1px solid ${killSwitchActive ? "rgba(255,68,68,0.3)" : "#ff4444"}`,
                      borderRadius: 4, color: "#fff", fontFamily: FONTS.mono, fontSize: 9,
                      cursor: killSwitchActive ? "not-allowed" : "pointer", letterSpacing: "0.06em",
                      fontWeight: 700,
                    }}
                  >
                    {killSwitchActive ? "SHUTTING DOWN..." : "CONFIRM — SHUT DOWN"}
                  </button>
                  <button
                    onClick={() => { setKillSwitchArmed(false); setKillSwitchActive(false); }}
                    disabled={killSwitchActive}
                    style={{
                      padding: "6px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 4, color: "rgba(200,220,255,0.5)", fontFamily: FONTS.mono, fontSize: 9,
                      cursor: killSwitchActive ? "not-allowed" : "pointer",
                    }}
                  >
                    CANCEL
                  </button>
                </div>
              )}
            </div>
            </>)}
          </div>
        )}
      </div>
    </div>
  );
}
