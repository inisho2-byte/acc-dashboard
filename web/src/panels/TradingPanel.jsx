import { useState, useEffect, useMemo } from "react";
import * as api from "../api";
import { FONTS, AGENT_COLORS } from "../styles/theme.js";
import PanelLayout from "../components/PanelLayout";
import EmptyState from "../components/EmptyState";

// ── Pair Extractor ──────────────────────────────────────────
function extractPairs(text) {
  const pairPatterns = [
    /\b(EUR\/USD|GBP\/USD|USD\/JPY|AUD\/USD|NZD\/USD|USD\/CAD|USD\/CHF|EUR\/GBP|EUR\/JPY)\b/gi,
    /\b(XAU\/USD|XAU)\b/gi,
    /\b(DXY)\b/gi,
  ];
  const seen = new Set();
  const pairs = [];
  for (const re of pairPatterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const symbol = m[1].toUpperCase();
      if (!seen.has(symbol)) {
        seen.add(symbol);
        pairs.push(symbol);
      }
    }
  }
  return pairs;
}

function extractAlertLevel(text) {
  if (/\b(EXTREME)\b/i.test(text) || text.includes("🔴")) return "extreme";
  if (/\b(WARNING)\b/i.test(text) || text.includes("🟡")) return "warning";
  return null;
}

// ── Formatting ──────────────────────────────────────────────
function formatTime(ts) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return ts;
  }
}

function timeAgo(ts) {
  if (!ts) return "";
  try {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch {
    return ts;
  }
}

const ALERT_COLORS = {
  extreme: { bg: "rgba(255,68,68,0.08)", border: "rgba(255,68,68,0.3)", text: "#ff6666", label: "EXTREME" },
  warning: { bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.3)", text: "#f59e0b", label: "WARNING" },
};

// ── Brief Card ──────────────────────────────────────────────
function BriefCard({ msg, idx }) {
  const pairs = extractPairs(msg.message);
  const preview = (msg.message || "").slice(0, 500);
  const lines = preview.split("\n");

  return (
    <div className="fade-up" style={{
      animationDelay: `${(idx % 10) * 60}ms`,
      padding: "12px 14px",
      borderRadius: 6,
      background: "rgba(0,212,255,0.03)",
      border: "1px solid rgba(0,212,255,0.12)",
      borderLeft: "3px solid rgba(0,212,255,0.4)",
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#00d4ff", display: "inline-block", flexShrink: 0 }} />
          <span style={{ fontFamily: FONTS.mono, fontSize: 9, fontWeight: 700, color: "#00d4ff", letterSpacing: "0.08em" }}>FOREX BRIEF</span>
          {pairs.length > 0 && pairs.slice(0, 5).map((p, i) => (
            <span key={i} style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(167,139,250,0.7)", background: "rgba(167,139,250,0.06)", border: "1px solid rgba(167,139,250,0.15)", borderRadius: 3, padding: "1px 5px" }}>{p}</span>
          ))}
        </div>
        <div style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(150,180,220,0.3)" }}>
          <div>{timeAgo(msg.received_at)}</div>
          <div style={{ fontSize: 7, marginTop: 1 }}>{formatTime(msg.received_at)}</div>
        </div>
      </div>

      {/* Content */}
      <div style={{ fontFamily: FONTS.sans, fontSize: 11, color: "rgba(200,230,255,0.7)", lineHeight: 1.45, wordBreak: "break-word", maxHeight: 200, overflowY: "auto" }}>
        {lines.map((line, i) => {
          if (line.startsWith("**") && line.endsWith("**")) {
            return <div key={i} style={{ fontWeight: 700, color: "rgba(200,230,255,0.9)", marginTop: i > 0 ? 4 : 0 }}>{line.replace(/\*\*/g, "")}</div>;
          }
          if (line.startsWith("# ")) {
            return <div key={i} style={{ fontWeight: 700, color: "#00d4ff", fontSize: 12, marginTop: i > 0 ? 6 : 0 }}>{line.replace(/^#+\s*/, "")}</div>;
          }
          if (/[🟡🔴🟢]/.test(line)) {
            return <div key={i} style={{ color: line.includes("🔴") ? "#ff6666" : line.includes("🟡") ? "#f59e0b" : "#00ff88", fontWeight: 600 }}>{line}</div>;
          }
          return <div key={i}>{line}</div>;
        })}
      </div>
    </div>
  );
}

// ── Spike Alert Card ────────────────────────────────────────
function SpikeCard({ msg, idx }) {
  const alertLevel = extractAlertLevel(msg.message);
  const alertMeta = alertLevel ? ALERT_COLORS[alertLevel] : null;
  const pairs = extractPairs(msg.message);

  return (
    <div className="fade-up" style={{
      animationDelay: `${(idx % 10) * 60}ms`,
      padding: "10px 12px",
      borderRadius: 6,
      background: alertMeta ? alertMeta.bg : "rgba(255,255,255,0.02)",
      border: `1px solid ${alertMeta ? alertMeta.border : "rgba(0,212,255,0.06)"}`,
      borderLeft: `3px solid ${alertMeta ? alertMeta.text : "rgba(245,158,11,0.4)"}`,
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: alertMeta ? alertMeta.text : "#f59e0b", display: "inline-block", flexShrink: 0 }} />
          <span style={{ fontFamily: FONTS.mono, fontSize: 9, fontWeight: 700, color: alertMeta ? alertMeta.text : "#f59e0b", letterSpacing: "0.08em" }}>EUR/USD SCANNER</span>
          {alertMeta && (
            <span style={{ fontFamily: FONTS.mono, fontSize: 8, letterSpacing: "0.08em", padding: "1px 6px", borderRadius: 3, background: alertMeta.bg, border: `1px solid ${alertMeta.border}`, color: alertMeta.text, fontWeight: 600 }}>{alertMeta.label}</span>
          )}
        </div>
        <div style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(150,180,220,0.3)", textAlign: "right" }}>
          <div>{timeAgo(msg.received_at)}</div>
          <div style={{ fontSize: 7, marginTop: 1 }}>{formatTime(msg.received_at)}</div>
        </div>
      </div>

      {/* Pairs */}
      {pairs.length > 0 && (
        <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginBottom: 5 }}>
          {pairs.map((p, i) => (
            <span key={i} style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(167,139,250,0.7)", background: "rgba(167,139,250,0.06)", border: "1px solid rgba(167,139,250,0.15)", borderRadius: 3, padding: "1px 5px" }}>{p}</span>
          ))}
        </div>
      )}

      {/* Content */}
      <div style={{ fontFamily: FONTS.sans, fontSize: 11, color: "rgba(200,230,255,0.75)", lineHeight: 1.4, wordBreak: "break-word", maxHeight: 120, overflowY: "auto" }}>
        {(msg.message || "").split("\n").map((line, i) => {
          if (/[🟡🔴🟢]/.test(line)) {
            return <div key={i} style={{ color: line.includes("🔴") ? "#ff6666" : line.includes("🟡") ? "#f59e0b" : "#00ff88", fontWeight: 600 }}>{line}</div>;
          }
          return <div key={i}>{line}</div>;
        })}
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────
export default function TradingPanel() {
  const [messages, setMessages] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeSection, setActiveSection] = useState("all");
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const msgs = await api.getTrading(100);
      if (!cancelled) {
        if (msgs) {
          setMessages(msgs);
          setError(false);
          setLastUpdated(Date.now());
        } else if (messages === null) {
          setError(true);
        }
        setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 60000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const briefs = useMemo(() => (messages || []).filter(m => m.msg_type === "brief"), [messages]);
  const spikes = useMemo(() => (messages || []).filter(m => m.msg_type === "spike"), [messages]);
  const allAlerts = useMemo(() => {
    const result = [];
    for (const msg of spikes) {
      const level = extractAlertLevel(msg.message);
      if (level) result.push({ level, message: msg.message, symbol: extractPairs(msg.message)[0] || "EUR/USD", time: msg.received_at });
    }
    return result;
  }, [spikes]);

  const allPairs = useMemo(() => {
    const set = new Set();
    for (const msg of (messages || [])) {
      for (const p of extractPairs(msg.message)) set.add(p);
    }
    return [...set];
  }, [messages]);

  const hasData = (messages || []).length > 0;

  // Filtered display
  const displayMessages = useMemo(() => {
    if (activeSection === "briefs") return briefs;
    if (activeSection === "spikes") return spikes;
    return messages || [];
  }, [activeSection, briefs, spikes, messages]);

  // Build stats for PanelLayout header strip
  const stats = hasData ? [
    { label: "Briefs", value: briefs.length },
    { label: "Spikes", value: spikes.length },
    { label: "Pairs", value: allPairs.length },
  ] : [];

  return (
    <PanelLayout
      title="TRADING"
      icon="⧫"
      accentColor="#34d399"
      loading={loading && !messages}
      lastUpdated={lastUpdated}
      stats={stats}
    >
      {hasData ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%" }}>
          {/* Section tabs */}
          <div style={{ display: "flex", gap: 2 }}>
            {[
              { key: "all", label: "ALL" },
              { key: "briefs", label: "BRIEFS" },
              { key: "spikes", label: "SPIKES" },
            ].map(tab => (
              <button key={tab.key} onClick={() => setActiveSection(tab.key)} style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: "0.1em", padding: "4px 10px", borderRadius: 4, border: `1px solid ${activeSection === tab.key ? "rgba(0,212,255,0.4)" : "rgba(0,212,255,0.1)"}`, background: activeSection === tab.key ? "rgba(0,212,255,0.12)" : "transparent", color: activeSection === tab.key ? "#00d4ff" : "rgba(0,212,255,0.4)", cursor: "pointer", transition: "all 0.15s" }}>{tab.label}</button>
            ))}
          </div>

          {/* Message feed */}
          {displayMessages.length > 0 && (
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
              {displayMessages.map((msg, i) => {
                if (msg.msg_type === "spike") return <SpikeCard key={msg.id || `s-${i}`} msg={msg} idx={i} />;
                return <BriefCard key={msg.id || `b-${i}`} msg={msg} idx={i} />;
              })}
            </div>
          )}
          {displayMessages.length === 0 && (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: "rgba(150,180,220,0.3)" }}>No {activeSection === "briefs" ? "briefs" : activeSection === "spikes" ? "spike alerts" : "messages"} in this category</span>
            </div>
          )}
        </div>
      ) : !loading ? (
        <EmptyState
          icon="⧫"
          title={error ? "Failed to load trading feed" : "No trading data yet"}
          description={error ? "Check your connection and try again." : "Forex briefs arrive hourly. Spike alerts trigger every 5 minutes."}
        />
      ) : null}
    </PanelLayout>
  );
}