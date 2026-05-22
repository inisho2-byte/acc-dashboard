import { FONTS, STATUS_COLORS } from "../styles/theme.js";

export default function ProjectDetail({ project, detail, onClose }) {
  if (!project) return null;
  const c = STATUS_COLORS[project.status] || "#888";
  const progress = project.phase_count > 0 ? Math.round((project.phases_complete / project.phase_count) * 100) : 0;
  const phases = detail?.phases_detail || [];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", justifyContent: "flex-end" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} />
      <div style={{ position: "relative", width: 420, maxWidth: "90vw", height: "100vh", background: "rgba(5,14,35,0.95)", borderLeft: "1px solid rgba(0,212,255,0.2)", overflowY: "auto", padding: 24, animation: "fade-up 0.3s ease" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <span className="label-tag" style={{ background: `${c}15`, color: c, border: `1px solid ${c}30`, fontSize: 10 }}>{project.status?.toUpperCase()}</span>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, color: "rgba(200,220,255,0.6)", cursor: "pointer", padding: "4px 10px", fontFamily: FONTS.mono, fontSize: 10 }}>ESC</button>
        </div>
        <h2 style={{ fontFamily: FONTS.sans, fontSize: 22, fontWeight: 700, color: "#e8f4fd", marginBottom: 4 }}>{project.name}</h2>
        <div style={{ fontFamily: FONTS.mono, fontSize: 10, color: "rgba(150,180,220,0.5)", letterSpacing: "0.08em", marginBottom: 16 }}>{project.slug}</div>

        {project.phase_count > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: "rgba(150,180,220,0.5)", letterSpacing: "0.1em" }}>PROGRESS</span>
            <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: c }}>{project.phases_complete}/{project.phase_count} · {progress}%</span>
          </div>
          <div className="progress-bar-track" style={{ height: 6 }}>
            <div className="progress-bar-fill" style={{ "--target-w": `${progress}%`, width: `${progress}%`, height: "100%", background: `linear-gradient(90deg, ${c}66, ${c})` }} />
          </div>
        </div>
        )}

        {project.next_step && (
          <div style={{ padding: "12px 14px", borderRadius: 8, background: "rgba(0,212,255,0.05)", border: "1px solid rgba(0,212,255,0.15)", marginBottom: 16 }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.6)", letterSpacing: "0.12em", marginBottom: 4 }}>NEXT STEP</div>
            <div style={{ fontFamily: FONTS.sans, fontSize: 13, color: "rgba(200,230,255,0.9)" }}>{project.next_step}</div>
          </div>
        )}

        {project.last_action && (
          <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(0,255,136,0.03)", border: "1px solid rgba(0,255,136,0.1)", marginBottom: 16 }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,255,136,0.5)", letterSpacing: "0.12em", marginBottom: 4 }}>LAST COMPLETED</div>
            <div style={{ fontFamily: FONTS.sans, fontSize: 12, color: "rgba(0,255,136,0.7)" }}>{project.last_action}</div>
          </div>
        )}

        {project.tags?.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
            {project.tags.map(t => (
              <span key={t} style={{ fontFamily: FONTS.mono, fontSize: 9, padding: "2px 8px", borderRadius: 3, background: "rgba(0,212,255,0.06)", border: "1px solid rgba(0,212,255,0.12)", color: "rgba(0,212,255,0.7)", letterSpacing: "0.08em" }}>{t}</span>
            ))}
          </div>
        )}

        {phases.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.5)", letterSpacing: "0.14em", marginBottom: 10 }}>PHASES</div>
            {phases.map((phase, pi) => {
              const done = phase.tasks?.filter(t => t.done).length || 0;
              const total = phase.tasks?.length || 0;
              return (
                <div key={pi} style={{ marginBottom: 10, padding: "10px 12px", borderRadius: 6, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontFamily: FONTS.sans, fontSize: 12, fontWeight: 600, color: "rgba(200,230,255,0.85)" }}>{phase.title}</span>
                    <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: done === total ? "#00ff88" : "rgba(150,180,220,0.5)" }}>{done}/{total}</span>
                  </div>
                  {phase.tasks?.map((task, ti) => (
                    <div key={ti} style={{ display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 3 }}>
                      <span style={{ color: task.done ? "#00ff88" : "rgba(150,180,220,0.3)", fontSize: 10, fontFamily: FONTS.mono, flexShrink: 0, marginTop: 1 }}>{task.done ? "✓" : "○"}</span>
                      <span style={{ fontFamily: FONTS.sans, fontSize: 11, color: task.done ? "rgba(0,255,136,0.6)" : "rgba(180,200,220,0.65)", textDecoration: task.done ? "line-through" : "none" }}>{task.text}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {detail?.files?.length > 0 && (
          <div>
            <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.5)", letterSpacing: "0.14em", marginBottom: 8 }}>VAULT FILES</div>
            {detail.files.map(f => (
              <div key={f} style={{ fontFamily: FONTS.mono, fontSize: 10, color: "rgba(150,180,220,0.5)", padding: "2px 0" }}>📄 {f}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
