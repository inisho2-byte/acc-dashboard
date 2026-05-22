import { useState, useEffect } from "react";
import * as api from "../api.js";
import { FONTS } from "../styles/theme.js";

export default function CronDashboardPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchCronDashboard = async () => {
      try {
        const res = await api.getCronDashboard();
        if (!cancelled) setData(res);
      } catch {
        // Cron dashboard may be unavailable
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchCronDashboard();
    const interval = setInterval(fetchCronDashboard, 60000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const statusMeta = {
    active: { color: "#22c55e", bg: "rgba(34,197,94,0.08)", border: "rgba(34,197,94,0.2)" },
    paused: { color: "#f59e0b", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.2)" },
    error: { color: "#ff4444", bg: "rgba(255,68,68,0.08)", border: "rgba(255,68,68,0.2)" },
  };

  const getSuccessColor = (rate) => {
    if (rate >= 80) return "#22c55e";
    if (rate >= 50) return "#f59e0b";
    return "#ff4444";
  };

  const formatTimestamp = (iso) => {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch {
      return iso;
    }
  };

  const renderJob = (job, i, total) => {
    const meta = statusMeta[job.status] || statusMeta.active;
    const successColor = getSuccessColor(job.success_rate ?? 0);

    return (
      <div key={job.id || i} style={{
        padding: "10px 12px",
        borderRadius: 6,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(0,212,255,0.06)",
        borderBottom: i < total - 1 ? "1px solid rgba(0,212,255,0.04)" : "none",
      }}>
        {/* Header: name + status badge */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontFamily: FONTS.sans, fontSize: 12, fontWeight: 600, color: "rgba(200,230,255,0.9)" }}>
            {job.name}
          </span>
          <span style={{
            fontFamily: FONTS.mono, fontSize: 8, letterSpacing: "0.08em",
            color: meta.color, padding: "2px 8px", borderRadius: 4,
            background: meta.bg, border: `1px solid ${meta.border}`,
          }}>
            {job.status?.toUpperCase()}
          </span>
        </div>

        {/* Schedule */}
        <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(150,180,220,0.45)", marginBottom: 6 }}>
          {job.schedule}
        </div>

        {/* Success rate bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <div style={{ flex: 1, height: 5, background: "rgba(255,255,255,0.04)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ width: `${job.success_rate ?? 0}%`, height: "100%", background: successColor, borderRadius: 3, transition: "width 0.4s ease" }} />
          </div>
          <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: successColor, flexShrink: 0 }}>
            {job.success_rate ?? 0}%
          </span>
        </div>

        {/* Recent executions */}
        {job.recent_executions && job.recent_executions.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 3, marginBottom: 6 }}>
            <span style={{ fontFamily: FONTS.mono, fontSize: 7, color: "rgba(150,180,220,0.3)", marginRight: 4 }}>LAST 7:</span>
            {job.recent_executions.slice(0, 7).map((exec, j) => {
              const ok = exec.status === "success" || exec === true;
              return (
                <span key={j} style={{ fontFamily: FONTS.mono, fontSize: 10, color: ok ? "#22c55e" : "#ff4444" }}>
                  {ok ? "✓" : "✗"}
                </span>
              );
            })}
          </div>
        )}

        {/* Next runs */}
        {job.next_runs && job.next_runs.length > 0 && (
          <div style={{ marginTop: 4 }}>
            <span style={{ fontFamily: FONTS.mono, fontSize: 7, color: "rgba(150,180,220,0.3)", marginRight: 6 }}>NEXT:</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 3 }}>
              {job.next_runs.slice(0, 6).map((run, j) => (
                <span key={j} style={{
                  fontFamily: FONTS.mono, fontSize: 8, color: "rgba(0,212,255,0.6)",
                  padding: "2px 6px", background: "rgba(0,212,255,0.04)", borderRadius: 3,
                  border: "1px solid rgba(0,212,255,0.08)",
                }}>
                  {formatTimestamp(run)}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Last run timestamp */}
        {job.last_run && (
          <div style={{ fontFamily: FONTS.mono, fontSize: 7, color: "rgba(150,180,220,0.25)", marginTop: 4 }}>
            Last: {formatTimestamp(job.last_run)}
          </div>
        )}
      </div>
    );
  };

  const jobs = data?.jobs || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.5)", letterSpacing: "0.16em" }}>
          CRON DASHBOARD
        </div>
        {data?.total !== undefined && (
          <span style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(150,180,220,0.35)" }}>
            {data.total} job{data.total !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {loading && !data && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: "rgba(150,180,220,0.3)" }}>Loading cron data...</span>
        </div>
      )}

      {data && (
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
          {jobs.map((job, i) => renderJob(job, i, jobs.length))}
          {jobs.length === 0 && (
            <div className="panel" style={{ padding: 20, textAlign: "center" }}>
              <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: "rgba(150,180,220,0.3)" }}>No cron jobs found</span>
            </div>
          )}
        </div>
      )}

      {!loading && !data && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: "rgba(150,180,220,0.3)" }}>No cron data available</span>
        </div>
      )}
    </div>
  );
}