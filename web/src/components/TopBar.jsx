import React, { useState, useEffect } from "react";
import { FONTS } from "../styles/theme.js";

// Isolated Clock component — owns its own 1Hz state, stops full-app re-render
function Clock() {
 const [time, setTime] = useState(new Date());
 useEffect(() => {
 const id = setInterval(() => setTime(new Date()), 1000);
 return () => clearInterval(id);
 }, []);
 const pad = (n) => String(n).padStart(2, "0");
 const display = `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`;
 return (
 <div style={{
 fontFamily: FONTS.mono,
 fontSize: 12,
 color: "#00d4ff",
 letterSpacing: "0.1em",
 minWidth: 64,
 textAlign: "right",
 }}>
 {display}
 </div>
 );
}

function TopBar({ agents, sseStatus, onReconnect, onCircuits, onSettings }) {
 return (
 <header
 style={{
 display: "flex",
 alignItems: "center",
 justifyContent: "space-between",
 padding: "12px 20px",
 borderBottom: "1px solid rgba(0,212,255,0.08)",
 background: "var(--bg-header)",
 backdropFilter: "blur(20px)",
 flexShrink: 0,
 }}
 >
 {/* Left: Breadcrumb */}
 <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
 <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: "rgba(0,212,255,0.45)", letterSpacing: "0.08em" }}>
 ACC
 </span>
 <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: "rgba(0,212,255,0.2)" }}>/</span>
 <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: "#e8f4fd", letterSpacing: "0.08em" }}>
 Overview
 </span>
 </div>

 {/* Right: Status + Time */}
 <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
 {agents.map((a) => (
 <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 5 }}>
 <span
 style={{
 width: 6,
 height: 6,
 borderRadius: "50%",
 background: a.status === "online" ? "#00ff88" : "#ff4444",
 display: "inline-block",
 }}
 />
 <span
 style={{
 fontFamily: FONTS.mono,
 fontSize: 9,
 color: a.color,
 letterSpacing: "0.08em",
 }}
 >
 {a.name}
 </span>
 </div>
 ))}

 <div style={{ width: 1, height: 16, background: "rgba(0,212,255,0.1)" }} />

 {/* SSE */}
 <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
 <span
 style={{
 width: 5,
 height: 5,
 borderRadius: "50%",
 background:
 sseStatus === "live"
 ? "#00ff88"
 : sseStatus === "error"
 ? "#ff4444"
 : "#f59e0b",
 display: "inline-block",
 }}
 className={sseStatus === "live" ? "live-dot" : ""}
 />
 <span
 style={{
 fontFamily: FONTS.mono,
 fontSize: 8,
 color:
 sseStatus === "live"
 ? "rgba(0,255,136,0.6)"
 : sseStatus === "error"
 ? "rgba(255,68,68,0.6)"
 : "rgba(245,158,11,0.6)",
 letterSpacing: "0.08em",
 }}
 >
 SSE
 </span>
 {sseStatus === "error" && (
 <button
 onClick={onReconnect}
 style={{
 marginLeft: 4,
 padding: "2px 6px",
 background: "rgba(255,68,68,0.1)",
 border: "1px solid rgba(255,68,68,0.3)",
 borderRadius: 3,
 color: "#ff8888",
 fontFamily: FONTS.mono,
 fontSize: 8,
 cursor: "pointer",
 letterSpacing: "0.06em",
 }}
 >
 RECONNECT
 </button>
 )}
 </div>

 <div style={{ width: 1, height: 16, background: "rgba(0,212,255,0.1)" }} />

 <button
 onClick={onCircuits}
 title="Circuit Breakers"
 style={{
 background: "transparent",
 border: "none",
 cursor: "pointer",
 padding: 4,
 display: "flex",
 alignItems: "center",
 }}
 >
 <svg
 width="14"
 height="14"
 viewBox="0 0 24 24"
 fill="none"
 stroke="rgba(0,212,255,0.6)"
 strokeWidth="2"
 strokeLinecap="round"
 strokeLinejoin="round"
 >
 <rect x="4" y="4" width="16" height="16" rx="2" />
 <path d="M9 9h6v6H9z" />
 </svg>
 </button>

 <button
 onClick={onSettings}
 title="Settings"
 style={{
 background: "transparent",
 border: "none",
 cursor: "pointer",
 padding: 4,
 display: "flex",
 alignItems: "center",
 }}
 >
 <svg
 width="14"
 height="14"
 viewBox="0 0 24 24"
 fill="none"
 stroke="rgba(0,212,255,0.6)"
 strokeWidth="2"
 strokeLinecap="round"
 strokeLinejoin="round"
 >
 <circle cx="12" cy="12" r="3" />
 <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
 </svg>
 </button>

 <div style={{ width: 1, height: 16, background: "rgba(0,212,255,0.1)" }} />

 <Clock />
 </div>
 </header>
 );
}

export default React.memo(TopBar);
