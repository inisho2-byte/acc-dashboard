import { useState, useRef, useCallback } from "react";
import DOMPurify from "dompurify";
import * as api from "../api";
import { FONTS } from "../styles/theme.js";

const FALLBACK_CHIPS = ["Check health", "Summarize", "Run tests"];

export default function DispatchPanel({ skills, agents, onToast }) {
  const [agent, setAgent] = useState("arete");
  const [task, setTask] = useState("");
  const [selectedSkill, setSelectedSkill] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const textareaRef = useRef(null);

  const availableSkills = skills?.filter(s => s.enabled) || [];

  const handleDispatch = useCallback(async (e) => {
    e?.preventDefault();
    if (!task.trim() || loading) return;
    setLoading(true);
    const res = await api.dispatch(agent, task.trim(), selectedSkill || null);
    setLoading(false);

    onToast?.({
      type: res.success ? "success" : "error",
      title: res.success ? `✓ ${res.agent?.toUpperCase()} ACCEPTED` : `✗ ${res.agent?.toUpperCase()} FAILED`,
      body: res.response || res.error || "(no response)",
      sessionId: res.session_id,
    });

    const entry = {
      id: Date.now(),
      agent: res.agent || agent,
      task: task.trim(),
      success: res.success,
      response: res.response || res.message || "",
      error: res.error || null,
      truncated: res.truncated || false,
      sessionId: res.session_id || "",
      timestamp: new Date().toLocaleTimeString(),
    };
    setHistory(prev => [entry, ...prev].slice(0, 20));
    setTask("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    setSelectedSkill("");
    textareaRef.current?.focus();
  }, [agent, task, selectedSkill, loading, onToast]);

  const getAgentColor = id => id === "arete" ? "#00d4ff" : "#a78bfa";

  // Quick-task chips from history frequency
  const chipTexts = (() => {
    if (history.length === 0) return FALLBACK_CHIPS;
    const freq = {};
    history.forEach(h => { freq[h.task] = (freq[h.task] || 0) + 1; });
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([text]) => text);
  })();

  const applyChip = (text) => {
    setTask(text);
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 120) + "px";
      el.focus();
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="panel" style={{ padding: "16px" }}>
        <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.5)", letterSpacing: "0.16em", marginBottom: 12 }}>TASK DISPATCH</div>

        <form onSubmit={handleDispatch} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <select
              value={agent}
              onChange={e => setAgent(e.target.value)}
              style={{ padding: "6px 10px", background: "rgba(0,212,255,0.06)", border: "1px solid rgba(0,212,255,0.2)", borderRadius: 4, fontFamily: FONTS.mono, fontSize: 10, color: "#e8f4fd", outline: "none", cursor: "pointer" }}
            >
              {agents.map(a => (
                <option key={a.id} value={a.id}>{a.name.toUpperCase()}</option>
              ))}
            </select>
            <select
              value={selectedSkill}
              onChange={e => setSelectedSkill(e.target.value)}
              style={{ flex: 1, padding: "6px 10px", background: "rgba(0,212,255,0.06)", border: "1px solid rgba(0,212,255,0.2)", borderRadius: 4, fontFamily: FONTS.mono, fontSize: 10, color: "#e8f4fd", outline: "none", cursor: "pointer" }}
            >
              <option value="">— no skill —</option>
              {availableSkills.map(s => (
                <option key={s.name} value={s.name}>{s.name}</option>
              ))}
            </select>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <textarea
              ref={textareaRef}
              value={task}
              onChange={e => {
                setTask(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
              }}
              onKeyDown={e => {
                if (e.ctrlKey && e.key === "Enter") {
                  e.preventDefault();
                  handleDispatch(e);
                }
              }}
              placeholder={`Task for ${agent.toUpperCase()}...`}
              rows={1}
              style={{ flex: 1, padding: "8px 12px", background: "rgba(0,212,255,0.06)", border: "1px solid rgba(0,212,255,0.2)", borderRadius: 4, fontFamily: FONTS.mono, fontSize: 11, color: "#e8f4fd", outline: "none", resize: "none", overflow: "hidden", minHeight: 36, maxHeight: 120, lineHeight: 1.4 }}
            />
            <button
              type="submit"
              disabled={loading || !task.trim()}
              style={{ padding: "8px 16px", background: loading ? "rgba(0,212,255,0.08)" : "rgba(0,212,255,0.2)", border: "1px solid rgba(0,212,255,0.4)", borderRadius: 4, color: loading ? "rgba(0,212,255,0.4)" : "#00d4ff", fontFamily: FONTS.mono, fontSize: 10, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", letterSpacing: "0.08em", display: "flex", alignItems: "center", gap: 6 }}
            >
              {loading && <span style={{ display: "inline-block", width: 10, height: 10, border: "2px solid rgba(0,212,255,0.3)", borderTopColor: "#00d4ff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />}
              {loading ? "SENDING..." : "DISPATCH"}
            </button>
          </div>

          {/* Quick-task chips */}
          {chipTexts.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: -4 }}>
              {chipTexts.map(text => (
                <button
                  key={text}
                  type="button"
                  onClick={() => applyChip(text)}
                  style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.6)", background: "rgba(0,212,255,0.05)", border: "1px solid rgba(0,212,255,0.12)", borderRadius: 4, padding: "3px 8px", cursor: "pointer", letterSpacing: "0.06em" }}
                >
                  {text}
                </button>
              ))}
            </div>
          )}
        </form>
      </div>

      {history.length > 0 && (
        <div className="panel" style={{ padding: "14px", maxHeight: 280, overflowY: "auto" }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.5)", letterSpacing: "0.16em", marginBottom: 10 }}>DISPATCH LOG · {history.length}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {history.map((h, i) => (
              <div key={h.id} className="fade-up" style={{ animationDelay: `${i * 40}ms`, padding: "8px 10px", borderRadius: 5, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                  <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: getAgentColor(h.agent), letterSpacing: "0.06em" }}>{h.agent.toUpperCase()}</span>
                  <span style={{ fontFamily: FONTS.mono, fontSize: 8, color: h.success ? "#00ff88" : "#ff4444" }}>{h.success ? "●" : "●"}</span>
                </div>
                <div style={{ fontFamily: FONTS.sans, fontSize: 11, color: "rgba(200,230,255,0.7)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.task}</div>
                {h.response && (
                  <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(150,180,220,0.5)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {DOMPurify.sanitize(h.response || "")}
                    {h.truncated && <span style={{ color: "rgba(0,212,255,0.5)", marginLeft: 4 }}>[...]</span>}
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 2 }}>
                  <span style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(150,180,220,0.35)" }}>{h.timestamp}</span>
                  {h.sessionId && (
                    <button
                      onClick={() => copyToClipboard(h.sessionId)}
                      style={{ fontFamily: FONTS.mono, fontSize: 7, color: "rgba(0,212,255,0.5)", background: "transparent", border: "1px solid rgba(0,212,255,0.15)", borderRadius: 3, padding: "1px 5px", cursor: "pointer" }}
                      title={`Copy session ID: ${h.sessionId}`}
                    >
                      COPY ID
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}