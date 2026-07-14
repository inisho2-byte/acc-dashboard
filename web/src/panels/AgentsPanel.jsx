import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import * as api from "../api.js";
import { FONTS } from "../styles/theme.js";
import PanelLayout from "../components/PanelLayout";
import EmptyState from "../components/EmptyState";

const AGENT_ORDER = ["arete", "scout", "scribe", "reach", "dev"];

const DONUT_COLORS = {
  arete: "#A78BFA",
  scout: "#7DD3FC",
  scribe: "#F472B6",
  reach: "#FBBF24",
  dev: "#E879F9",
};

const DONUT_NAMES = {
  arete: "Orchestrator",
  scout: "Scout",
  scribe: "Scribe",
  reach: "Reach",
  dev: "Dev",
};

const STATUS_DOT = {
  active:  { color: "#00ff88", label: "Active" },
  idle:    { color: "#f59e0b", label: "Idle" },
  dormant: { color: "rgba(150,180,220,0.25)", label: "Dormant" },
};

const STATUS_SUMMARY_COLORS = {
  active:  "#00ff88",
  idle:    "#f59e0b",
  dormant: "rgba(150,180,220,0.4)",
};

function relativeTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  } catch { return "—"; }
}

function MiniBarChart({ data, accent }) {
  const max = Math.max(...data.map(d => d.count), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 32, marginTop: 4 }}>
      {data.map((d, i) => {
        const h = Math.max(2, (d.count / max) * 32);
        return (
          <div key={i} style={{
            width: 8,
            height: h,
            background: d.count > 0 ? accent : "rgba(255,255,255,0.06)",
            opacity: d.count > 0 ? 0.85 : 1,
            borderRadius: 1,
            transition: "height 0.4s ease",
          }} />
        );
      })}
    </div>
  );
}

function AgentCard({ agent, totalResponses }) {
  const st = STATUS_DOT[agent.status_class] || STATUS_DOT.dormant;
  const accent = agent.accent;
  const loadPct = totalResponses > 0 ? (agent.responses / totalResponses * 100) : 0;
  const successColor = agent.success_rate >= 100 ? "#00ff88" : agent.success_rate >= 80 ? "#f59e0b" : "#ff4444";

  return (
    <div className="panel" style={{ padding: 16, borderTop: `2px solid ${accent}`, display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Top row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{
          fontFamily: FONTS.mono, fontSize: 9, letterSpacing: "0.08em",
          background: `${accent}15`, color: accent, border: `1px solid ${accent}30`,
          borderRadius: 3, padding: "2px 6px",
        }}>{agent.code}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            fontFamily: FONTS.mono, fontSize: 8, letterSpacing: "0.06em",
            background: agent.platform === "Telegram" ? "rgba(167,139,250,0.12)" : "rgba(0,212,255,0.1)",
            color: agent.platform === "Telegram" ? "#a78bfa" : "#00d4ff",
            border: `1px solid ${agent.platform === "Telegram" ? "rgba(167,139,250,0.25)" : "rgba(0,212,255,0.2)"}`,
            borderRadius: 3, padding: "1px 5px",
          }}>{agent.platform}</span>
          <span className={agent.status_class === "active" ? "live-dot" : ""} style={{
            width: 6, height: 6, borderRadius: "50%",
            background: st.color,
            boxShadow: agent.status_class === "active" ? `0 0 6px ${st.color}88` : "none",
            display: "inline-block",
          }} />
        </div>
      </div>

      {/* Name */}
      <div style={{ fontFamily: "'Inter Tight', 'Inter', sans-serif", fontSize: 22, fontWeight: 600, color: "rgba(200,230,255,0.9)", lineHeight: 1.2 }}>{agent.name}</div>

      {/* Role */}
      <div style={{ fontFamily: FONTS.sans, fontSize: 12, color: "rgba(150,180,220,0.5)", lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", minHeight: 34 }}>{agent.role}</div>

      {/* 7-day activity */}
      <div style={{ borderTop: "1px solid rgba(0,212,255,0.06)", paddingTop: 8 }}>
        <div style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(0,212,255,0.4)", letterSpacing: "0.12em", marginBottom: 2 }}>7-DAY ACTIVITY</div>
        <MiniBarChart data={agent.activity_7d || []} accent={accent} />
      </div>

      {/* Stats row */}
      <div style={{ display: "flex", gap: 4, alignItems: "baseline" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 18, fontWeight: 600, color: accent, lineHeight: 1 }}>{agent.responses}</div>
          <div style={{ fontFamily: FONTS.mono, fontSize: 7, color: "rgba(150,180,220,0.35)", letterSpacing: "0.06em" }}>RESP</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 18, fontWeight: 600, color: successColor, lineHeight: 1 }}>{agent.success_rate}%</div>
          <div style={{ fontFamily: FONTS.mono, fontSize: 7, color: "rgba(150,180,220,0.35)", letterSpacing: "0.06em" }}>SUCCESS</div>
        </div>
        <div style={{ flex: 1.3 }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 10, color: "rgba(150,180,220,0.45)", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(agent.model || "").slice(0, 22)}</div>
          <div style={{ fontFamily: FONTS.mono, fontSize: 7, color: "rgba(150,180,220,0.35)", letterSpacing: "0.06em" }}>MODEL</div>
        </div>
      </div>

      {/* Load bar */}
      <div style={{ width: "100%", height: 3, background: "rgba(255,255,255,0.04)", borderRadius: 1.5, overflow: "hidden" }}>
        <div style={{ width: `${Math.max(loadPct, 1)}%`, height: "100%", background: accent, borderRadius: 1.5, transition: "width 0.6s ease" }} />
      </div>

      {/* Last task */}
      {agent.last_task && (
        <div style={{ marginTop: 2 }}>
          <div style={{ fontFamily: FONTS.sans, fontSize: 11, color: "rgba(200,230,255,0.55)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            ↳ {agent.last_task}
          </div>
          <div style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(150,180,220,0.3)", marginTop: 2 }}>
            {relativeTime(agent.last_task_time)}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, barColor, barPct }) {
  return (
    <div className="panel" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: "0.14em", color: "rgba(150,180,220,0.45)" }}>{label}</div>
      <div style={{ fontFamily: "'Inter Tight', 'Inter', sans-serif", fontSize: 36, fontWeight: 700, color: "rgba(244,244,248,0.95)", lineHeight: 1 }}>{value}</div>
      <div style={{ width: "100%", height: 2, background: "rgba(255,255,255,0.05)", borderRadius: 1, marginTop: "auto", overflow: "hidden" }}>
        <div style={{ width: `${Math.min(Math.max(barPct, 0), 100)}%`, height: "100%", background: barColor, borderRadius: 1, transition: "width 0.8s ease" }} />
      </div>
    </div>
  );
}

function DonutChart({ agents }) {
  const canvasRef = useRef(null);
  const total = useMemo(() => agents.reduce((s, a) => s + (a.responses || 0), 0), [agents]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = 130, H = 130;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const cx = W / 2, cy = H / 2;
    const outerR = 52, innerR = 32;

    if (total === 0) {
      // Placeholder faint circle
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
      ctx.arc(cx, cy, innerR, 0, Math.PI * 2, true);
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.fill();
    } else {
      let startAngle = -Math.PI / 2;
      for (const a of agents) {
        const count = a.responses || 0;
        if (count === 0) continue;
        const sliceAngle = (count / total) * Math.PI * 2;
        const endAngle = startAngle + sliceAngle;

        ctx.beginPath();
        ctx.arc(cx, cy, outerR, startAngle, endAngle);
        ctx.arc(cx, cy, innerR, endAngle, startAngle, true);
        ctx.closePath();
        ctx.fillStyle = DONUT_COLORS[a.id] || "#A78BFA";
        ctx.fill();

        startAngle = endAngle;
      }
    }

    // Center text
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "700 18px 'Inter Tight', 'Inter', sans-serif";
    ctx.fillStyle = "#F4F4F8";
    ctx.fillText(String(total), cx, cy - 6);
    ctx.font = "500 10px 'Space Mono', monospace";
    ctx.fillStyle = "rgba(244,244,248,0.5)";
    ctx.fillText("TOTAL", cx, cy + 10);
  }, [agents, total]);

  useEffect(() => { draw(); }, [draw]);

  return (
    <div className="panel" style={{ padding: 14, display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.5)", letterSpacing: "0.12em", alignSelf: "flex-start", marginBottom: 8 }}>TASK DISTRIBUTION</div>
      <canvas ref={canvasRef} style={{ width: 130, height: 130 }} />
      {/* Legend */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%", marginTop: 10 }}>
        {agents.map(a => {
          const pct = total > 0 ? Math.round((a.responses || 0) / total * 100) : 0;
          return (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: DONUT_COLORS[a.id] || "#A78BFA", flexShrink: 0 }} />
              <span style={{ fontFamily: FONTS.sans, fontSize: 11, color: "rgba(200,230,255,0.7)", flex: 1 }}>{DONUT_NAMES[a.id]}</span>
              <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: "rgba(150,180,220,0.4)", textAlign: "right" }}>{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function AgentsPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [filter, setFilter] = useState("ALL");

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      try {
        const d = await api.getAgents();
        if (!cancelled) {
          setData(d);
          setLastUpdated(new Date().toISOString());
          setLoading(false);
        }
      } catch { /* retry next cycle */ }
    };
    fetch();
    const interval = setInterval(fetch, 8000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const agents = useMemo(() => {
    if (!data?.agents) return [];
    return AGENT_ORDER.map(id => data.agents[id]).filter(Boolean);
  }, [data]);

  const totalResponses = useMemo(() => agents.reduce((s, a) => s + (a.responses || 0), 0), [agents]);

  const filteredLog = useMemo(() => {
    if (!data?.log) return [];
    if (filter === "ALL") return data.log.slice(0, 50);
    return data.log.filter(e => e.agent === filter).slice(0, 50);
  }, [data, filter]);

  // ── Statistics derived data ──────────────────────────────────────────
  const activityByDay = data?.activity_by_day || [];
  const stats = data?.stats || {};

  const tasksToday = activityByDay.length > 0 ? (activityByDay[activityByDay.length - 1]?.total || 0) : 0;
  const tasksWeek = activityByDay.reduce((s, d) => s + (d.total || 0), 0);

  // Most active agent this week
  const mostActive = useMemo(() => {
    if (!data?.agents) return { name: "—", accent: "#A78BFA", count: 0 };
    let maxAgent = null;
    let maxCount = 0;
    for (const a of agents) {
      if ((a.responses || 0) > maxCount) {
        maxCount = a.responses || 0;
        maxAgent = a;
      }
    }
    return maxAgent ? { name: maxAgent.name, accent: maxAgent.accent, count: maxCount } : { name: "—", accent: "#A78BFA", count: 0 };
  }, [agents]);

  const successRate = stats.total > 0 ? Math.round((stats.completed || 0) / stats.total * 100) : 100;
  const successBarColor = successRate >= 90 ? "#00ff88" : successRate >= 70 ? "#f59e0b" : "#ff4444";

  if (!data) {
    return (
      <PanelLayout
        title="AGENTS"
        icon="⬡"
        accentColor="#00d4ff"
        loading={loading}
      >
        <EmptyState icon="⬡" title="No agents yet" description="Waiting for agent data to load..." />
      </PanelLayout>
    );
  }

  const summary = data.status_summary || { active: 0, idle: 0, dormant: 0 };

  const panelStats = [
    { label: "Active", value: summary.active },
    { label: "Idle", value: summary.idle },
    { label: "Dormant", value: summary.dormant },
  ];

  return (
    <PanelLayout
      title="AGENTS"
      icon="⬡"
      accentColor="#00d4ff"
      lastUpdated={lastUpdated}
      loading={false}
      stats={panelStats}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── HEADER ────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
        <div>
          <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.5)", letterSpacing: "0.16em", marginBottom: 4 }}>SUBAGENTS</div>
          <div style={{ fontFamily: "'Inter Tight', 'Inter', sans-serif", fontSize: "clamp(36px, 4vw, 60px)", fontWeight: 500, color: "rgba(200,230,255,0.85)", letterSpacing: "-0.02em", lineHeight: 1.1 }}>The collective.</div>
        </div>
        {/* Status summary card */}
        <div className="panel" style={{ padding: "10px 0", display: "flex", minWidth: 240 }}>
          {[
            { label: "Active", count: summary.active, color: STATUS_SUMMARY_COLORS.active },
            { label: "Idle", count: summary.idle, color: STATUS_SUMMARY_COLORS.idle },
            { label: "Dormant", count: summary.dormant, color: STATUS_SUMMARY_COLORS.dormant },
          ].map((s, i) => (
            <div key={s.label} style={{
              flex: 1, textAlign: "center",
              borderLeft: i > 0 ? "1px solid rgba(0,212,255,0.06)" : "none",
              paddingLeft: i > 0 ? 12 : 0,
            }}>
              <div style={{ fontFamily: FONTS.mono, fontSize: 8, color: `${s.color}88`, letterSpacing: "0.08em" }}>{s.label.toUpperCase()}</div>
              <div style={{ fontFamily: FONTS.mono, fontSize: 28, fontWeight: 600, color: s.color, lineHeight: 1.2, marginTop: 2 }}>{s.count}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── AGENT CARDS ───────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
        {agents.map(a => <AgentCard key={a.id} agent={a} totalResponses={totalResponses} />)}
      </div>

      {/* ── AGENT STATISTICS ──────────────────────────────────────────── */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
          <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.45)", letterSpacing: "0.12em" }}>▦</span>
          <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.5)", letterSpacing: "0.16em" }}>AGENT STATISTICS</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 10 }}>
          {/* Stat cards — 2×2 grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <StatCard label="TASKS TODAY" value={tasksToday} barColor="#f59e0b" barPct={100} />
            <StatCard label="TASKS THIS WEEK" value={tasksWeek} barColor="#00d4ff" barPct={100} />
            <StatCard label={mostActive.name ? `MOST ACTIVE` : "MOST ACTIVE"} value={mostActive.name} barColor={mostActive.accent} barPct={tasksWeek > 0 ? Math.round(mostActive.count / tasksWeek * 100) : 0} />
            <StatCard label="SUCCESS RATE" value={`${successRate}%`} barColor={successBarColor} barPct={successRate} />
          </div>
          {/* Donut chart */}
          <DonutChart agents={agents} />
        </div>
      </div>

      {/* ── AGENT LOG ─────────────────────────────────────────────────── */}
      <div className="panel" style={{ padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: "rgba(0,212,255,0.7)", letterSpacing: "0.12em" }}>Agent Logs</div>
          <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(150,180,220,0.35)" }}>{data.log?.length || 0} entries</div>
        </div>

        {/* Filter pills */}
        <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
          <button onClick={() => setFilter("ALL")} style={filterPillStyle(filter === "ALL")}>ALL</button>
          {AGENT_ORDER.map(id => {
            const a = data.agents[id];
            if (!a) return null;
            return <button key={id} onClick={() => setFilter(id)} style={filterPillStyle(filter === id, a.accent)}>{a.code}</button>;
          })}
        </div>

        {/* Table header */}
        <div style={{ display: "grid", gridTemplateColumns: "70px 65px 1fr 100px 70px", gap: 8, borderBottom: "1px solid rgba(0,212,255,0.08)", paddingBottom: 6, marginBottom: 4 }}>
          {["Time", "Agent", "Task", "Model", "Status"].map(h => (
            <div key={h} style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(0,212,255,0.4)", letterSpacing: "0.1em" }}>{h.toUpperCase()}</div>
          ))}
        </div>

        {/* Log rows */}
        <div style={{ maxHeight: 420, overflowY: "auto" }} className="panel-scroll">
          {filteredLog.map((entry, i) => {
            const accent = data.agents[entry.agent]?.accent || "#A78BFA";
            const model = data.agents[entry.agent]?.model || "";
            return (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "70px 65px 1fr 100px 70px", gap: 8, padding: "5px 0", borderBottom: "1px solid rgba(0,212,255,0.03)", alignItems: "center" }}>
                <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(150,180,220,0.35)" }}>{relativeTime(entry.timestamp)}</div>
                <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: accent, fontWeight: 600, letterSpacing: "0.04em" }}>{(entry.agent || "").toUpperCase()}</div>
                <div style={{ fontFamily: FONTS.sans, fontSize: 11, color: "rgba(200,230,255,0.65)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.task || "Processing…"}</div>
                <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(150,180,220,0.3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{model.slice(0, 18)}</div>
                <div>
                  <span style={{
                    fontFamily: FONTS.mono, fontSize: 8, letterSpacing: "0.06em",
                    background: entry.status === "completed" ? "rgba(0,255,136,0.1)" : "rgba(255,68,68,0.1)",
                    color: entry.status === "completed" ? "#00ff88" : "#ff4444",
                    border: `1px solid ${entry.status === "completed" ? "rgba(0,255,136,0.2)" : "rgba(255,68,68,0.2)"}`,
                    borderRadius: 3, padding: "1px 5px",
                  }}>{entry.status === "completed" ? "DONE" : "FAIL"}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
    </PanelLayout>
  );
}

function filterPillStyle(active, accent) {
  const base = {
    fontFamily: FONTS.mono,
    fontSize: 9,
    letterSpacing: "0.08em",
    padding: "3px 10px",
    borderRadius: 4,
    border: "1px solid rgba(0,212,255,0.08)",
    cursor: "pointer",
    transition: "all 0.15s ease",
    background: active ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.02)",
    color: active ? (accent || "rgba(200,230,255,0.85)") : "rgba(150,180,220,0.4)",
  };
  return base;
}