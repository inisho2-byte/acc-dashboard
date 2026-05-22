import { FONTS, STATUS_COLORS } from "../styles/theme.js";

export default function ProjectCard({ p, idx, onClick, delta }) {
  const c = STATUS_COLORS[p.status] || "#888";
  const progress = p.phase_count > 0 ? Math.round((p.phases_complete / p.phase_count) * 100) : 0;

  const isStale = (() => {
    if (!p.updated) return false;
    const updated = new Date(p.updated);
    if (isNaN(updated.getTime())) return false;
    const days = (Date.now() - updated.getTime()) / (1000 * 60 * 60 * 24);
    return days >= 7;
  })();

  const deltaBadge = (() => {
    if (!delta) return null;
    if (delta === "new") return { text: "● NEW", color: "#00ff88" };
    if (delta === "updated") return { text: "● UPDATED", color: "#f59e0b" };
    return null;
  })();

  return (
    <div className="project-card" style={{ animationDelay: `${idx * 80}ms`, cursor: "pointer" }} onClick={() => onClick?.(p)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <span className="label-tag" style={{ background: `${c}15`, color: c, border: `1px solid ${c}30` }}>{p.slug?.slice(0, 4).toUpperCase() || "PRJ"}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {deltaBadge && (
            <span className="label-tag" style={{ background: `${deltaBadge.color}15`, color: deltaBadge.color, border: `1px solid ${deltaBadge.color}30`, fontSize: 8 }}>{deltaBadge.text}</span>
          )}
          {isStale && <span className="label-tag" style={{ background: "#f59e0b15", color: "#f59e0b", border: "1px solid #f59e0b30", fontSize: 8 }}>STALE</span>}
          <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(150,180,220,0.4)", letterSpacing: "0.06em" }}>{p.status}</span>
        </div>
      </div>
      <div style={{ fontFamily: FONTS.sans, fontSize: 12, fontWeight: 500, color: "rgba(200,230,255,0.85)", marginTop: 8, lineHeight: 1.3 }}>{p.name}</div>
      {p.last_action && <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(150,180,220,0.4)", marginTop: 4, lineHeight: 1.3 }}>Last: {p.last_action}</div>}
      {p.next_step && <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(150,180,220,0.45)", marginTop: 2, lineHeight: 1.3 }}>→ {p.next_step}</div>}
      {p.phase_count > 0 && (
      <div style={{ marginTop: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(150,180,220,0.4)", letterSpacing: "0.08em" }}>PROGRESS</span>
          <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: c }}>{progress}%</span>
        </div>
        <div className="progress-bar-track">
          <div className="progress-bar-fill" style={{ "--target-w": `${progress}%`, width: `${progress}%`, background: `linear-gradient(90deg, ${c}66, ${c})` }} />
        </div>
      </div>
      )}
    </div>
  );
}