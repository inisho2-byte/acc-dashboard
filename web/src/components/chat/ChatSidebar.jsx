import { useMemo } from "react";

// ── Theme constants (inline, no theme.js import) ──
const T = {
  primary: "#00d4ff",
  shu: "#a78bfa",
  danger: "#ff4444",
  success: "#00ff88",
  warning: "#f59e0b",
  bg: "#000510",
  panelBg: "rgba(8,16,36,0.65)",
  borderSubtle: "rgba(0,212,255,0.1)",
  borderLight: "rgba(0,212,255,0.2)",
  mono: "'Space Mono', monospace",
  sans: "'Space Grotesk', sans-serif",
  textMain: "#e8f4fd",
  textMuted: "rgba(150,180,220,0.5)",
};

const AGENT_ACCENTS = {
  arete: T.primary,
  claude: T.success,
  shu: T.shu,
};

const AGENT_LABELS = {
  arete: "ARETE",
  claude: "CLAUDE",
  shu: "SHU",
};

const SHU_STATUS_MAP = {
  sent: { label: "SENT", color: T.primary, bg: "rgba(0,212,255,0.1)", border: "rgba(0,212,255,0.25)" },
  processing: { label: "PROCESSING", color: T.warning, bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.25)" },
  complete: { label: "COMPLETE", color: T.success, bg: "rgba(0,255,136,0.1)", border: "rgba(0,255,136,0.25)" },
  "no-response": { label: "NO RESPONSE", color: T.danger, bg: "rgba(255,68,68,0.1)", border: "rgba(255,68,68,0.25)" },
};

// ── Section wrapper ──

function Section({ label, children }) {
  return (
    <div style={{
      padding: "10px 12px",
      background: T.panelBg,
      border: `1px solid ${T.borderSubtle}`,
      borderRadius: 6,
    }}>
      {label && (
        <div style={{
          fontFamily: T.mono,
          fontSize: 8,
          color: T.textMuted,
          letterSpacing: "0.12em",
          marginBottom: 8,
        }}>
          {label}
        </div>
      )}
      {children}
    </div>
  );
}

// ── Stat row helper ──

function StatRow({ label, value, valueColor }) {
  return (
    <div style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "3px 0",
    }}>
      <span style={{
        fontFamily: T.mono,
        fontSize: 9,
        color: T.textMuted,
        letterSpacing: "0.06em",
      }}>
        {label}
      </span>
      <span style={{
        fontFamily: T.mono,
        fontSize: 11,
        fontWeight: 700,
        color: valueColor || T.textMain,
        letterSpacing: "0.04em",
      }}>
        {value || "—"}
      </span>
    </div>
  );
}

// ── Main component ──

export default function ChatSidebar({
  agent,
  model,
  models,
  sessionId,
  loading,
  error,
  onModelChange,
  messages,
  shuStatus,
}) {
  const accent = AGENT_ACCENTS[agent] || T.primary;
  const agentLabel = AGENT_LABELS[agent] || agent.toUpperCase();

  // Derive busy status from loading state
  const statusText = loading ? "BUSY" : "ONLINE";
  const statusColor = loading ? T.warning : T.success;

  // Session stats derived from messages
  const messageCount = messages?.length || 0;

  const firstMsgTime = useMemo(() => {
    if (!messages || messages.length === 0) return null;
    const first = messages[0];
    if (!first?.timestamp) return null;
    try {
      const d = typeof first.timestamp === "number" ? new Date(first.timestamp) : new Date(first.timestamp);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return null;
    }
  }, [messages]);

  // Truncated session ID
  const shortSessionId = sessionId
    ? sessionId.length > 12
      ? `${sessionId.slice(0, 6)}...${sessionId.slice(-4)}`
      : sessionId
    : null;

  // Shu status config
  const shuCfg = shuStatus ? SHU_STATUS_MAP[shuStatus] : null;

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      gap: 12,
      height: "100%",
      padding: 12,
      background: T.bg,
      fontFamily: T.mono,
      color: T.textMain,
      overflowY: "auto",
    }}>
      {/* ── Agent Status ── */}
      <Section label="AGENT STATUS">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: statusColor,
            flexShrink: 0,
            boxShadow: `0 0 6px ${statusColor}50`,
          }} />
          <span style={{
            fontFamily: T.mono,
            fontSize: 13,
            fontWeight: 700,
            color: accent,
            letterSpacing: "0.08em",
          }}>
            {agentLabel}
          </span>
          <span style={{
            fontFamily: T.mono,
            fontSize: 8,
            color: statusColor,
            letterSpacing: "0.1em",
            background: `${statusColor}15`,
            border: `1px solid ${statusColor}30`,
            borderRadius: 3,
            padding: "1px 5px",
            marginLeft: "auto",
          }}>
            {statusText}
          </span>
        </div>
      </Section>

      {/* ── Model Selector ── */}
      <Section label="MODEL">
        <select
          value={model || ""}
          onChange={e => onModelChange?.(e.target.value)}
          style={{
            width: "100%",
            background: "rgba(0,0,0,0.35)",
            border: `1px solid ${T.borderLight}`,
            borderRadius: 4,
            padding: "6px 8px",
            fontFamily: T.mono,
            fontSize: 10,
            color: T.textMain,
            cursor: "pointer",
            outline: "none",
            appearance: "none",
            WebkitAppearance: "none",
            MozAppearance: "none",
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 8 5'%3E%3Cpath d='M0 0l4 5 4-5z' fill='rgba(0,212,255,0.4)'/%3E%3C/svg%3E")`,
            backgroundRepeat: "no-repeat",
            backgroundPosition: "right 8px center",
            paddingRight: 24,
          }}
        >
          {!model && <option value="">— select —</option>}
          {(models || []).map(m => (
            <option key={m} value={m}>
              {m.split("/").pop()}
            </option>
          ))}
        </select>
        <div style={{
          fontFamily: T.mono,
          fontSize: 8,
          color: T.textMuted,
          letterSpacing: "0.06em",
          marginTop: 4,
        }}>
          {model || "NO MODEL"}
        </div>
      </Section>

      {/* ── Session Info ── */}
      <Section label="SESSION">
        <StatRow label="ID" value={shortSessionId || "NONE"} valueColor={shortSessionId ? T.primary : T.textMuted} />
        <StatRow label="MESSAGES" value={String(messageCount)} valueColor={messageCount > 0 ? accent : T.textMuted} />
        <StatRow label="STARTED" value={firstMsgTime || "—"} />
      </Section>

      {/* ── Shu Status (only for shu agent) ── */}
      {agent === "shu" && shuStatus && shuCfg && (
        <Section label="SHU STATUS">
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "6px 8px",
            background: shuCfg.bg,
            border: `1px solid ${shuCfg.border}`,
            borderRadius: 4,
          }}>
            <span style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: shuCfg.color,
              marginRight: 6,
              flexShrink: 0,
              boxShadow: `0 0 4px ${shuCfg.color}50`,
            }} />
            <span style={{
              fontFamily: T.mono,
              fontSize: 10,
              fontWeight: 700,
              color: shuCfg.color,
              letterSpacing: "0.1em",
            }}>
              {shuCfg.label}
            </span>
          </div>
        </Section>
      )}

      {/* ── Error display ── */}
      {error && (
        <div style={{
          padding: "8px 10px",
          background: "rgba(255,68,68,0.08)",
          border: "1px solid rgba(255,68,68,0.2)",
          borderRadius: 6,
          fontFamily: T.mono,
          fontSize: 10,
          color: T.danger,
          letterSpacing: "0.04em",
          lineHeight: 1.4,
          wordBreak: "break-word",
        }}>
          <div style={{
            fontSize: 8,
            letterSpacing: "0.1em",
            color: "rgba(255,68,68,0.6)",
            marginBottom: 4,
          }}>
            ERROR
          </div>
          {error}
        </div>
      )}

      {/* Spacer pushes content up, keeps layout tight */}
      <div style={{ flex: 1 }} />

      {/* ── Footer ── */}
      <div style={{
        padding: "6px 0",
        borderTop: `1px solid ${T.borderSubtle}`,
        fontFamily: T.mono,
        fontSize: 8,
        color: T.textMuted,
        letterSpacing: "0.08em",
        textAlign: "center",
      }}>
        {agentLabel} v1.0
      </div>
    </div>
  );
}
