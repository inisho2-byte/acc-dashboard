import { useState, useEffect } from "react";
import * as api from "../api.js";
import { FONTS } from "../styles/theme.js";

export default function HealthScorePanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchHealthScore = async () => {
      try {
        const res = await api.getHealthScore();
        if (!cancelled) setData(res);
      } catch {
        // Health score may be unavailable
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchHealthScore();
    const interval = setInterval(fetchHealthScore, 60000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const getScoreColor = (score) => {
    if (score <= 33) return "#ef4444";
    if (score <= 66) return "#f59e0b";
    return "#22c55e";
  };

  const renderProgressBar = (label, item) => {
    if (!item) return null;
    const { score, max, detail } = item;
    const pct = max > 0 ? score / max : 0;
    const fillColor = getScoreColor(Math.round(pct * 100));

    return (
      <div key={label} style={{ marginBottom: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
          <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(150,180,220,0.6)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {label}
          </span>
          <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: fillColor }}>
            {score}/{max}pts
          </span>
        </div>
        <div style={{ width: "100%", height: 6, background: "rgba(255,255,255,0.04)", borderRadius: 3, overflow: "hidden" }}>
          <div style={{ width: `${pct * 100}%`, height: "100%", background: fillColor, borderRadius: 3, transition: "width 0.5s ease" }} />
        </div>
        {detail && (
          <div style={{ fontFamily: FONTS.mono, fontSize: 7, color: "rgba(150,180,220,0.3)", marginTop: 2 }}>
            {detail}
          </div>
        )}
      </div>
    );
  };

  const severityColors = {
    critical: { border: "#ef4444", bg: "rgba(239,68,68,0.06)", text: "rgba(239,68,68,0.8)" },
    warning: { border: "#f59e0b", bg: "rgba(245,158,11,0.06)", text: "rgba(245,158,11,0.8)" },
    info: { border: "#00d4ff", bg: "rgba(0,212,255,0.06)", text: "rgba(0,212,255,0.8)" },
  };

  const score = data?.score ?? 0;
  const breakdown = data?.breakdown || {};
  const recommendations = data?.recommendations || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%" }}>
      <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.5)", letterSpacing: "0.16em" }}>
        HEALTH SCORE
      </div>

      {loading && !data && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: "rgba(150,180,220,0.3)" }}>Calculating health...</span>
        </div>
      )}

      {data && (
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Score display */}
          <div className="panel" style={{ padding: "16px 14px", textAlign: "center" }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 56, fontWeight: 700, color: getScoreColor(score), lineHeight: 1 }}>
              {score}
            </div>
            <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(150,180,220,0.4)", letterSpacing: "0.12em", marginTop: 4 }}>
              OUT OF 100
            </div>
            <div style={{ fontFamily: FONTS.mono, fontSize: 8, color: getScoreColor(score), marginTop: 6, padding: "3px 10px", borderRadius: 4, background: `${getScoreColor(score)}15`, border: `1px solid ${getScoreColor(score)}30`, display: "inline-block" }}>
              {score <= 33 ? "NEEDS ATTENTION" : score <= 66 ? "MODERATE" : "HEALTHY"}
            </div>
          </div>

          {/* Breakdown progress bars */}
          <div className="panel" style={{ padding: "12px 14px" }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.5)", letterSpacing: "0.14em", marginBottom: 10 }}>
              BREAKDOWN
            </div>
            {renderProgressBar("Sessions", breakdown.sessions)}
            {renderProgressBar("Errors", breakdown.errors)}
            {renderProgressBar("Projects", breakdown.projects)}
            {renderProgressBar("Skills", breakdown.skills)}
            {renderProgressBar("Vault", breakdown.vault)}
          </div>

          {/* Recommendations */}
          {recommendations.length > 0 && (
            <div className="panel" style={{ padding: "12px 14px" }}>
              <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.5)", letterSpacing: "0.14em", marginBottom: 10 }}>
                RECOMMENDATIONS · TOP 3
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {recommendations.slice(0, 3).map((rec, i) => {
                  const colors = severityColors[rec.severity] || severityColors.info;
                  return (
                    <div key={i} style={{ padding: "8px 10px", borderRadius: 6, background: colors.bg, borderLeft: `3px solid ${colors.border}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: colors.text, letterSpacing: "0.06em" }}>
                          {rec.severity?.toUpperCase()}
                        </span>
                        <span style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(150,180,220,0.35)" }}>
                          {rec.category}
                        </span>
                      </div>
                      <div style={{ fontFamily: FONTS.sans, fontSize: 11, color: "rgba(200,230,255,0.85)", marginTop: 3 }}>
                        {rec.message}
                      </div>
                      {rec.detail && (
                        <div style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(150,180,220,0.35)", marginTop: 2 }}>
                          {rec.detail}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {!loading && !data && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: "rgba(150,180,220,0.3)" }}>No health data available</span>
        </div>
      )}
    </div>
  );
}