import { useMemo, useState, useCallback } from "react";
import { FONTS } from "../styles/theme.js";
import { SEVERITY, getSeverity } from "../styles/theme.js";

/**
 * AlertTicker — thin bar fixed at the bottom of the screen showing scrolling alerts.
 * Props: { errors, agents, onAlertClick }
 */
export default function AlertTicker({ errors, agents, onAlertClick }) {
  const [dismissed, setDismissed] = useState(false);

  const alerts = useMemo(() => {
    const items = [];

    // Source 1: error count
    const errorCount = Array.isArray(errors) ? errors.length : 0;
    if (errorCount > 0) {
      const sev = getSeverity(errorCount);
      items.push({
        severity: sev,
        message: `${errorCount} error${errorCount !== 1 ? "s" : ""} in last hour`,
        tabId: "errors",
      });
    }

    // Source 2: down agents
    if (Array.isArray(agents)) {
      agents.forEach((a) => {
        if (a.status === "down" || a.status === "offline") {
          items.push({
            severity: SEVERITY.CRITICAL,
            message: `Agent ${a.name || a.id} offline`,
            tabId: "agents",
          });
        }
      });
    }

    return items;
  }, [errors, agents]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  // No alerts or dismissed — render nothing
  if (dismissed || alerts.length === 0) return null;

  // Determine the highest severity for the top border color
  const borderSev = alerts.reduce((worst, a) => {
    const order = [SEVERITY.INFO, SEVERITY.LOW, SEVERITY.MEDIUM, SEVERITY.HIGH, SEVERITY.CRITICAL];
    const wi = order.indexOf(worst);
    const ai = order.indexOf(a.severity);
    return ai > wi ? a.severity : worst;
  }, SEVERITY.INFO);

  // Build the scrolling text content
  const tickerText = alerts
    .map((a) => `${a.severity.label} ${a.message}`)
    .join("  —  ");

  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        height: 28,
        zIndex: 900, // above content, below modals (1000+)
        background: "rgba(10,10,15,0.92)",
        borderTop: `1px solid ${borderSev.color}`,
        display: "flex",
        alignItems: "center",
        overflow: "hidden",
      }}
    >
      {/* Scrolling content */}
      <div
        style={{
          flex: 1,
          overflow: "hidden",
          position: "relative",
          height: "100%",
          display: "flex",
          alignItems: "center",
        }}
      >
        <div
          className="alert-ticker-scroll"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 0,
            whiteSpace: "nowrap",
            animation: "alertTickerScroll 20s linear infinite",
          }}
        >
          {alerts.map((a, i) => (
            <span
              key={i}
              onClick={() => onAlertClick?.(a.tabId)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
                padding: "0 24px",
                fontFamily: FONTS.mono,
                fontSize: 10,
                letterSpacing: "0.04em",
                color: "rgba(200,230,255,0.75)",
                transition: "color 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "#e8f4fd";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "rgba(200,230,255,0.75)";
              }}
            >
              {/* Severity dot */}
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: a.severity.color,
                  flexShrink: 0,
                }}
              />
              <span style={{ color: a.severity.color, fontWeight: 700 }}>
                {a.severity.label}
              </span>
              <span>{a.message}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Dismiss button */}
      <button
        onClick={handleDismiss}
        aria-label="Dismiss all alerts"
        title="Dismiss"
        style={{
          background: "transparent",
          border: "none",
          color: "rgba(150,180,220,0.35)",
          cursor: "pointer",
          fontSize: 12,
          lineHeight: 1,
          padding: "0 10px",
          height: "100%",
          display: "flex",
          alignItems: "center",
          flexShrink: 0,
          transition: "color 0.15s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "rgba(150,180,220,0.7)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "rgba(150,180,220,0.35)";
        }}
      >
        ✕
      </button>

      {/* Keyframe injection */}
      <style>{`
        @keyframes alertTickerScroll {
          0% { transform: translateX(100%); }
          100% { transform: translateX(-100%); }
        }
      `}</style>
    </div>
  );
}