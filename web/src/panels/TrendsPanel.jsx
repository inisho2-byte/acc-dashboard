import { useState, useEffect } from "react";
import * as api from "../api.js";
import { FONTS } from "../styles/theme.js";
import Sparkline from "../components/Sparkline.jsx";
import PanelLayout from "../components/PanelLayout";
import EmptyState from "../components/EmptyState";

export default function TrendsPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const fetchTrends = async () => {
      try {
        const res = await api.getTrends();
        if (!cancelled) {
          setData(res);
          setLastUpdated(new Date().toISOString());
        }
      } catch {
        // Trends may be unavailable
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchTrends();
    const interval = setInterval(fetchTrends, 60000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const renderBadge = (badge, delta) => {
    if (delta === null || delta === undefined) {
      return <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(150,180,220,0.35)", padding: "2px 6px", borderRadius: 4, background: "rgba(150,180,220,0.06)" }}>→ 0%</span>;
    }
    const isPos = delta > 0;
    const isNeg = delta < 0;
    const color = isPos ? "#00ff88" : isNeg ? "#ff4444" : "rgba(150,180,220,0.5)";
    const arrow = isPos ? "↑" : isNeg ? "↓" : "→";
    const bg = isPos ? "rgba(0,255,136,0.08)" : isNeg ? "rgba(255,68,68,0.08)" : "rgba(150,180,220,0.06)";
    const borderColor = isPos ? "rgba(0,255,136,0.2)" : isNeg ? "rgba(255,68,68,0.2)" : "rgba(150,180,220,0.1)";
    return (
      <span style={{ fontFamily: FONTS.mono, fontSize: 9, color, padding: "2px 6px", borderRadius: 4, background: bg, border: `1px solid ${borderColor}` }}>
        {arrow} {Math.abs(delta)}%
      </span>
    );
  };

  const renderSection = (label, sectionData, sparkColor) => {
    if (!sectionData) return null;
    const points = sectionData.points || [];
    const values = points.map(p => p.value);
    const delta = sectionData.delta;
    const badge = sectionData.badge;
    const current = values.length ? values[values.length - 1] : 0;
    const prev = values.length > 1 ? values[values.length - 2] : current;

    return (
      <div className="panel" style={{ padding: "12px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.5)", letterSpacing: "0.14em" }}>
            {label}
          </div>
          {renderBadge(badge, delta)}
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", gap: 16 }}>
          <div>
            <div style={{ fontFamily: FONTS.mono, fontSize: 28, fontWeight: 700, color: sparkColor, lineHeight: 1 }}>
              {current}
            </div>
            <div style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(150,180,220,0.35)", marginTop: 2 }}>
              {prev !== current && `prev: ${prev}`}
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <Sparkline data={values} color={sparkColor} width={200} height={32} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 4, marginTop: 8, overflowX: "auto" }}>
          {points.map((p, i) => (
            <div key={i} style={{ flex: 1, textAlign: "center", minWidth: 28 }}>
              <div style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(150,180,220,0.35)" }}>
                {p.date ? p.date.slice(5) : ""}
              </div>
              <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: sparkColor, fontWeight: 600 }}>
                {p.value}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderErrorBreakdown = (breakdown) => {
    if (!breakdown) return null;
    const entries = Object.entries(breakdown);
    const maxVal = Math.max(...entries.map(([, v]) => v), 1);
    const barColors = {
      discord_429: "#a78bfa",
      cli_timeout: "#f59e0b",
      connection_refused: "#ff4444",
      other: "rgba(150,180,220,0.5)",
    };

    return (
      <div style={{ marginTop: 10 }}>
        <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(255,68,68,0.5)", letterSpacing: "0.12em", marginBottom: 8 }}>
          ERROR BREAKDOWN
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {entries.map(([key, val]) => {
            const pct = val / maxVal;
            const color = barColors[key] || barColors.other;
            return (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(150,180,220,0.5)", width: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {key.replace(/_/g, " ")}
                </div>
                <div style={{ flex: 1, height: 8, background: "rgba(255,255,255,0.04)", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ width: `${pct * 100}%`, height: "100%", background: color, borderRadius: 4, opacity: 0.85 }} />
                </div>
                <div style={{ fontFamily: FONTS.mono, fontSize: 9, color, width: 28, textAlign: "right" }}>
                  {val}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const noData = !loading && !data;

  return (
    <PanelLayout
      title="TRENDS"
      icon="◢"
      accentColor="#a78bfa"
      subtitle="7-DAY"
      loading={loading && !data}
      lastUpdated={lastUpdated}
    >
      {noData && (
        <EmptyState
          icon="◢"
          title="No trend data"
          description="Trend data is currently unavailable"
        />
      )}
      {data && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {renderSection("SESSIONS", data.sessions, "#00d4ff")}

          <div className="panel" style={{ padding: "12px 14px" }}>
            {renderSection("ERRORS", data.errors, "#ff4444")}
            {renderErrorBreakdown(data.errors?.breakdown)}
          </div>
        </div>
      )}
    </PanelLayout>
  );
}