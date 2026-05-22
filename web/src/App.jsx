import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import * as api from "./api";
import useStarfield from "./hooks/useStarfield";
import { FONTS } from "./styles/theme.js";
import { useSettings } from "./hooks/useSettings";
import { useActivityTracker } from "./hooks/useActivityTracker";
import { useProjectVisits } from "./hooks/useProjectVisits";

import AgentCard from "./components/AgentCard";
import SessionRow from "./components/SessionRow";
import ProjectCard from "./components/ProjectCard";
import ProjectDetail from "./components/ProjectDetail";
import SessionDetail from "./components/SessionDetail";
import SettingsPanel from "./components/SettingsPanel";
import Sparkline from "./components/Sparkline";
import CommandPalette from "./components/CommandPalette";
import CircuitPanel from "./components/CircuitPanel";

import DispatchPanel from "./panels/DispatchPanel";
import SearchPanel from "./panels/SearchPanel";
import BriefingPanel from "./panels/BriefingPanel";
import ErrorDashboard from "./panels/ErrorDashboard";
import TimelinePanel from "./panels/TimelinePanel";
import ContextView from "./panels/ContextView";
import MemoryExplorer from "./panels/MemoryExplorer";
import TailscaleFeedPanel from "./panels/TailscaleFeedPanel";
import PipelinePanel from "./panels/PipelinePanel";
import TrendsPanel from "./panels/TrendsPanel";
import HealthScorePanel from "./panels/HealthScorePanel";
import VaultVitalsPanel from "./panels/VaultVitalsPanel";
import CronDashboardPanel from "./panels/CronDashboardPanel";
import TradingPanel from "./panels/TradingPanel";
import ClaudeCodePanel from "./panels/ClaudeCodePanel";

const TABS = ["sessions", "errors", "skills", "search", "briefing", "errors-dashboard", "activity", "context", "memory", "mailbox", "pipeline", "trends", "health", "vault", "cron", "trading", "claude-code"];
const TAB_LABELS = { "errors-dashboard": "DASHBOARD", "claude-code": "CLAUDE" };

export default function App() {
  const canvasRef = useRef(null);
  const [time, setTime] = useState(new Date());
  const [activeTab, setActiveTab] = useState("sessions");
  const [agents, setAgents] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [projects, setProjects] = useState([]);
  const [skills, setSkills] = useState([]);
  const [errors, setErrors] = useState([]);
  const [fetchStatus, setFetchStatus] = useState({ projects: "idle", health: "idle", lastError: null });
  const [selectedProject, setSelectedProject] = useState(null);
  const [projectDetail, setProjectDetail] = useState(null);
  const [selectedSession, setSelectedSession] = useState(null);
  const [selectedSessionIds, setSelectedSessionIds] = useState(new Set());
  const [sseStatus, setSseStatus] = useState("connecting");
  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showCircuits, setShowCircuits] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [settings, updateSettings] = useSettings();
  const { history: activityHistory, record: recordActivity } = useActivityTracker();
  const { lastVisits, markVisited, getDelta } = useProjectVisits();
  const [sessionFilter, setSessionFilter] = useState("");

  const filteredSessions = useMemo(() => {
    if (!sessionFilter.trim()) return sessions;
    const q = sessionFilter.toLowerCase();
    return sessions.filter(s =>
      (s.title || "").toLowerCase().includes(q) ||
      (s.preview || "").toLowerCase().includes(q) ||
      (s.body || "").toLowerCase().includes(q) ||
      (s.agent_id || "").toLowerCase().includes(q) ||
      (s.status || "").toLowerCase().includes(q)
    );
  }, [sessions, sessionFilter]);

  useStarfield(canvasRef);

  // Clock
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Data refresh
  const refresh = useCallback(async () => {
    setFetchStatus(prev => ({ ...prev, projects: "loading", health: "loading" }));
    try {
      const [h, sess, err, sk, proj] = await Promise.all([
        api.getHealth(), api.getSessions(10), api.getErrors(10),
        api.getSkills(), api.getProjects(),
      ]);
      if (h) {
        setAgents(Object.entries(h.agents).map(([id, a]) => ({
          id,
          name: a.name || id.toUpperCase(),
          status: a.status,
          model: a.model,
          host: id === "arete" ? "WSL" : "Desktop",
          task: a.current_task || "Idle",
          uptime: a.uptime_seconds ? `${Math.floor(a.uptime_seconds / 3600)}h ${Math.floor((a.uptime_seconds % 3600) / 60)}m` : "—",
          sessions: a.session_count,
          error_count: a.error_count || 0,
          tokens: "—",
          color: id === "arete" ? "#00d4ff" : "#a78bfa",
          modelShort: a.model?.split("/").pop() || a.model?.slice(0, 15) || "—",
        })));
        setFetchStatus(prev => ({ ...prev, health: "ok" }));
      } else {
        setFetchStatus(prev => ({ ...prev, health: "failed" }));
      }
      if (sess) setSessions(sess);
      if (err) setErrors(err);
      if (sk) setSkills(sk.slice(0, 20));
      if (proj) {
        setProjects(proj);
        setFetchStatus(prev => ({ ...prev, projects: "ok", lastError: null }));
      } else {
        setFetchStatus(prev => ({ ...prev, projects: "failed" }));
      }
    } catch (e) {
      setFetchStatus(prev => ({ ...prev, health: "error", projects: "error", lastError: String(e) }));
    }
  }, []);

  useEffect(() => { refresh(); const t = setInterval(refresh, settings.refreshInterval * 1000); return () => clearInterval(t); }, [refresh, settings.refreshInterval]);

  // SSE
  useEffect(() => {
    const { cleanup, reconnect } = api.useSSE(
      "/api/events",
      (type, data) => {
        if (type === "state" && typeof data.snapshot === "string") {
          try {
            const snap = JSON.parse(data.snapshot);
            if (snap.agents?.length) setAgents(snap.agents.map(a => ({
              id: a.id, name: a.name || a.id?.toUpperCase(), status: a.status,
              model: a.model, host: a.id === "arete" ? "WSL" : "Desktop",
              task: a.current_task || "Idle",
              uptime: a.uptime_seconds ? `${Math.floor(a.uptime_seconds / 3600)}h ${Math.floor((a.uptime_seconds % 3600) / 60)}m` : "—",
              sessions: a.session_count, tokens: "—",
              color: a.id === "arete" ? "#00d4ff" : "#a78bfa",
              modelShort: a.model?.split("/").pop() || a.model?.slice(0, 15) || "—",
            })));
            if (snap.sessions?.length) setSessions(snap.sessions);
            if (snap.projects?.length) setProjects(snap.projects);
          } catch { /* ignore parse errors on heartbeat snapshots */ }
        } else if (type === "agent_status") {
          if (data.agent_id) {
            setAgents(prev => prev.map(a =>
              a.id === data.agent_id
                ? { ...a, status: data.status || a.status, task: data.current_task || a.task, sessions: data.session_count ?? a.sessions, model: data.model || a.model, modelShort: data.model?.split("/").pop() || data.model?.slice(0, 15) || a.modelShort, uptime: data.uptime_seconds ? `${Math.floor(data.uptime_seconds / 3600)}h ${Math.floor((data.uptime_seconds % 3600) / 60)}m` : a.uptime, error_count: data.error_count ?? a.error_count }
                : a
            ));
          }
        } else if (type === "session") {
          const incoming = data;
          if (incoming?.id) {
            recordActivity(incoming.agent_id);
            setSessions(prev => {
              const filtered = prev.filter(s => s.id !== incoming.id);
              const next = [incoming, ...filtered];
              next.sort((a, b) => new Date(b.last_active || 0) - new Date(a.last_active || 0));
              return next.slice(0, 50);
            });
          }
        } else if (type === "error") {
          const incoming = data;
          if (incoming?.id) {
            setErrors(prev => {
              const filtered = prev.filter(e => e.id !== incoming.id);
              const next = [incoming, ...filtered];
              next.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
              return next.slice(0, 50);
            });
          }
        } else if (type === "circuit" || type === "project") {
          refresh();
        } else if (type === "dispatch") {
          // Dispatch event: refresh sessions to show new dispatch
          refresh();
        }
      },
      (state) => setSseStatus(state)
    );
    window.__sseReconnect = reconnect;
    return cleanup;
  }, [recordActivity]);

  // Project detail fetcher
  useEffect(() => {
    if (!selectedProject) { setProjectDetail(null); return; }
    let cancelled = false;
    api.getProjectDetail(selectedProject.slug).then(d => {
      if (!cancelled && d) setProjectDetail(d);
    });
    return () => { cancelled = true; };
  }, [selectedProject]);

  // Toasts
  const addToast = useCallback((toast) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { ...toast, id }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
  }, []);

  // Bulk selection
  const toggleSession = useCallback((id) => {
    setSelectedSessionIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const selectAll = useCallback(() => {
    const target = sessionFilter.trim() ? filteredSessions : sessions;
    setSelectedSessionIds(new Set(target.map(s => s.id)));
  }, [sessions, filteredSessions, sessionFilter]);
  const clearSelection = useCallback(() => {
    setSelectedSessionIds(new Set());
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      const tag = e.target.tagName.toLowerCase();
      const isTyping = tag === "input" || tag === "textarea" || tag === "select";

      if (e.key === "Escape") {
        if (showPalette) { setShowPalette(false); return; }
        if (showCircuits) { setShowCircuits(false); return; }
        if (showSettings) { setShowSettings(false); return; }
        if (showHelp) { setShowHelp(false); return; }
        if (selectedSession) { setSelectedSession(null); return; }
        if (selectedProject) { setSelectedProject(null); return; }
        if (selectedSessionIds.size > 0) { clearSelection(); return; }
      }

      if (isTyping) return;

      if (e.key === "?") {
        e.preventDefault();
        setShowHelp(s => !s);
        return;
      }

      if (e.key === ",") {
        e.preventDefault();
        setShowSettings(s => !s);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setShowPalette(s => !s);
        return;
      }

      if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        setShowCircuits(true);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        if (activeTab === "sessions") {
          e.preventDefault();
          selectAll();
          return;
        }
      }

      const num = Number(e.key);
      if (!isNaN(num) && num >= 1 && num <= TABS.length) {
        e.preventDefault();
        setActiveTab(TABS[num - 1]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showHelp, showSettings, showPalette, showCircuits, selectedSession, selectedProject, selectedSessionIds, activeTab, selectAll, clearSelection]);

  // Export
  const exportCSV = useCallback(() => {
    const rows = sessions.filter(s => selectedSessionIds.has(s.id));
    const headers = ["id", "agent_id", "title", "status", "last_active", "tokens", "duration"];
    const csv = [headers.join(","), ...rows.map(r => headers.map(h => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sessions-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    addToast({ title: "EXPORTED CSV", body: `${rows.length} session${rows.length === 1 ? "" : "s"} exported`, type: "success" });
  }, [sessions, selectedSessionIds, addToast]);

  const exportJSON = useCallback(() => {
    const rows = sessions.filter(s => selectedSessionIds.has(s.id));
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sessions-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addToast({ title: "EXPORTED JSON", body: `${rows.length} session${rows.length === 1 ? "" : "s"} exported`, type: "success" });
  }, [sessions, selectedSessionIds, addToast]);

  const pad = n => String(n).padStart(2, "0");
  const timeStr = `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`;

  const tickItems = [
    ...agents.map(a => `${a.name} · ${a.modelShort} · ${a.status?.toUpperCase()}`),
    ...projects.map(p => `${p.slug?.slice(0, 4).toUpperCase()} · ${p.status?.toUpperCase()}`),
    `SESSIONS TODAY · ${sessions.length}`,
    `ERRORS · ${errors.length}`,
    `AGENTS · ${agents.length} ONLINE`,
  ];

  const tickerSparkline = (() => {
    const keys = Object.keys(activityHistory);
    if (!keys.length) return [];
    const len = activityHistory[keys[0]].length;
    return Array.from({ length: len }, (_, i) => keys.reduce((sum, k) => sum + (activityHistory[k][i] || 0), 0));
  })();

  return (
    <div style={{ position: "relative", minHeight: "100vh", background: "var(--bg)", fontFamily: FONTS.sans, overflow: "hidden" }} data-theme={settings.theme}>
      <canvas ref={canvasRef} style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none" }} />
      <div className="grid-overlay" style={{ position: "fixed" }} />
      <div style={{ position: "relative", zIndex: 1 }}>

        {/* HEADER */}
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 24px", borderBottom: "1px solid rgba(0,212,255,0.1)", background: "var(--bg-header)", backdropFilter: "blur(20px)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg, #00d4ff22, #7c3aed33)", border: "1px solid #00d4ff40", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid #00d4ff", background: "rgba(0,212,255,0.2)" }} />
            </div>
            <div>
              <div style={{ fontFamily: FONTS.mono, fontWeight: 700, fontSize: 13, color: "#e8f4fd", letterSpacing: "0.18em" }}>ARETE COMMAND CENTER</div>
              <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.55)", letterSpacing: "0.14em", marginTop: 1 }}>UNIFIED AGENT OBSERVABILITY · v0.4.0</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            {agents.map(a => (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span className="live-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: a.status === "online" ? "#00ff88" : "#ff4444", display: "inline-block" }} />
                <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: a.color, letterSpacing: "0.08em" }}>{a.name}</span>
              </div>
            ))}
            <div style={{ width: 1, height: 20, background: "rgba(0,212,255,0.15)" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: sseStatus === "live" ? "#00ff88" : sseStatus === "error" ? "#ff4444" : "#f59e0b", display: "inline-block" }} className={sseStatus === "live" ? "live-dot" : ""} />
              <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: sseStatus === "live" ? "rgba(0,255,136,0.6)" : sseStatus === "error" ? "rgba(255,68,68,0.6)" : "rgba(245,158,11,0.6)", letterSpacing: "0.08em" }}>SSE</span>
              {sseStatus === "error" && (
                <button
                  onClick={() => window.__sseReconnect?.()}
                  style={{ marginLeft: 4, padding: "2px 6px", background: "rgba(255,68,68,0.1)", border: "1px solid rgba(255,68,68,0.3)", borderRadius: 3, color: "#ff8888", fontFamily: FONTS.mono, fontSize: 8, cursor: "pointer", letterSpacing: "0.06em" }}
                >
                  RECONNECT
                </button>
              )}
            </div>
            <div style={{ width: 1, height: 20, background: "rgba(0,212,255,0.15)" }} />
            <button
              onClick={() => setShowCircuits(true)}
              title="Circuit Breakers"
              style={{ background: "transparent", border: "none", cursor: "pointer", padding: 4, display: "flex", alignItems: "center" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(0,212,255,0.6)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="4" width="16" height="16" rx="2" />
                <path d="M9 9h6v6H9z" />
              </svg>
            </button>
            <button
              onClick={() => setShowSettings(true)}
              title="Settings"
              style={{ background: "transparent", border: "none", cursor: "pointer", padding: 4, display: "flex", alignItems: "center" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(0,212,255,0.6)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
            <div style={{ width: 1, height: 20, background: "rgba(0,212,255,0.15)" }} />
            <div style={{ fontFamily: FONTS.mono, fontSize: 13, color: "#00d4ff", letterSpacing: "0.1em" }}>{timeStr}</div>
          </div>
        </header>

        {/* MAIN GRID */}
        <div style={{ display: "grid", gridTemplateColumns: "260px minmax(0, 1fr) 280px", gap: 16, padding: "16px 20px", minHeight: "calc(100vh - 100px)", overflow: "hidden" }}>

          {/* LEFT: AGENTS + DISPATCH */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.5)", letterSpacing: "0.16em", marginBottom: 4 }}>AGENT STATUS</div>
            {agents.map((a, i) => <AgentCard key={a.id} agent={a} delay={i * 100} sparklineData={activityHistory[a.id]} />)}

            <DispatchPanel skills={skills} agents={agents.length ? agents : [{ id: "arete", name: "ARETE" }, { id: "shu", name: "Shu" }]} onToast={addToast} />

            {/* SKILLS */}
            <div className="panel" style={{ padding: "14px", marginTop: 4 }}>
              <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.5)", letterSpacing: "0.16em", marginBottom: 10 }}>SKILL REGISTRY · {skills.length}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 300, overflowY: "auto" }}>
                {skills.map((sk, i) => {
                  const heat = sk.heat || "red";
                  const heatColor = heat === "green" ? "#00ff88" : heat === "yellow" ? "#f59e0b" : "#ff4444";
                  const lastUsed = sk.last_used ? new Date(sk.last_used) : null;
                  const heatTitle = sk.use_count > 0 ? `Used ${sk.use_count} times, last: ${lastUsed ? lastUsed.toLocaleDateString() : "never"}` : "Never used";
                  return (
                    <div key={sk.name} className="fade-up" style={{ animationDelay: `${300 + i * 60}ms`, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", background: "rgba(0,212,255,0.03)", borderRadius: 5, border: "1px solid rgba(0,212,255,0.07)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: heatColor, flexShrink: 0 }} title={heatTitle} />
                        <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: "rgba(180,220,255,0.7)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sk.name}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontFamily: FONTS.mono, fontSize: 8, color: sk.enabled ? "#00ff88" : "rgba(150,180,220,0.3)" }}>{sk.enabled ? "●" : "○"}</span>
                        {sk.enabled && (
                          <button
                            onClick={() => {
                              api.runSkill(sk.name).then(res => {
                                addToast({
                                  type: res.success ? "success" : "error",
                                  title: res.success ? `✓ SKILL: ${sk.name}` : `✗ SKILL FAILED`,
                                  body: res.response || res.error || "(dispatched)",
                                });
                                refresh();
                              });
                            }}
                            style={{ fontFamily: FONTS.mono, fontSize: 9, color: "#00d4ff", background: "rgba(0,212,255,0.08)", border: "1px solid rgba(0,212,255,0.2)", borderRadius: 3, padding: "1px 6px", cursor: "pointer", lineHeight: 1 }}
                            title={`Run skill: ${sk.name}`}
                          >
                            ▶
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {skills.length === 0 && <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: "rgba(150,180,220,0.3)" }}>Loading...</span>}
              </div>
            </div>
          </div>

          {/* CENTER: ACTIVITY / SEARCH / BRIEFING */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.5)", letterSpacing: "0.16em" }}>ACTIVITY MONITOR</div>
              <div style={{ display: "flex", gap: 2, flexWrap: "wrap", justifyContent: "flex-end", maxWidth: "calc(100% - 120px)" }}>
                {TABS.map(t => (
                  <button key={t} onClick={() => setActiveTab(t)} style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", padding: "4px 10px", borderRadius: 4, border: `1px solid ${activeTab === t ? "rgba(0,212,255,0.4)" : "rgba(0,212,255,0.1)"}`, background: activeTab === t ? "rgba(0,212,255,0.12)" : "transparent", color: activeTab === t ? "#00d4ff" : "rgba(0,212,255,0.4)", cursor: "pointer", transition: "all 0.15s" }}>{TAB_LABELS[t] || t}</button>
                ))}
              </div>
            </div>
            <div className="panel" style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", padding: activeTab === "search" || activeTab === "briefing" || activeTab === "errors-dashboard" || activeTab === "activity" || activeTab === "context" || activeTab === "memory" || activeTab === "mailbox" ? "16px" : 0 }}>
              {activeTab === "sessions" && (
                <>
                  <div style={{ display: "flex", gap: 8, padding: "6px 14px", borderBottom: "1px solid rgba(0,212,255,0.08)", alignItems: "center" }}>
                    <input
                      value={sessionFilter}
                      onChange={e => setSessionFilter(e.target.value)}
                      placeholder="Filter sessions..."
                      style={{ flex: 1, padding: "5px 10px", background: "rgba(0,212,255,0.06)", border: "1px solid rgba(0,212,255,0.2)", borderRadius: 4, fontFamily: FONTS.mono, fontSize: 10, color: "#e8f4fd", outline: "none" }}
                    />
                    {["arete", "shu", "running"].map(tag => (
                      <button key={tag} onClick={() => setSessionFilter(tag)} style={{ fontFamily: FONTS.mono, fontSize: 8, letterSpacing: "0.06em", padding: "3px 8px", borderRadius: 3, border: `1px solid ${sessionFilter === tag ? "rgba(0,212,255,0.4)" : "rgba(0,212,255,0.15)"}`, background: sessionFilter === tag ? "rgba(0,212,255,0.12)" : "transparent", color: sessionFilter === tag ? "#00d4ff" : "rgba(0,212,255,0.5)", cursor: "pointer" }}>{tag.toUpperCase()}</button>
                    ))}
                    {sessionFilter && <button onClick={() => setSessionFilter("")} style={{ fontFamily: FONTS.mono, fontSize: 8, color: "#ff8888", background: "transparent", border: "none", cursor: "pointer" }}>CLEAR</button>}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "28px 44px 56px 1fr 60px 52px 68px", gap: 8, padding: "8px 14px", borderBottom: "1px solid rgba(0,212,255,0.08)", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <input
                        type="checkbox"
                        ref={el => { if (el) { el.checked = filteredSessions.length > 0 && filteredSessions.every(s => selectedSessionIds.has(s.id)); el.indeterminate = selectedSessionIds.size > 0 && selectedSessionIds.size < filteredSessions.length; } }}
                        onChange={(e) => { e.stopPropagation(); if (e.target.checked) selectAll(); else clearSelection(); }}
                        style={{ width: 14, height: 14, accentColor: "#00d4ff", cursor: "pointer" }}
                      />
                    </div>
                    {["AGENT", "STATUS", "TASK", "TOKENS", "DURATION", "TIME"].map(h => (
                      <span key={h} style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.4)", letterSpacing: "0.1em" }}>{h}</span>
                    ))}
                  </div>
                  {selectedSessionIds.size > 0 && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 14px", borderBottom: "1px solid rgba(0,212,255,0.08)", background: "rgba(0,212,255,0.04)" }}>
                      <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: "#00d4ff", letterSpacing: "0.1em" }}>{selectedSessionIds.size} SELECTED</span>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={exportCSV} style={{ fontFamily: FONTS.mono, fontSize: 8, letterSpacing: "0.1em", padding: "3px 8px", borderRadius: 3, border: "1px solid rgba(0,212,255,0.2)", background: "rgba(0,212,255,0.08)", color: "#00d4ff", cursor: "pointer" }}>EXPORT CSV</button>
                        <button onClick={exportJSON} style={{ fontFamily: FONTS.mono, fontSize: 8, letterSpacing: "0.1em", padding: "3px 8px", borderRadius: 3, border: "1px solid rgba(0,212,255,0.2)", background: "rgba(0,212,255,0.08)", color: "#00d4ff", cursor: "pointer" }}>EXPORT JSON</button>
                        <button onClick={clearSelection} style={{ fontFamily: FONTS.mono, fontSize: 8, letterSpacing: "0.1em", padding: "3px 8px", borderRadius: 3, border: "1px solid rgba(255,68,68,0.2)", background: "rgba(255,68,68,0.08)", color: "#ff8888", cursor: "pointer" }}>CLEAR</button>
                      </div>
                    </div>
                  )}
                  <div style={{ overflowY: "auto", flex: 1 }}>
                    {filteredSessions.map((s, i) => <SessionRow key={s.id || i} s={s} idx={i} onClick={setSelectedSession} selected={selectedSessionIds.has(s.id)} onToggle={() => toggleSession(s.id)} />)}
                    {filteredSessions.length === 0 && <div style={{ padding: 20, textAlign: "center", fontFamily: FONTS.mono, fontSize: 10, color: "rgba(150,180,220,0.3)" }}>{sessionFilter ? "No matching sessions" : "No sessions"}</div>}
                  </div>
                </>
              )}
              {activeTab === "errors" && (
                <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8, overflowY: "auto" }}>
                  {errors.map((e, i) => {
                    const sevColors = {
                      critical: { dot: "#ff4444", bg: "rgba(255,68,68,0.05)", border: "rgba(255,68,68,0.2)", text: "rgba(255,100,100,0.7)" },
                      error: { dot: "#f59e0b", bg: "rgba(245,158,11,0.05)", border: "rgba(245,158,11,0.2)", text: "rgba(245,158,11,0.7)" },
                      warning: { dot: "#facc15", bg: "rgba(250,204,21,0.04)", border: "rgba(250,204,21,0.15)", text: "rgba(250,204,21,0.6)" },
                      info: { dot: "#00d4ff", bg: "rgba(0,212,255,0.04)", border: "rgba(0,212,255,0.15)", text: "rgba(0,212,255,0.6)" },
                    };
                    const sev = sevColors[e.severity] || sevColors.error;
                    return (
                      <div key={i} className="fade-up" style={{ animationDelay: `${i * 80}ms`, padding: "10px 14px", borderRadius: 6, background: sev.bg, border: `1px solid ${sev.border}`, display: "flex", alignItems: "flex-start", gap: 10 }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: sev.dot, display: "inline-block", marginTop: 5, flexShrink: 0 }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                            <span style={{ fontFamily: FONTS.mono, fontSize: 8, fontWeight: 600, color: sev.text, letterSpacing: "0.1em", padding: "1px 5px", borderRadius: 3, background: `${sev.dot}15`, border: `1px solid ${sev.border}` }}>{e.severity?.toUpperCase() || "ERROR"}</span>
                            <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: "rgba(150,180,220,0.5)" }}>{e.agent_id?.toUpperCase() || "?"} · {e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : ""}</span>
                          </div>
                          <div style={{ fontFamily: FONTS.sans, fontSize: 12, color: "rgba(200,200,180,0.8)" }}>{e.message || "(no detail)"}</div>
                        </div>
                      </div>
                    );
                  })}
                  {errors.length === 0 && <div style={{ padding: "10px 14px", borderRadius: 6, background: "rgba(0,255,136,0.03)", border: "1px solid rgba(0,255,136,0.1)", display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#00ff88", display: "inline-block", flexShrink: 0 }} />
                    <span style={{ fontFamily: FONTS.sans, fontSize: 12, color: "rgba(0,255,136,0.7)" }}>All critical systems nominal</span>
                  </div>}
                </div>
              )}
              {activeTab === "skills" && (
                (() => {
                  const grouped = {};
                  skills.forEach(sk => {
                    const cat = sk.category || "Uncategorized";
                    if (!grouped[cat]) grouped[cat] = [];
                    grouped[cat].push(sk);
                  });
                  const categories = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));
                  return (
                    <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" }}>
                      {categories.map(([cat, catSkills]) => (
                        <div key={cat}>
                          <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.45)", letterSpacing: "0.12em", marginBottom: 6, paddingBottom: 4, borderBottom: "1px solid rgba(0,212,255,0.06)" }}>{cat.toUpperCase()} · {catSkills.length}</div>
                          {catSkills.map((sk, i) => (
                            <div key={sk.name} className="fade-up" style={{ animationDelay: `${i * 50}ms`, padding: "10px 14px", borderRadius: 6, background: "rgba(0,212,255,0.03)", border: "1px solid rgba(0,212,255,0.1)", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                              <div>
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: "#00d4ff", letterSpacing: "0.06em" }}>{sk.name}</span>
                                  <span className="label-tag" style={{ fontSize: 8, background: `${sk.source === "plugin" ? "#a78bfa" : "#00d4ff"}15`, color: sk.source === "plugin" ? "#a78bfa" : "#00d4ff", border: `1px solid ${sk.source === "plugin" ? "#a78bfa" : "#00d4ff"}30` }}>{sk.source?.toUpperCase() || "LOCAL"}</span>
                                  {sk.trust && (
                                    <span style={{ width: 7, height: 7, borderRadius: "50%", display: "inline-block", background: sk.trust === "safe" ? "#00ff88" : sk.trust === "untrusted" ? "#ff4444" : "#f59e0b" }} title={`Trust: ${sk.trust}`} />
                                  )}
                                </div>
                              </div>
                              <span className="label-tag" style={{ background: sk.enabled ? "#00ff8812" : "transparent", color: sk.enabled ? "#00ff88" : "rgba(150,180,220,0.3)", border: `1px solid ${sk.enabled ? "#00ff8828" : "rgba(255,255,255,0.05)"}` }}>{sk.enabled ? "ACTIVE" : "DISABLED"}</span>
                            </div>
                          ))}
                        </div>
                      ))}
                      {categories.length === 0 && <div style={{ padding: 20, textAlign: "center", fontFamily: FONTS.mono, fontSize: 10, color: "rgba(150,180,220,0.3)" }}>No skills</div>}
                    </div>
                  );
                })()
              )}
              {activeTab === "search" && <SearchPanel />}
              {activeTab === "briefing" && <BriefingPanel />}
              {activeTab === "errors-dashboard" && <ErrorDashboard errors={errors} />}
              {activeTab === "activity" && <TimelinePanel />}
              {activeTab === "context" && <ContextView />}
              {activeTab === "memory" && <MemoryExplorer />}
              {activeTab === "mailbox" && <TailscaleFeedPanel />}
              {activeTab === "pipeline" && <PipelinePanel />}
              {activeTab === "trends" && <TrendsPanel />}
              {activeTab === "health" && <HealthScorePanel />}
              {activeTab === "vault" && <VaultVitalsPanel />}
              {activeTab === "cron" && <CronDashboardPanel />}
              {activeTab === "trading" && <TradingPanel />}
              {activeTab === "claude-code" && <ClaudeCodePanel />}
            </div>
          </div>

          {/* RIGHT: PROJECTS */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.5)", letterSpacing: "0.16em", marginBottom: 12 }}>PROJECT BOARD · {projects.length} ACTIVE{(() => { const updatedCount = projects.filter(p => getDelta(p.slug, p.updated) === "updated").length; return updatedCount > 0 ? ` · ${updatedCount} UPDATED` : ""; })()}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, overflowY: "auto" }}>
              {projects.map((p, i) => <ProjectCard key={p.slug || i} p={p} idx={i} onClick={(proj) => { if (proj?.slug) markVisited(proj.slug); setSelectedProject(proj); }} delta={getDelta(p.slug, p.updated)} />)}
              {projects.length === 0 && (
                <div style={{ padding: 20, textAlign: "center", fontFamily: FONTS.mono, fontSize: 10, color: "rgba(150,180,220,0.3)" }}>
                  {fetchStatus.projects === "loading" ? "Loading..." : `No projects (${fetchStatus.projects}${fetchStatus.lastError ? ": " + fetchStatus.lastError : ""})`}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* BOTTOM TICKER */}
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, height: 32, background: "var(--bg-ticker)", backdropFilter: "blur(12px)", borderTop: "1px solid rgba(0,212,255,0.1)", display: "flex", alignItems: "center", overflow: "hidden", zIndex: 10 }}>
          <div style={{ flexShrink: 0, padding: "0 16px", fontFamily: FONTS.mono, fontSize: 9, color: "#00d4ff", letterSpacing: "0.12em", borderRight: "1px solid rgba(0,212,255,0.15)", display: "flex", alignItems: "center", gap: 8 }}>
            <span className="live-dot">◈</span> LIVE
          </div>
          <div style={{ flexShrink: 0, padding: "0 10px", borderRight: "1px solid rgba(0,212,255,0.15)", display: "flex", alignItems: "center" }}>
            <Sparkline data={tickerSparkline} color="#00d4ff" width={90} height={20} />
          </div>
          <div style={{ overflow: "hidden", flex: 1 }}>
            <div className="ticker-inner">
              {[...tickItems, ...tickItems].map((item, i) => (
                <span key={i} style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.55)", letterSpacing: "0.1em" }}>
                  {item} <span style={{ color: "rgba(0,212,255,0.2)", margin: "0 8px" }}>·</span>
                </span>
              ))}
            </div>
          </div>
        </div>

      </div>

      {/* TOASTS */}
      <div style={{ position: "fixed", top: 60, right: 20, zIndex: 200, display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none" }}>
        {toasts.map(t => (
          <div key={t.id} className="toast-enter panel" style={{ padding: "10px 14px", minWidth: 220, maxWidth: 320, pointerEvents: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 4 }}>
              <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: t.type === "success" ? "#00ff88" : "#ff4444", letterSpacing: "0.1em" }}>{t.title}</span>
              <button onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))} style={{ background: "transparent", border: "none", color: "rgba(150,180,220,0.4)", cursor: "pointer", fontSize: 10, lineHeight: 1 }}>✕</button>
            </div>
            {t.body && <div style={{ fontFamily: FONTS.sans, fontSize: 11, color: "rgba(200,230,255,0.75)", lineHeight: 1.3, marginBottom: 4 }}>{t.body}</div>}
            {t.sessionId && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(0,212,255,0.4)" }}>session: {t.sessionId}</span>
                <button
                  onClick={() => navigator.clipboard.writeText(t.sessionId)}
                  style={{ fontFamily: FONTS.mono, fontSize: 8, color: "#00d4ff", background: "rgba(0,212,255,0.08)", border: "1px solid rgba(0,212,255,0.2)", borderRadius: 3, padding: "2px 6px", cursor: "pointer" }}
                >COPY ID</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* HELP OVERLAY */}
      {showHelp && (
        <div style={{ position: "fixed", inset: 0, zIndex: 150, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setShowHelp(false)}>
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} />
          <div className="panel fade-in" style={{ position: "relative", padding: "24px 28px", minWidth: 320, maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 10, color: "#00d4ff", letterSpacing: "0.14em", marginBottom: 16 }}>KEYBOARD SHORTCUTS</div>
            <div style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: "8px 16px", fontFamily: FONTS.sans, fontSize: 12, color: "rgba(200,230,255,0.8)" }}>
              <span style={{ fontFamily: FONTS.mono, color: "#00d4ff" }}>1–6</span><span>Switch tabs</span>
              <span style={{ fontFamily: FONTS.mono, color: "#00d4ff" }}>?</span><span>Toggle this help</span>
              <span style={{ fontFamily: FONTS.mono, color: "#00d4ff" }}>Esc</span><span>Close overlay / detail panel</span>
              <span style={{ fontFamily: FONTS.mono, color: "#00d4ff" }}>Ctrl+Enter</span><span>Submit dispatch task</span>
              <span style={{ fontFamily: FONTS.mono, color: "#00d4ff" }}>,</span><span>Open settings</span>
              <span style={{ fontFamily: FONTS.mono, color: "#00d4ff" }}>Ctrl+K</span><span>Open command palette</span>
              <span style={{ fontFamily: FONTS.mono, color: "#00d4ff" }}>B</span><span>Open circuit breaker panel</span>
              <span style={{ fontFamily: FONTS.mono, color: "#00d4ff" }}>Ctrl+A</span><span>Select all visible sessions</span>
            </div>
            <div style={{ marginTop: 16, textAlign: "center" }}>
              <button onClick={() => setShowHelp(false)} style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.6)", background: "transparent", border: "1px solid rgba(0,212,255,0.2)", borderRadius: 4, padding: "4px 12px", cursor: "pointer" }}>CLOSE</button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Panel */}
      {showSettings && <SettingsPanel settings={settings} onUpdate={updateSettings} onClose={() => setShowSettings(false)} />}

      {/* Command Palette */}
      {showPalette && (
        <CommandPalette
          sessions={sessions}
          projects={projects}
          skills={skills}
          agents={agents}
          errors={errors}
          activeTab={activeTab}
          onNavigate={(action, item) => {
            setShowPalette(false);
            if (action === "tab") setActiveTab(item);
            if (action === "session") { setActiveTab("sessions"); setSelectedSession(item); }
            if (action === "project") { setSelectedProject(item); }
          }}
          onRunSkill={(name) => {
            setShowPalette(false);
            addToast({ type: "success", title: "SKILL RUN", body: name });
          }}
          onClose={() => setShowPalette(false)}
        />
      )}

      {/* Circuit Panel */}
      {showCircuits && <CircuitPanel onClose={() => setShowCircuits(false)} onRefresh={refresh} adminToken={settings.adminToken} onToast={addToast} />}

      {/* Session Detail Modal */}
      <SessionDetail session={selectedSession} onClose={() => setSelectedSession(null)} />

      {/* Project Detail Modal */}
      <ProjectDetail project={selectedProject} detail={projectDetail} onClose={() => setSelectedProject(null)} />
    </div>
  );
}
