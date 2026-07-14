import { FONTS } from "../styles/theme.js";

export default function Layout({ sidebar, topBar, main, children }) {
  return (
    <div
      style={{
position: "relative",
height: "100vh",
        background: "var(--bg)",
        fontFamily: FONTS.sans,
        overflow: "hidden",
      }}
    >
      {/* Background layers are rendered by parent (canvas + grid) */}

      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", height: "100vh" }}>
        {topBar}

        <div style={{ display: "flex", flex: 1, overflow: "hidden", padding: "0 12px 12px", gap: 12 }}>
          {/* LEFT SIDEBAR — width driven by Sidebar's expanded/collapsed state */}
          <aside
            className="panel"
            style={{
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              transition: "width 0.2s ease",
            }}
          >
            {sidebar}
          </aside>

          {/* CENTER — full width content */}
          <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
            <div
              className="panel"
              style={{
                flex: 1,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              {main}
            </div>
          </main>
</div>
</div>

{/* Modals, toasts, overlays rendered as children */}
      {children}
    </div>
  );
}
