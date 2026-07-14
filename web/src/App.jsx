import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from "react";
import * as api from "./api";
import useParticleField from "./hooks/useParticleField";
import { FONTS } from "./styles/theme.js";
import { useSettings } from "./hooks/useSettings";
import { useProjectVisits } from "./hooks/useProjectVisits";

import AgentCard from "./components/AgentCard";
import SessionRow from "./components/SessionRow";
import ProjectCard from "./components/ProjectCard";
import ProjectDetail from "./components/ProjectDetail";
import SessionDetail from "./components/SessionDetail";
import SettingsPanel from "./components/SettingsPanel";
import CommandPalette from "./components/CommandPalette";
import CircuitPanel from "./components/CircuitPanel";
import ErrorBoundary from "./components/ErrorBoundary";

import Layout from "./components/Layout";
import Sidebar, { COLLAPSED_WIDTH, EXPANDED_WIDTH } from "./components/SidebarNew";
import TopBar from "./components/TopBar";
import ContentCard from "./components/ContentCard";
import AlertTicker from "./components/AlertTicker";

const SearchPanel = lazy(() => import("./panels/SearchPanel"));
const BriefingPanel = lazy(() => import("./panels/BriefingPanel"));
const ErrorsPanel = lazy(() => import("./panels/ErrorsPanel"));
const SessionsPanel = lazy(() => import("./panels/SessionsPanel"));
const MemoryPanel = lazy(() => import("./panels/MemoryPanel"));
const TailscaleFeedPanel = lazy(() => import("./panels/TailscaleFeedPanel"));
const PipelinePanel = lazy(() => import("./panels/PipelinePanel"));
const TrendsPanel = lazy(() => import("./panels/TrendsPanel"));
const HealthScorePanel = lazy(() => import("./panels/HealthScorePanel"));
const VaultVitalsPanel = lazy(() => import("./panels/VaultVitalsPanel"));
const CronDashboardPanel = lazy(() => import("./panels/CronDashboardPanel"));
const TradingPanel = lazy(() => import("./panels/TradingPanel"));
const ClaudeCodePanel = lazy(() => import("./panels/ClaudeCodePanel"));
const ChatPanel = lazy(() => import("./panels/ChatPanel"));
// DispatchPanel is dormant — POST /api/dispatch returns 404, not added to navConfig
const IBCBFeedPanel = lazy(() => import("./panels/IBCBFeedPanel"));

const OverviewPanel = lazy(() => import("./panels/OverviewPanel"));
const AgentsPanel = lazy(() => import("./panels/AgentsPanel"));
const TasksPanel = lazy(() => import("./panels/TasksPanel"));
const SchedulePanel = lazy(() => import("./panels/SchedulePanel"));
const ContentPanel = lazy(() => import("./panels/ContentPanel"));

import { ALL_TABS as TABS, TAB_LABELS, TAB_META, SHORTCUT_MAP, GROUP_COLORS } from "./navConfig";

const AGENT_COLORS = {
  arete: "#00d4ff",
  shu: "#a78bfa",
  "claude-code": "#f59e0b",
  scout: "#00ff88",
  scribe: "#f59e0b",
  reach: "#a78bfa",
  dev: "#f472b6",
};

export default function App() {
 const canvasRef = useRef(null);
 const [activeTab, setActiveTab] = useState("overview");
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
 const [sidebarExpanded, setSidebarExpanded] = useState(false);
 const [settings, updateSettings] = useSettings();
 const recordActivity = useCallback(() => {}, []); // no-op stub — preserves SSE pipeline wiring
 const handleReconnect = useCallback(() => window.__sseReconnect?.(), []);
 const handleCircuits = useCallback(() => setShowCircuits(true), []);
 const handleSettings = useCallback(() => setShowSettings(true), []);
 const { markVisited, getDelta } = useProjectVisits();
  const [sessionFilter, setSessionFilter] = useState("");

  const filteredSessions = useMemo(() => {
    if (!sessionFilter.trim()) return sessions;
    const q = sessionFilter.toLowerCase();
    return sessions.filter((s) =>
      (s.title || "").toLowerCase().includes(q) ||
      (s.preview || "").toLowerCase().includes(q) ||
      (s.body || "").toLowerCase().includes(q) ||
      (s.agent_id || "").toLowerCase().includes(q) ||
      (s.status || "").toLowerCase().includes(q)
    );
  }, [sessions, sessionFilter]);

 useParticleField(canvasRef);

 // Data refresh
  const refresh = useCallback(async () => {
    setFetchStatus((prev) => ({ ...prev, projects: "loading", health: "loading" }));
    try {
      const [h, sess, err, sk, proj] = await Promise.all([
        api.getHealth(),
        api.getSessions(10),
        api.getErrors(10),
        api.getSkills(),
        api.getProjects(),
      ]);
      if (h) {
        setAgents(
          Object.entries(h.agents).map(([id, a]) => ({
            id,
            name: a.name || id.toUpperCase(),
            status: a.status,
            model: a.model,
            host: id === "arete" ? "WSL" : (["scout","scribe","reach","dev"].includes(id) ? "AgentOS" : "Desktop"),
            task: a.current_task || "Idle",
            uptime: a.uptime_seconds
              ? `${Math.floor(a.uptime_seconds / 3600)}h ${Math.floor((a.uptime_seconds % 3600) / 60)}m`
              : "—",
            sessions: a.session_count,
            error_count: a.error_count || 0,
            tokens: "—",
            color: AGENT_COLORS[id] || "#a78bfa",
            modelShort: a.model?.split("/").pop() || a.model?.slice(0, 15) || "—",
          }))
        );
        setFetchStatus((prev) => ({ ...prev, health: "ok" }));
      } else {
        setFetchStatus((prev) => ({ ...prev, health: "failed" }));
      }
      if (sess) setSessions(sess);
      if (err) setErrors(err);
      if (sk) setSkills(sk.slice(0, 20));
      if (proj) {
        setProjects(proj);
        setFetchStatus((prev) => ({ ...prev, projects: "ok", lastError: null }));
      } else {
        setFetchStatus((prev) => ({ ...prev, projects: "failed" }));
      }
    } catch (e) {
      setFetchStatus((prev) => ({ ...prev, health: "error", projects: "error", lastError: String(e) }));
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, settings.refreshInterval * 1000);
    return () => clearInterval(t);
  }, [refresh, settings.refreshInterval]);

  // SSE
  useEffect(() => {
    const { cleanup, reconnect } = api.useSSE(
      "/api/events",
      (type, data) => {
        if (type === "state" && typeof data.snapshot === "string") {
          try {
            const snap = JSON.parse(data.snapshot);
 if (snap.agents?.length)
 setAgents((prev) => {
 const incoming = snap.agents.map((a) => ({
 id: a.id,
 name: a.name || a.id?.toUpperCase(),
 status: a.status,
 model: a.model,
 host: a.id === "arete" ? "WSL" : (["scout","scribe","reach","dev"].includes(a.id) ? "AgentOS" : "Desktop"),
 task: a.current_task || "Idle",
 uptime: a.uptime_seconds
 ? `${Math.floor(a.uptime_seconds / 3600)}h ${Math.floor((a.uptime_seconds % 3600) / 60)}m`
 : "—",
 sessions: a.session_count,
 tokens: "—",
 color: AGENT_COLORS[a.id] || "#a78bfa",
 modelShort: a.model?.split("/").pop() || a.model?.slice(0, 15) || "—",
 }));
 // Shallow compare: if all key fields match, return same reference
 if (prev.length === incoming.length && prev.every((a, i) => a.id === incoming[i].id && a.status === incoming[i].status && a.task === incoming[i].task && a.model === incoming[i].model)) return prev;
 return incoming;
 });
            if (snap.sessions?.length) setSessions(snap.sessions);
            if (snap.projects?.length) setProjects(snap.projects);
          } catch {
            /* ignore parse errors on heartbeat snapshots */
          }
 } else if (type === "agent_status") {
 if (data.agent_id) {
 setAgents((prev) => {
 const idx = prev.findIndex((a) => a.id === data.agent_id);
 if (idx === -1) return [...prev, { id: data.agent_id, status: data.status, task: data.current_task || "Idle", model: data.model, modelShort: data.model?.split("/").pop() || data.model?.slice(0, 15) || "—", sessions: data.session_count ?? 0, color: AGENT_COLORS[data.agent_id] || "#a78bfa", name: data.agent_id?.toUpperCase() }];
 const existing = prev[idx];
 const newStatus = data.status ?? existing.status;
 const newTask = data.current_task ?? existing.task;
 const newModel = data.model ?? existing.model;
 if (existing.status === newStatus && existing.task === newTask && existing.model === newModel) return prev;
 return prev.map((a) =>
 a.id === data.agent_id
 ? {
 ...a,
 status: newStatus,
 task: newTask,
 sessions: data.session_count ?? a.sessions,
 model: newModel,
 modelShort: data.model?.split("/").pop() || data.model?.slice(0, 15) || a.modelShort,
 uptime: data.uptime_seconds
 ? `${Math.floor(data.uptime_seconds / 3600)}h ${Math.floor((data.uptime_seconds % 3600) / 60)}m`
 : a.uptime,
 error_count: data.error_count ?? a.error_count,
 }
 : a
 );
 });
 }
        } else if (type === "session") {
          const incoming = data;
          if (incoming?.id) {
            recordActivity(incoming.agent_id);
            setSessions((prev) => {
              const filtered = prev.filter((s) => s.id !== incoming.id);
              const next = [incoming, ...filtered];
              next.sort((a, b) => new Date(b.last_active || 0) - new Date(a.last_active || 0));
              return next.slice(0, 50);
            });
          }
        } else if (type === "error") {
          const incoming = data;
          if (incoming?.id) {
            setErrors((prev) => {
              const filtered = prev.filter((e) => e.id !== incoming.id);
              const next = [incoming, ...filtered];
              next.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
              return next.slice(0, 50);
            });
          }
        } else if (type === "circuit" || type === "project") {
          refresh();
        } else if (type === "dispatch") {
          refresh();
        }
      },
      (state) => setSseStatus(state)
    );
 window.__sseReconnect = reconnect;
 return cleanup;
 }, []);

  // Project detail fetcher
  useEffect(() => {
    if (!selectedProject) {
      setProjectDetail(null);
      return;
    }
    let cancelled = false;
    api.getProjectDetail(selectedProject.slug).then((d) => {
      if (!cancelled && d) setProjectDetail(d);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedProject]);

  // Toasts
  const addToast = useCallback((toast) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  // Bulk selection
  const toggleSession = useCallback((id) => {
    setSelectedSessionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const selectAll = useCallback(() => {
    const target = sessionFilter.trim() ? filteredSessions : sessions;
    setSelectedSessionIds(new Set(target.map((s) => s.id)));
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
        if (showPalette) {
          setShowPalette(false);
          return;
        }
        if (showCircuits) {
          setShowCircuits(false);
          return;
        }
        if (showSettings) {
          setShowSettings(false);
          return;
        }
        if (showHelp) {
          setShowHelp(false);
          return;
        }
        if (selectedSession) {
          setSelectedSession(null);
          return;
        }
        if (selectedProject) {
          setSelectedProject(null);
          return;
        }
        if (selectedSessionIds.size > 0) {
          clearSelection();
          return;
        }
      }

      if (isTyping) return;

      if (e.key === "?") {
        e.preventDefault();
        setShowHelp((s) => !s);
        return;
      }

      if (e.key === ",") {
        e.preventDefault();
        setShowSettings((s) => !s);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setShowPalette((s) => !s);
        return;
      }

 if (e.key === "b" || e.key === "B") {
 e.preventDefault();
 setShowCircuits(true);
 return;
 }

 if ((e.ctrlKey || e.metaKey) && e.key === "\\") {
 e.preventDefault();
 setSidebarExpanded((s) => !s);
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
 // Keyboard shortcuts 1-4 map to COMMAND group items (OPS, Agents, Errors, Health)
 if (!isNaN(num) && num >= 1 && num <= 4 && SHORTCUT_MAP[num]) {
 e.preventDefault();
 setActiveTab(SHORTCUT_MAP[num]);
 }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showHelp, showSettings, showPalette, showCircuits, selectedSession, selectedProject, selectedSessionIds, activeTab, selectAll, clearSelection]);

  // Export
  const exportCSV = useCallback(() => {
    const rows = sessions.filter((s) => selectedSessionIds.has(s.id));
    const headers = ["id", "agent_id", "title", "status", "last_active", "tokens", "duration"];
    const csv = [
      headers.join(","),
      ...rows.map((r) => headers.map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(",")),
    ].join("\n");
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
    const rows = sessions.filter((s) => selectedSessionIds.has(s.id));
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sessions-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addToast({ title: "EXPORTED JSON", body: `${rows.length} session${rows.length === 1 ? "" : "s"} exported`, type: "success" });
  }, [sessions, selectedSessionIds, addToast]);

// ── Render helpers for tab content ──
  const renderSkills = () => {
    const grouped = {};
    skills.forEach((sk) => {
      const cat = sk.category || "Uncategorized";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(sk);
    });
    const categories = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));
    return (
      <div className="panel-content-list" style={{ gap: 12 }}>
        {categories.map(([cat, catSkills]) => (
          <div key={cat}>
            <div
              style={{
                fontFamily: FONTS.mono,
                fontSize: 9,
                color: "rgba(0,212,255,0.45)",
                letterSpacing: "0.12em",
                marginBottom: 6,
                paddingBottom: 4,
                borderBottom: "1px solid rgba(0,212,255,0.06)",
              }}
            >
              {cat.toUpperCase()} · {catSkills.length}
            </div>
            {catSkills.map((sk, i) => (
              <div
                key={sk.name}
                className="fade-up"
                style={{
                  animationDelay: `${i * 50}ms`,
                  padding: "10px 14px",
                  borderRadius: 6,
                  background: "rgba(0,212,255,0.03)",
                  border: "1px solid rgba(0,212,255,0.1)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 4,
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: "#00d4ff", letterSpacing: "0.06em" }}>{sk.name}</span>
                    <span
                      className="label-tag"
                      style={{
                        fontSize: 8,
                        background: `${sk.source === "plugin" ? "#a78bfa" : "#00d4ff"}15`,
                        color: sk.source === "plugin" ? "#a78bfa" : "#00d4ff",
                        border: `1px solid ${sk.source === "plugin" ? "#a78bfa" : "#00d4ff"}30`,
                      }}
                    >
                      {sk.source?.toUpperCase() || "LOCAL"}
                    </span>
                    {sk.trust && (
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          display: "inline-block",
                          background: sk.trust === "safe" ? "#00ff88" : sk.trust === "untrusted" ? "#ff4444" : "#f59e0b",
                        }}
                        title={`Trust: ${sk.trust}`}
                      />
                    )}
                  </div>
                </div>
                <span
                  className="label-tag"
                  style={{
                    background: sk.enabled ? "#00ff8812" : "transparent",
                    color: sk.enabled ? "#00ff88" : "rgba(150,180,220,0.3)",
                    border: `1px solid ${sk.enabled ? "#00ff8828" : "rgba(255,255,255,0.05)"}`,
                  }}
                >
                  {sk.enabled ? "ACTIVE" : "DISABLED"}
                </span>
              </div>
            ))}
          </div>
        ))}
{categories.length === 0 && (
    <div className="empty-state">
    No skills
    </div>
    )}
      </div>
    );
  };

 const renderTabContent = () => {
 const lazyFallback = <div className="empty-state">Loading panel…</div>;
 const wrap = (node) => <ErrorBoundary><Suspense fallback={lazyFallback}>{node}</Suspense></ErrorBoundary>;
 switch (activeTab) {
 case "overview":
 return wrap(<OverviewPanel agents={agents} />);
case "agents":
 return wrap(<AgentsPanel />);
case "tasks":
 return wrap(<TasksPanel />);
case "schedule":
 return wrap(<SchedulePanel />);
case "content":
 return wrap(<ContentPanel />);
case "sessions":
 return wrap(<SessionsPanel sessions={sessions} filteredSessions={filteredSessions} sessionFilter={sessionFilter} setSessionFilter={setSessionFilter} selectedSessionIds={selectedSessionIds} setSelectedSessionIds={setSelectedSessionIds} selectAll={selectAll} clearSelection={clearSelection} toggleSession={toggleSession} setSelectedSession={setSelectedSession} exportCSV={exportCSV} exportJSON={exportJSON} />);
 case "errors":
 return wrap(<ErrorsPanel errors={errors} />);
 case "skills":
 return renderSkills();
 case "search":
 return wrap(<SearchPanel />);
 case "briefing":
 return wrap(<BriefingPanel />);
 case "memory":
 return wrap(<MemoryPanel />);
 case "mailbox":
 return wrap(<TailscaleFeedPanel />);
 case "pipeline":
 return wrap(<PipelinePanel />);
 case "trends":
 return wrap(<TrendsPanel />);
 case "health":
 return wrap(<HealthScorePanel />);
 case "vault":
 return wrap(<VaultVitalsPanel />);
 case "cron":
 return wrap(<CronDashboardPanel />);
 case "trading":
 return wrap(<TradingPanel />);
 case "claude-code":
 return wrap(<ClaudeCodePanel />);
 case "chat":
 return wrap(<ChatPanel />);
case "ibcb":
 return wrap(<IBCBFeedPanel />);
 case "projects":
 return (
    <div className="panel-content-list">
 <div
 style={{
 fontFamily: FONTS.mono,
 fontSize: 9,
 color: "rgba(0,212,255,0.5)",
 letterSpacing: "0.16em",
 marginBottom: 8,
 }}
 >
 PROJECT BOARD · {projects.length} ACTIVE
 </div>
 <div className="projects-grid">
 {projects.map((p, i) => (
 <ProjectCard
 key={p.slug || i}
 p={p}
 idx={i}
 onClick={(proj) => {
 if (proj?.slug) markVisited(proj.slug);
 setSelectedProject(proj);
 }}
 delta={getDelta(p.slug, p.updated)}
 />
 ))}
 </div>
 {projects.length === 0 && (
<div className="empty-state">
			No projects
			</div>
 )}
 </div>
 );
 default:
        return wrap(<SessionsPanel sessions={sessions} filteredSessions={filteredSessions} sessionFilter={sessionFilter} setSessionFilter={setSessionFilter} selectedSessionIds={selectedSessionIds} setSelectedSessionIds={setSelectedSessionIds} selectAll={selectAll} clearSelection={clearSelection} toggleSession={toggleSession} setSelectedSession={setSelectedSession} exportCSV={exportCSV} exportJSON={exportJSON} />);
    }
  };

  return (
 <div className="app-root" data-theme={settings.theme}>
 <canvas ref={canvasRef} className="starfield-canvas" />
      <div className="grid-overlay" />

 <Layout
 topBar={
 <TopBar
 agents={agents}
 sseStatus={sseStatus}
 onReconnect={handleReconnect}
 onCircuits={handleCircuits}
 onSettings={handleSettings}
 />
 }
 sidebar={<Sidebar activeTab={activeTab} onTabChange={setActiveTab} onOpenPalette={() => setShowPalette(true)} expanded={sidebarExpanded} onToggleExpand={() => setSidebarExpanded((s) => !s)} errorCount={errors.length} agents={agents} />}
main={
<ContentCard style={{ flex: 1 }}>
{renderTabContent()}
</ContentCard>
}
      >
        {/* TOASTS */}
        <div className="toast-container">
          {toasts.map((t) => (
            <div key={t.id} className="toast-enter panel" style={{ padding: "10px 14px", minWidth: 220, maxWidth: 320, pointerEvents: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 4 }}>
                <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: t.type === "success" ? "#00ff88" : "#ff4444", letterSpacing: "0.1em" }}>
                  {t.title}
                </span>
                <button
                  onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
                  style={{ background: "transparent", border: "none", color: "rgba(150,180,220,0.4)", cursor: "pointer", fontSize: 10, lineHeight: 1 }}
                >
                  ✕
                </button>
              </div>
              {t.body && <div style={{ fontFamily: FONTS.sans, fontSize: 11, color: "rgba(200,230,255,0.75)", lineHeight: 1.3, marginBottom: 4 }}>{t.body}</div>}
              {t.sessionId && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(0,212,255,0.4)" }}>session: {t.sessionId}</span>
                  <button
                    onClick={() => navigator.clipboard.writeText(t.sessionId)}
                    style={{
                      fontFamily: FONTS.mono,
                      fontSize: 8,
                      color: "#00d4ff",
                      background: "rgba(0,212,255,0.08)",
                      border: "1px solid rgba(0,212,255,0.2)",
                      borderRadius: 3,
                      padding: "2px 6px",
                      cursor: "pointer",
                    }}
                  >
                    COPY ID
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* HELP OVERLAY */}
        {showHelp && (
<div className="modal-overlay" onClick={() => setShowHelp(false)}>
<div className="modal-backdrop" />
            <div className="panel fade-in" style={{ position: "relative", padding: "24px 28px", minWidth: 320, maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
              <div style={{ fontFamily: FONTS.mono, fontSize: 10, color: "#00d4ff", letterSpacing: "0.14em", marginBottom: 16 }}>
                KEYBOARD SHORTCUTS
              </div>
<div className="shortcuts-grid">
 <span style={{ fontFamily: FONTS.mono, color: "#00d4ff" }}>1–9</span>
 <span>Switch tabs (1-9)</span>
 <span style={{ fontFamily: FONTS.mono, color: "#00d4ff" }}>?</span>
 <span>Toggle this help</span>
 <span style={{ fontFamily: FONTS.mono, color: "#00d4ff" }}>Esc</span>
 <span>Close overlay / detail panel</span>
 <span style={{ fontFamily: FONTS.mono, color: "#00d4ff" }}>Ctrl+Enter</span>
 <span>Submit dispatch task</span>
 <span style={{ fontFamily: FONTS.mono, color: "#00d4ff" }}>,</span>
 <span>Open settings</span>
 <span style={{ fontFamily: FONTS.mono, color: "#00d4ff" }}>Ctrl+K</span>
 <span>Search / navigate (all tabs & items)</span>
 <span style={{ fontFamily: FONTS.mono, color: "#00d4ff" }}>B</span>
 <span>Open circuit breaker panel</span>
 <span style={{ fontFamily: FONTS.mono, color: "#00d4ff" }}>Ctrl+\</span>
 <span>Expand / collapse sidebar</span>
 <span style={{ fontFamily: FONTS.mono, color: "#00d4ff" }}>Ctrl+A</span>
 <span>Select all visible sessions</span>
              </div>
              <div style={{ marginTop: 16, textAlign: "center" }}>
                <button
                  onClick={() => setShowHelp(false)}
                  style={{
                    fontFamily: FONTS.mono,
                    fontSize: 9,
                    color: "rgba(0,212,255,0.6)",
                    background: "transparent",
                    border: "1px solid rgba(0,212,255,0.2)",
                    borderRadius: 4,
                    padding: "4px 12px",
                    cursor: "pointer",
                  }}
                >
                  CLOSE
                </button>
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
            allTabs={TABS}
            tabLabels={TAB_LABELS}
            groupColors={GROUP_COLORS}
            onNavigate={(action, item) => {
              setShowPalette(false);
              if (action === "tab") setActiveTab(item);
              if (action === "session") {
                setActiveTab("sessions");
                setSelectedSession(item);
              }
              if (action === "project") {
                setSelectedProject(item);
              }
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
      </Layout>
      <AlertTicker errors={errors} agents={agents} onAlertClick={(tabId) => setActiveTab(tabId)} />
    </div>
  );
}
