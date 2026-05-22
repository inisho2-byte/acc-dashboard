import { useRef, useEffect } from "react";
import { FONTS } from "../styles/theme.js";

export default function SettingsPanel({ settings, onUpdate, onClose }) {
  const panelRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const row = (label, control) => (
    <div key={label} style={{ marginBottom: 16 }}>
      <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.5)", letterSpacing: "0.14em", marginBottom: 6 }}>{label}</div>
      {control}
    </div>
  );

  // A3: Only allow 15s+ refresh intervals (5s/10s disabled for rate limit compliance)
  const refreshOptions = [15, 30, 60, 120, 300];

  const inputStyle = {
    width: "100%",
    padding: "8px 10px",
    background: "rgba(0,212,255,0.06)",
    border: "1px solid rgba(0,212,255,0.2)",
    borderRadius: 4,
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: "#e8f4fd",
    outline: "none",
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 160, display: "flex", justifyContent: "flex-end" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(3px)" }} />
      <div
        ref={panelRef}
        className="panel"
        style={{ position: "relative", width: 340, maxWidth: "90vw", height: "100vh", overflowY: "auto", padding: "24px", animation: "fade-up 0.25s ease" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 10, color: "#00d4ff", letterSpacing: "0.14em" }}>SETTINGS</div>
          <button
            onClick={onClose}
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, color: "rgba(200,220,255,0.6)", cursor: "pointer", padding: "4px 10px", fontFamily: FONTS.mono, fontSize: 10 }}
          >ESC</button>
        </div>

        {row("REFRESH INTERVAL", (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {refreshOptions.map((sec) => (
              <button
                key={sec}
                onClick={() => onUpdate({ refreshInterval: sec })}
                style={{
                  padding: "4px 10px",
                  borderRadius: 4,
                  border: `1px solid ${settings.refreshInterval === sec ? "rgba(0,212,255,0.4)" : "rgba(0,212,255,0.15)"}`,
                  background: settings.refreshInterval === sec ? "rgba(0,212,255,0.12)" : "transparent",
                  color: settings.refreshInterval === sec ? "#00d4ff" : "rgba(0,212,255,0.5)",
                  fontFamily: FONTS.mono,
                  fontSize: 10,
                  cursor: "pointer",
                  letterSpacing: "0.06em",
                }}
              >
                {sec < 60 ? `${sec}s` : `${sec / 60}m`}
              </button>
            ))}
          </div>
        ))}

        {row("THEME", (
          <div style={{ display: "flex", gap: 6 }}>
            {["dark", "light"].map((t) => (
              <button
                key={t}
                onClick={() => onUpdate({ theme: t })}
                style={{
                  flex: 1,
                  padding: "6px 0",
                  borderRadius: 4,
                  border: `1px solid ${settings.theme === t ? "rgba(0,212,255,0.4)" : "rgba(0,212,255,0.15)"}`,
                  background: settings.theme === t ? "rgba(0,212,255,0.12)" : "transparent",
                  color: settings.theme === t ? "#00d4ff" : "rgba(0,212,255,0.5)",
                  fontFamily: FONTS.mono,
                  fontSize: 10,
                  cursor: "pointer",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                {t}
              </button>
            ))}
          </div>
        ))}

        {row("ADMIN TOKEN", (
          <input
            type="password"
            value={settings.adminToken || ""}
            onChange={(e) => onUpdate({ adminToken: e.target.value })}
            placeholder="Paste admin token..."
            style={inputStyle}
          />
        ))}

        {row("API TOKEN", (
          <>
            <input
              type="password"
              value={settings.apiToken || ""}
              onChange={(e) => onUpdate({ apiToken: e.target.value })}
              placeholder="Paste API token (if server requires auth)..."
              style={inputStyle}
            />
            <div style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(150,180,220,0.4)", marginTop: 4 }}>
              Required when ACC_API_TOKEN env var is set on the server.
            </div>
          </>
        ))}

        <div style={{ marginTop: 24, paddingTop: 12, borderTop: "1px solid rgba(0,212,255,0.1)" }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(150,180,220,0.35)", lineHeight: 1.5 }}>
            Preferences auto-save to localStorage.
            <br />Tokens are stored locally — use with care.
            <br />Refresh interval minimum: 15s (rate limit compliance).
          </div>
        </div>
      </div>
    </div>
  );
}