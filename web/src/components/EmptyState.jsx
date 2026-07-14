import { FONTS } from "../styles/theme.js";

const STYLES = {
  root: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "40px 20px",
    background: "radial-gradient(circle at center, rgba(0,212,255,0.03) 0%, transparent 70%)",
    position: "relative",
    minHeight: 200,
  },
  ringsContainer: {
    position: "relative",
    width: 120,
    height: 120,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  ring: (size, opacity) => ({
    position: "absolute",
    width: size,
    height: size,
    borderRadius: "50%",
    border: `1px solid rgba(0,212,255,${opacity})`,
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    pointerEvents: "none",
  }),
  icon: {
    fontSize: 48,
    color: "rgba(0,212,255,0.3)",
    position: "relative",
    zIndex: 1,
    lineHeight: 1,
  },
  title: {
    fontSize: 16,
    color: "#e5e7eb",
    marginTop: 16,
    textAlign: "center",
    fontWeight: 500,
  },
  description: {
    fontSize: 13,
    color: "#6b7280",
    maxWidth: 280,
    textAlign: "center",
    marginTop: 6,
    lineHeight: 1.5,
  },
  actionBtn: {
    marginTop: 16,
    fontSize: 13,
    fontFamily: FONTS.mono,
    letterSpacing: "0.08em",
    color: "#00d4ff",
    background: "transparent",
    border: "1px solid #00d4ff",
    borderRadius: 6,
    padding: "6px 16px",
    cursor: "pointer",
    transition: "background 0.2s ease",
  },
};

export default function EmptyState({ icon, title, description, action }) {
  return (
    <div style={STYLES.root}>
      {/* Concentric rings */}
      <div style={STYLES.ringsContainer}>
        <div style={STYLES.ring(100, 0.05)} />
        <div style={STYLES.ring(80, 0.07)} />
        <div style={STYLES.ring(60, 0.1)} />
        {icon && <span style={STYLES.icon}>{icon}</span>}
      </div>

      {title && <div style={STYLES.title}>{title}</div>}
      {description && <div style={STYLES.description}>{description}</div>}

      {action && (
        <button
          style={STYLES.actionBtn}
          onClick={action.onClick}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(0,212,255,0.1)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}