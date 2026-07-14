import { useState, useEffect, useMemo } from "react";
import * as api from "../api.js";
import { FONTS } from "../styles/theme.js";
import PanelLayout from "../components/PanelLayout";
import EmptyState from "../components/EmptyState";

function relativeTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diffMs = d.getTime() - now;
    if (diffMs <= 0) return "now";
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);
    if (diffMin < 60) return `in ${diffMin}m`;
    if (diffHr < 24) {
      const mins = diffMin % 60;
      return mins > 0 ? `in ${diffHr}h ${mins}m` : `in ${diffHr}h`;
    }
    const hr = d.getHours().toString().padStart(2, "0");
    const mn = d.getMinutes().toString().padStart(2, "0");
    return `tomorrow ${hr}:${mn}`;
  } catch { return "—"; }
}

function JobCard({ job }) {
  const isHermes = job.owner === "hermes";
  const badgeBg = isHermes ? "rgba(167,139,250,0.1)" : "rgba(150,180,220,0.06)";
  const badgeColor = isHermes ? "#a78bfa" : "rgba(150,180,220,0.4)";
  const badgeBorder = isHermes ? "rgba(167,139,250,0.25)" : "rgba(150,180,220,0.12)";

  return (
    <div className="panel" style={{ padding: 14, position: "relative" }}>
      {/* Owner badge */}
      <div style={{ position: "absolute", top: 10, right: 12 }}>
        <span style={{
          fontFamily: FONTS.mono, fontSize: 8, letterSpacing: "0.08em",
          background: badgeBg, color: badgeColor, border: `1px solid ${badgeBorder}`,
          borderRadius: 3, padding: "2px 7px", textTransform: "uppercase",
        }}>{job.owner}</span>
      </div>

      {/* Command */}
      <div style={{
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: 13,
        color: "rgba(200,230,255,0.85)", marginBottom: 8, paddingRight: 70,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }} title={job.command}>{job.command}</div>

      {/* Schedule + Next run */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 6 }}>
        <div>
          <div style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(0,212,255,0.4)", letterSpacing: "0.1em", marginBottom: 2 }}>SCHEDULE</div>
          <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: "rgba(200,230,255,0.7)" }}>{job.schedule}</div>
        </div>
        <div>
          <div style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(0,212,255,0.4)", letterSpacing: "0.1em", marginBottom: 2 }}>NEXT RUN</div>
          <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: "rgba(0,212,255,0.7)" }}>{job.next_run ? relativeTime(job.next_run) : "—"}</div>
        </div>
      </div>

      {/* Description */}
      {job.description && (
        <div style={{ fontFamily: FONTS.sans, fontSize: 12, color: "rgba(150,180,220,0.4)", marginBottom: 4 }}>{job.description}</div>
      )}

      {/* Source path */}
      <div style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(150,180,220,0.2)", letterSpacing: "0.02em" }}>{job.source}</div>
    </div>
  );
}

function JobSection({ label, jobs, emptyText }) {
  return (
    <div>
      <div style={{ fontFamily: FONTS.mono, fontSize: 10, color: "rgba(0,212,255,0.5)", letterSpacing: "0.14em", marginBottom: 10 }}>{label}</div>
      {jobs.length === 0 ? (
        <EmptyState icon="◴" title="No jobs" description={emptyText} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {jobs.map((job, i) => <JobCard key={`${job.source}-${job.schedule}-${i}`} job={job} />)}
        </div>
      )}
    </div>
  );
}

export default function SchedulePanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      try {
        const d = await api.getSchedule();
        if (!cancelled) {
          setData(d);
          setLastUpdated(new Date().toISOString());
          setLoading(false);
        }
      } catch { /* retry next cycle */ }
    };
    fetch();
    const interval = setInterval(fetch, 30000); // refresh every 30s — crons don't change often
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const hermes = useMemo(() => (data?.hermes || []).map(j => ({ ...j, owner: "hermes" })), [data]);
  const system = useMemo(() => (data?.system || []).map(j => ({ ...j, owner: "system" })), [data]);

  if (!data) {
    return (
      <PanelLayout
        title="SCHED"
        icon="◴"
        accentColor="#f59e0b"
        loading={loading}
      >
        <EmptyState icon="◴" title="No schedule yet" description="Waiting for cron data..." />
      </PanelLayout>
    );
  }

  const panelStats = [
    { label: "Hermes", value: hermes.length },
    { label: "System", value: system.length },
  ];

  return (
    <PanelLayout
      title="SCHED"
      icon="◴"
      accentColor="#f59e0b"
      lastUpdated={lastUpdated}
      loading={false}
      stats={panelStats}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Hermes Jobs */}
      <JobSection label="HERMES JOBS" jobs={hermes} emptyText="No scheduled jobs in this group." />

      {/* System Jobs */}
      <JobSection label="SYSTEM JOBS" jobs={system} emptyText="No scheduled jobs in this group." />
    </div>
    </PanelLayout>
  );
}