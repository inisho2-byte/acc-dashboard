import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import * as api from "../api.js";
import { FONTS, SEVERITY } from "../styles/theme.js";
import HealthCompass from "../components/HealthCompass";
import PanelLayout from "../components/PanelLayout";
import EmptyState from "../components/EmptyState";

// ── Agent accent colors (matching backend + TopBar) ──────────────────────
const AGENT_ACCENT = {
  arete:      "#A78BFA",
  scout:      "#7DD3FC",
  scribe:    "#F472B6",
  reach:      "#E879F9",
  dev:        "#A78BFA",
  shu:        "#A78BFA",
  "claude-code": "#F59E0B",
};

const AGENT_LABEL = {
  arete: "ORCHESTRATOR",
  scout: "SCOUT",
  scribe: "SCRIBE",
  reach: "REACH",
  dev: "DEV",
  shu: "SHU",
  "claude-code": "CLAUDE",
};

const AGENT_IDS_ORDER = ["arete", "scout", "scribe", "reach", "dev"];

// ── Utility ──────────────────────────────────────────────────────────────
function relativeTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  } catch { return ""; }
}

function formatNum(n) {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

// ── Radar SVG Component ───────────────────────────────────────────────────
function RadarDial({ agents, responseCounts }) {
  const total = Object.values(responseCounts).reduce((a, b) => a + b, 0) || 1;
  const dots = AGENT_IDS_ORDER.map((id, i) => {
    const pct = responseCounts[id] ? responseCounts[id] / total : 0;
    const angle = (i / AGENT_IDS_ORDER.length) * 2 * Math.PI - Math.PI / 2;
    const r = 14 + pct * 48; // min 14 (idle), max ~62
    const cx = 70 + r * Math.cos(angle);
    const cy = 70 + r * Math.sin(angle);
    const color = AGENT_ACCENT[id] || "#A78BFA";
    return { id, cx, cy, color, r };
  });

  return (
    <svg viewBox="0 0 140 140" width={180} height={180} style={{ flexShrink: 0 }}>
      <defs>
        <filter id="glow"><feGaussianBlur stdDeviation="2" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        <filter id="sweepGlow"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      {/* Concentric circles */}
      {[62, 46, 30, 14].map(r => <circle key={r} cx={70} cy={70} r={r} fill="none" stroke="rgba(0,212,255,0.06)" strokeWidth={0.5} />)}
      {/* Crosshairs */}
      <line x1={8} y1={70} x2={132} y2={70} stroke="rgba(0,212,255,0.04)" strokeWidth={0.5} />
      <line x1={70} y1={8} x2={70} y2={132} stroke="rgba(0,212,255,0.04)" strokeWidth={0.5} />
      {/* Sweep */}
      <g style={{ transformOrigin: "70px 70px", animation: "radarSweep 3s linear infinite" }}>
        <line x1={70} y1={70} x2={70} y2={8} stroke="rgba(0,212,255,0.6)" strokeWidth={1} filter="url(#sweepGlow)" />
        <circle cx={70} cy={8} r={2.5} fill="#00d4ff" filter="url(#sweepGlow)" />
      </g>
      {/* Agent dots */}
      {dots.map(d => {
        const agent = agents.find(a => a.id === d.id);
        const online = agent?.status === "online";
        return (
          <g key={d.id}>
            <circle cx={d.cx} cy={d.cy} r={d.r + 3} fill={d.color} opacity={online ? 0.12 : 0.04} />
            <circle cx={d.cx} cy={d.cy} r={d.r} fill={d.color} opacity={online ? 0.8 : 0.25} filter="url(#glow)" />
            <circle cx={d.cx} cy={d.cy} r={1.2} fill="#fff" opacity={online ? 0.9 : 0.2} />
          </g>
        );
      })}
      <style>{`@keyframes radarSweep { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}

// ── VPS Bar ─────────────────────────────────────────────────────────────
function VpsBar({ label, pct, usedStr, totalStr, gradient, warnThreshold = 70, dangerThreshold = 85 }) {
  const color = pct >= dangerThreshold ? "#ff4444" : pct >= warnThreshold ? "#f59e0b" : "rgba(0,212,255,0.8)";
  const barColor = pct >= dangerThreshold ? "linear-gradient(90deg, #ff444488, #ff4444)" : pct >= warnThreshold ? "linear-gradient(90deg, #f59e0b88, #f59e0b)" : gradient;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.5)", letterSpacing: "0.16em" }}>{label}</span>
        <span style={{ fontFamily: FONTS.mono, fontSize: 11, color, fontWeight: 700 }}>{Math.round(pct)}%</span>
      </div>
      <div style={{ width: "100%", height: 6, background: "rgba(255,255,255,0.04)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${Math.min(pct, 100)}%`, height: "100%", background: barColor, borderRadius: 3, transition: "width 0.8s ease" }} />
      </div>
      <div style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(150,180,220,0.35)", letterSpacing: "0.04em", textAlign: "right" }}>{usedStr} / {totalStr}</div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────
export default function OverviewPanel({ agents = [] }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [directiveIdx, setDirectiveIdx] = useState(0);
  const [ctxAgentIdx, setCtxAgentIdx] = useState(0);
  const [sparkData, setSparkData] = useState([]);
  const canvasRef = useRef(null);
  const ctxTimerRef = useRef(null);
  const dirTimerRef = useRef(null);

  // Fetch overview data every 8 seconds
  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      try {
        const d = await api.getOverview();
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

  // Directive ticker — cycle every 2.6s
  useEffect(() => {
    const activities = data?.activity || [];
    if (activities.length === 0) return;
    dirTimerRef.current = setInterval(() => {
      setDirectiveIdx(i => (i + 1) % Math.max(activities.length, 1));
    }, 2600);
    return () => clearInterval(dirTimerRef.current);
  }, [data?.activity?.length]);

  // Context window cycle — every 2.4s
  useEffect(() => {
    ctxTimerRef.current = setInterval(() => {
      setCtxAgentIdx(i => (i + 1) % AGENT_IDS_ORDER.length);
    }, 2400);
    return () => clearInterval(ctxTimerRef.current);
  }, []);

  // Sparkline data from activity_by_day
  useEffect(() => {
    if (data?.activity_by_day) {
      setSparkData(data.activity_by_day.map(d => d.total));
    }
  }, [data?.activity_by_day]);

  // Draw sparkline canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || sparkData.length === 0) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const max = Math.max(...sparkData, 1);
    const pts = sparkData.map((v, i) => ({
      x: (i / (sparkData.length - 1)) * W,
      y: H - (v / max) * (H - 8) - 4,
    }));

    // Fill
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, "rgba(167,139,250,0.15)");
    grad.addColorStop(1, "rgba(0,212,255,0.25)");
    ctx.beginPath();
    ctx.moveTo(pts[0].x, H);
    pts.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(pts[pts.length - 1].x, H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Stroke
    const strokeGrad = ctx.createLinearGradient(0, 0, W, 0);
    strokeGrad.addColorStop(0, "#a78bfa");
    strokeGrad.addColorStop(1, "#00d4ff");
    ctx.beginPath();
    pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.strokeStyle = strokeGrad;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Rightmost dot
    const last = pts[pts.length - 1];
    ctx.beginPath();
    ctx.arc(last.x, last.y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = "#00d4ff";
    ctx.fill();
  }, [sparkData]);

  const vps = data?.vps || {};
  const activity = data?.activity || [];
  const stats = data?.stats || {};
  const sessions = data?.sessions || {};
  const responseCounts = data?.response_counts || {};
  const totalResponses = stats.completed || 0;
  const currentDirective = activity[directiveIdx % Math.max(activity.length, 1)] || null;
  const ctxAgent = AGENT_IDS_ORDER[ctxAgentIdx % AGENT_IDS_ORDER.length];
  const ctxCount = responseCounts[ctxAgent] || 0;
  const ctxTotal = Math.max(totalResponses, 1);
  const ctxPct = ctxCount / ctxTotal;
  const ctxAgentData = (data?.agents || {})[ctxAgent] || {};
  const mostActiveDay = data ? [...(data.activity_by_day || [])].sort((a, b) => b.total - a.total)[0] : null;

  const panelStats = data ? [
    { label: "Sessions", value: sessions.count ?? "—" },
    { label: "Active Agents", value: data.online_agents ?? "—" },
    { label: "Errors", value: stats.failed ?? 0, color: (stats.failed ?? 0) > 0 ? SEVERITY.HIGH.color : undefined },
    { label: "VPS CPU", value: `${Math.round(vps.cpu_pct || 0)}%` },
    { label: "VPS RAM", value: `${Math.round(vps.mem_pct || 0)}%` },
  ] : [];

  const compassAgents = useMemo(() => {
    if (!agents || agents.length === 0) return [];
    return agents.map(a => {
      const s = (a.status || "").toLowerCase();
      let compassStatus = "unknown";
      let health = 25;
      if (s === "online" || s === "active" || s === "healthy" || s === "running") {
        compassStatus = "healthy";
        health = 100;
      } else if (s === "slow" || s === "warning" || s === "degraded") {
        compassStatus = "degraded";
        health = 50;
      } else if (s === "offline" || s === "down" || s === "error" || s === "crashed") {
        compassStatus = "down";
        health = 0;
      }
      return { id: a.id, status: compassStatus, health };
    });
  }, [agents]);

  // Footer stats
  const footerQueue = data?.kanban?.total || 0;
  const footerSessions = sessions.count || 0;
  const footerErrors = stats.failed || 0;
  const footerToday = mostActiveDay?.total || 0;
  const footerUptime = data?.gateway?.uptime_seconds ? `${Math.floor(data.gateway.uptime_seconds / 3600)}h ${Math.floor((data.gateway.uptime_seconds % 3600) / 60)}m` : "—";

  // Integrity
  const successRate = stats.success_rate || 100;
  const intPct = Math.floor(successRate);
  const intFrac = String(successRate.toFixed(2)).split(".")[1] || "00";
  const responsiveCount = data?.online_agents || 0;

  return (
    <PanelLayout
      title="OPS"
      icon="⊕"
      accentColor="#00d4ff"
      lastUpdated={lastUpdated}
      loading={loading}
      stats={panelStats}
    >
      {/* ── EYEBROW ──────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: -4 }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#00ff88", display: "inline-block", boxShadow: "0 0 6px #00ff8888" }} className="live-dot" />
        <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: "#00ff88", letterSpacing: "0.16em" }}>UPLINK SYNCED</span>
        <div style={{ width: 1, height: 14, background: "rgba(0,212,255,0.1)" }} />
        <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.4)", letterSpacing: "0.08em" }}>Hermes Orchestrator</span>
        <div style={{ width: 1, height: 14, background: "rgba(0,212,255,0.1)" }} />
        <span style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(150,180,220,0.25)" }}>v5.1</span>
      </div>

      {/* ── LIVE OPS CONSOLE ────────────────────────────────────────── */}
      <div className="panel" style={{ padding: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "180px 180px 1fr 1fr", gap: 32, minHeight: 220 }}>

          {/* LEFT — Radar */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <RadarDial agents={agents} responseCounts={responseCounts} />
          </div>

          {/* LEFT-CENTER — Health Compass */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <HealthCompass agents={compassAgents} />
          </div>

          {/* CENTER — Directive + Context Window */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.5)", letterSpacing: "0.16em" }}>CURRENT DIRECTIVE</div>
            <div style={{ minHeight: 30, display: "flex", alignItems: "flex-start" }}>
              <span style={{ fontFamily: FONTS.mono, fontSize: 13, color: "#00d4ff", lineHeight: 1.5, wordBreak: "break-word" }}>
                {currentDirective
                  ? <>{AGENT_LABEL[currentDirective.agent] || currentDirective.agent.toUpperCase()} · <span style={{ color: "rgba(200,230,255,0.8)" }}>{currentDirective.task || "Processing…"}</span></>
                  : <span style={{ color: "rgba(150,180,220,0.3)" }}>Awaiting directive…</span>}
              </span>
            </div>

            {/* Context Window */}
            <div style={{ borderTop: "1px solid rgba(0,212,255,0.08)", paddingTop: 12, marginTop: 4 }}>
              <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.4)", letterSpacing: "0.12em", marginBottom: 8 }}>CONTEXT WINDOW</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: AGENT_ACCENT[ctxAgent] || "#A78BFA", fontWeight: 700, letterSpacing: "0.06em" }}>{AGENT_LABEL[ctxAgent] || ctxAgent.toUpperCase()}</span>
                <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(200,230,255,0.5)" }}>{ctxCount} responses</span>
              </div>
              {/* Segment bar */}
              <div style={{ display: "flex", gap: 2 }}>
                {Array.from({ length: 16 }, (_, i) => {
                  const filled = i < Math.round(ctxPct * 16);
                  return <div key={i} style={{ flex: 1, height: 5, borderRadius: 1, background: filled ? AGENT_ACCENT[ctxAgent] || "#A78BFA" : "rgba(255,255,255,0.04)", opacity: filled ? (0.6 + 0.4 * Math.sin(Date.now() / 300 + i * 0.4)) : 1, animation: filled ? `segPulse 1.5s ease-in-out ${i * 0.1}s infinite` : "none" }} />;
                })}
              </div>
              <div style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(150,180,220,0.3)", marginTop: 4 }}>{ctxAgentData.status || "idle"}{ctxAgentData.model ? ` · ${ctxAgentData.model.slice(0, 25)}` : ""}</div>
            </div>
          </div>

          {/* RIGHT — VPS Health */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.5)", letterSpacing: "0.16em" }}>VPS HEALTH</div>
            <VpsBar label="CPU" pct={vps.cpu_pct || 0} usedStr={`${Math.round(vps.cpu_pct || 0)}%`} totalStr="100%" gradient="linear-gradient(90deg, rgba(0,212,255,0.3), rgba(167,139,250,0.5))" />
            <VpsBar label="RAM" pct={vps.mem_pct || 0} usedStr={`${vps.mem_used_mb || 0} MB`} totalStr={`${vps.mem_total_mb || 0} MB`} gradient="linear-gradient(90deg, rgba(167,139,250,0.3), rgba(244,114,182,0.5))" />
            <VpsBar label="DISK" pct={vps.disk_pct || 0} usedStr={`${vps.disk_used_gb || 0} GB`} totalStr={`${vps.disk_total_gb || 0} GB`} gradient="linear-gradient(90deg, rgba(0,255,136,0.3), rgba(0,212,255,0.5))" />

            {/* DB size */}
            <div style={{ borderTop: "1px solid rgba(0,212,255,0.06)", paddingTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(0,212,255,0.35)", letterSpacing: "0.12em" }}>HERMES DBs</span>
              <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: "#fbbf24", fontWeight: 600 }}>{(vps.db_size_mb || 0).toFixed(1)} MB</span>
            </div>
          </div>
        </div>

        {/* ── FOOTER STATS ───────────────────────────────────────────── */}
        <div style={{ borderTop: "1px solid rgba(0,212,255,0.06)", marginTop: 16, paddingTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr" }}>
          {[
            { label: "QUEUE", value: footerQueue },
            { label: "SESSIONS", value: footerSessions },
            { label: "ERRORS", value: footerErrors, color: footerErrors > 0 ? "#ff4444" : "#00ff88" },
            { label: "TODAY", value: footerToday },
            { label: "UPTIME", value: footerUptime },
          ].map((item, i) => (
            <div key={item.label} style={{ textAlign: "center", borderLeft: i > 0 ? "1px solid rgba(0,212,255,0.06)" : "none", paddingLeft: i > 0 ? 8 : 0 }}>
              <div style={{ fontFamily: FONTS.mono, fontSize: 18, fontWeight: 600, color: item.color || "rgba(200,230,255,0.85)" }}>{item.value}</div>
              <div style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(150,180,220,0.35)", letterSpacing: "0.1em", marginTop: 2 }}>{item.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── STATS STRIP ──────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 10 }}>
        {[
          { label: "INTEGRITY", top: <>{intPct}<span style={{ fontSize: "0.65em", opacity: 0.7 }}>.{intFrac}</span></>, sub: `${responsiveCount} of ${data.total_agents || 5} responsive`, border: "#00ff88", dotColor: "#00ff88" },
          { label: "AGENT CALLS", top: formatNum(totalResponses), sub: "responses total", border: "#00d4ff" },
          { label: "MESSAGES", top: formatNum(sessions.totals?.messages || 0), sub: "across sessions", border: "#a78bfa" },
          { label: "TOKENS IN", top: formatNum(sessions.totals?.input_tokens || 0), sub: "estimated", border: "#fbbf24" },
          { label: "CACHE HITS", top: formatNum(sessions.totals?.cache_read_tokens || 0), sub: "cached tokens", border: "#f472b6" },
        ].map(card => (
          <div key={card.label} className="panel" style={{ padding: "14px 12px", borderTop: `2px solid ${card.border}` }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: `clamp(24px, 2.4vw, 34px)`, fontWeight: 500, color: card.border, lineHeight: 1.2 }}>{card.top}</div>
            <div style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(150,180,220,0.4)", letterSpacing: "0.08em", marginTop: 4 }}>
              {card.dotColor && <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: card.dotColor, marginRight: 4, verticalAlign: "middle" }} className="live-dot" />}
              {card.sub}
            </div>
          </div>
        ))}
      </div>

      {/* ── BOTTOM SECTION: Throughput + Activity ──────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 10 }}>

        {/* Throughput */}
        <div className="panel" style={{ padding: 16 }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.5)", letterSpacing: "0.16em", marginBottom: 12 }}>THROUGHPUT</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
            <span style={{ fontFamily: FONTS.mono, fontSize: `clamp(34px, 4vw, 56px)`, fontWeight: 700, color: "#00d4ff", lineHeight: 1 }}>{formatNum(totalResponses)}</span>
            <span style={{ fontFamily: FONTS.mono, fontSize: 18, color: "rgba(200,230,255,0.35)" }}>responses total</span>
          </div>
          <canvas ref={canvasRef} width={320} height={100} style={{ width: "100%", height: 100 }} />
          <div style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(0,255,136,0.5)", letterSpacing: "0.06em", marginTop: 4 }}>
            Most active: {mostActiveDay?.date || "—"} ({mostActiveDay?.total || 0} sessions)
          </div>
        </div>

        {/* Activity Feed */}
        <div className="panel" style={{ padding: 16 }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.5)", letterSpacing: "0.16em", marginBottom: 12 }}>ACTIVITY</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflow: "hidden" }}>
            {activity.slice(0, 8).map((entry, i) => {
              const color = AGENT_ACCENT[entry.agent] || "#A78BFA";
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0", animation: i === 0 ? "fadeSlideIn 0.3s ease-out" : "none" }}>
                  <span style={{ fontFamily: FONTS.mono, fontSize: 8, background: `${color}18`, color, border: `1px solid ${color}30`, borderRadius: 3, padding: "1px 5px", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>{(entry.agent || "").toUpperCase()}</span>
                  <span style={{ flex: 1, fontFamily: FONTS.sans, fontSize: 11, color: "rgba(200,230,255,0.7)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.task || "Processing…"}</span>
                  <span style={{ fontFamily: FONTS.mono, fontSize: 7, color: entry.status === "completed" ? "#00ff88" : "#ff4444" }}>{entry.status === "completed" ? "●" : "✗"}</span>
                  <span style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(150,180,220,0.3)", whiteSpace: "nowrap" }}>{relativeTime(entry.timestamp)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </PanelLayout>
  );
}