import { useState, useEffect, useCallback } from "react";
import * as api from "../api";
import { FONTS, AGENT_COLORS } from "../styles/theme.js";

export default function MemoryExplorer() {
  const [areteMemory, setAreteMemory] = useState(null);
  const [shuMemory, setShuMemory] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadBoth = useCallback(async () => {
    setLoading(true);
    const [arete, shu] = await Promise.all([
      api.getAreteMemory(),
      api.getShuMemory(),
    ]);
    setAreteMemory(arete);
    setShuMemory(shu);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadBoth();
    const interval = setInterval(loadBoth, 60000);
    return () => clearInterval(interval);
  }, [loadBoth]);

  function renderAreteSources(memory) {
    if (!memory?.available || !memory?.sources || Object.keys(memory.sources).length === 0) {
      return (
        <div style={emptyStyle}>
          Memory unavailable
        </div>
      );
    }

    const sourceKeys = Object.keys(memory.sources).sort();

    return sourceKeys.map((key) => {
      const src = memory.sources[key];
      if (!src?.content) return null;

      return (
        <div key={key} style={{ marginBottom: 10 }}>
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 9,
              color: "rgba(0,212,255,0.5)",
              letterSpacing: "0.1em",
              marginBottom: 4,
            }}
          >
            {key}
            <span style={{ color: "rgba(150,180,220,0.3)", marginLeft: 8 }}>
              {src.size_bytes ? `${(src.size_bytes / 1024).toFixed(1)}KB` : ""}
            </span>
          </div>
          {src.truncated && (
            <div
              style={{
                fontFamily: FONTS.mono,
                fontSize: 8,
                color: "#f59e0b",
                background: "rgba(245,158,11,0.1)",
                border: "1px solid rgba(245,158,11,0.25)",
                borderRadius: 3,
                padding: "4px 8px",
                marginBottom: 4,
              }}
            >
              ⚠ Content truncated — showing partial output
            </div>
          )}
          <pre
            style={{
              margin: 0,
              padding: "10px 12px",
              background: "rgba(0,212,255,0.03)",
              border: "1px solid rgba(0,212,255,0.08)",
              borderRadius: 4,
              fontFamily: FONTS.mono,
              fontSize: 10,
              color: "rgba(200,230,255,0.8)",
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 300,
              overflowY: "auto",
            }}
          >
            {src.content}
          </pre>
        </div>
      );
    });
  }

  function renderShuMessages(memory) {
    if (!memory?.available || !memory?.sources?.recent_messages?.length) {
      return (
        <div style={emptyStyle}>
          Memory unavailable
        </div>
      );
    }

    const messages = memory.sources.recent_messages;

    return messages.map((m, i) => (
      <div
        key={m.id || i}
        className="fade-up"
        style={{
          animationDelay: `${i * 60}ms`,
          padding: "8px 0",
          borderBottom:
            i < messages.length - 1
              ? "1px solid rgba(167,139,250,0.05)"
              : "none",
        }}
      >
        <div
          style={{
            fontFamily: FONTS.sans,
            fontSize: 12,
            color: "rgba(200,230,255,0.85)",
            marginBottom: 2,
          }}
        >
          {m.title || m.preview?.slice(0, 80) || "Untitled"}
        </div>
        {m.preview && m.title && (
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 9,
              color: "rgba(150,180,220,0.4)",
              marginBottom: 2,
            }}
          >
            {m.preview.length > 120
              ? m.preview.slice(0, 120) + "..."
              : m.preview}
          </div>
        )}
        {m.timestamp && (
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 8,
              color: "rgba(150,180,220,0.3)",
            }}
          >
            {new Date(m.timestamp).toLocaleString()}
          </div>
        )}
      </div>
    ));
  }

  const columnBase = {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    overflowY: "auto",
    padding: "0 4px",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%" }}>
      {/* Header */}
      <div
        style={{
          fontFamily: FONTS.mono,
          fontSize: 9,
          color: "rgba(0,212,255,0.5)",
          letterSpacing: "0.16em",
        }}
      >
        MEMORY EXPLORER
      </div>

      {/* Loading state */}
      {loading && !areteMemory && !shuMemory && (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span
            style={{
              fontFamily: FONTS.mono,
              fontSize: 10,
              color: "rgba(150,180,220,0.3)",
            }}
          >
            Loading memory...
          </span>
        </div>
      )}

      {/* Two-column layout */}
      {!loading && (
        <div
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
            minHeight: 0,
          }}
        >
          {/* ARETE column */}
          <div style={columnBase}>
            <div
              style={{
                fontFamily: FONTS.mono,
                fontSize: 11,
                fontWeight: 700,
                color: AGENT_COLORS.arete,
                letterSpacing: "0.14em",
                paddingBottom: 6,
                borderBottom: `1px solid rgba(0,212,255,0.15)`,
              }}
            >
              ▲ ARETE
            </div>
            {renderAreteSources(areteMemory)}
          </div>

          {/* Shu column */}
          <div style={columnBase}>
            <div
              style={{
                fontFamily: FONTS.mono,
                fontSize: 11,
                fontWeight: 700,
                color: AGENT_COLORS.shu,
                letterSpacing: "0.14em",
                paddingBottom: 6,
                borderBottom: `1px solid rgba(167,139,250,0.15)`,
              }}
            >
              ◆ SHU
            </div>
            {renderShuMessages(shuMemory)}
          </div>
        </div>
      )}
    </div>
  );
}

const emptyStyle = {
  fontFamily: FONTS.mono,
  fontSize: 10,
  color: "rgba(150,180,220,0.3)",
  textAlign: "center",
  padding: 30,
};
