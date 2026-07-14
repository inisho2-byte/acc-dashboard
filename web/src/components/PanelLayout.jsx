import { useStaleData } from "../hooks/useStaleData";
import Skeleton from "./Skeleton";

const STYLES = {
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
  },
  topBorder: (accentColor) => ({
    width: "100%",
    height: 2,
    background: accentColor || "#00d4ff",
    flexShrink: 0,
  }),
  header: {
    height: 40,
    minHeight: 40,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 16px",
    flexShrink: 0,
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    overflow: "hidden",
  },
  icon: (accentColor) => ({
    fontSize: 16,
    color: accentColor || "#00d4ff",
    flexShrink: 0,
    lineHeight: 1,
  }),
  titleGroup: {
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  title: {
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: "1.5px",
    textTransform: "uppercase",
    color: "#fff",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    lineHeight: 1.2,
  },
  subtitle: {
    fontSize: 11,
    color: "#6b7280",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    lineHeight: 1.2,
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  staleLabel: (isStale) => ({
    fontSize: 10,
    fontFamily: "'Space Mono', monospace",
    color: isStale ? "#f59e0b" : "#6b7280",
    whiteSpace: "nowrap",
    letterSpacing: "0.05em",
  }),
  statsStrip: {
    display: "flex",
    gap: 8,
    padding: "0 16px 8px",
    flexShrink: 0,
  },
  statCard: (accentColor) => ({
    width: 90,
    height: 48,
    background: "rgba(0,212,255,0.06)",
    borderLeft: `2px solid ${accentColor || "#00d4ff"}`,
    borderRadius: 4,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    padding: "4px 8px",
  }),
  statLabel: {
    fontSize: 9,
    textTransform: "uppercase",
    color: "#6b7280",
    letterSpacing: "0.1em",
    lineHeight: 1.2,
  },
  statValue: {
    fontSize: 18,
    fontWeight: 700,
    color: "#fff",
    lineHeight: 1.3,
  },
  content: {
    flexGrow: 1,
    overflowY: "auto",
    overflowX: "hidden",
    padding: 16,
  },
  footer: {
    height: 32,
    minHeight: 32,
    borderTop: "1px solid rgba(255,255,255,0.05)",
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    padding: "0 16px",
    fontSize: 11,
    color: "#6b7280",
    flexShrink: 0,
  },
};

export default function PanelLayout({
  title,
  subtitle,
  icon,
  accentColor = "#00d4ff",
  lastUpdated,
  loading = false,
  stats,
  actions,
  footer,
  children,
}) {
  const { isStale, label: staleLabel } = useStaleData(lastUpdated || null);

  return (
    <div style={STYLES.root}>
      {/* Top accent border */}
      <div style={STYLES.topBorder(accentColor)} />

      {/* Header */}
      <div style={STYLES.header}>
        <div style={STYLES.headerLeft}>
          {icon && <span style={STYLES.icon(accentColor)}>{icon}</span>}
          <div style={STYLES.titleGroup}>
            <div style={STYLES.title}>{title}</div>
            {subtitle && <div style={STYLES.subtitle}>{subtitle}</div>}
          </div>
        </div>
        <div style={STYLES.headerRight}>
          {lastUpdated != null && (
            <span style={STYLES.staleLabel(isStale)}>{staleLabel}</span>
          )}
          {actions}
        </div>
      </div>

      {/* Stats strip */}
      {stats && stats.length > 0 && (
        <div style={STYLES.statsStrip}>
          {stats.map((s, i) => (
            <div key={i} style={STYLES.statCard(s.color || accentColor)}>
              <div style={STYLES.statLabel}>{s.label}</div>
              <div style={{ ...STYLES.statValue, color: s.color || "#fff" }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Content */}
      <div style={STYLES.content} className="panel-scroll">
        {loading ? <Skeleton variant="panel" /> : children}
      </div>

      {/* Footer */}
      {footer && <div style={STYLES.footer}>{footer}</div>}
    </div>
  );
}