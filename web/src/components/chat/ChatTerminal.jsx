import { useState, useEffect, useRef, useCallback } from "react";
import DOMPurify from "dompurify";

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

// ── Helpers ──

/** Copy-to-clipboard button for code blocks */
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      style={{
        position: "absolute",
        top: 4,
        right: 4,
        background: copied ? "rgba(0,255,136,0.15)" : "rgba(0,212,255,0.1)",
        border: `1px solid ${copied ? "rgba(0,255,136,0.3)" : T.borderSubtle}`,
        borderRadius: 3,
        padding: "2px 6px",
        fontFamily: T.mono,
        fontSize: 9,
        color: copied ? T.success : T.textMuted,
        cursor: "pointer",
        transition: "all 0.15s",
      }}
    >
      {copied ? "COPIED" : "COPY"}
    </button>
  );
}

/** Render content with basic markdown-ish formatting:
 * - ```code blocks``` → dark background box with copy button
 * - `inline code` → dark background inline
 * - Line breaks preserved via whiteSpace:pre-wrap
 * - DOMPurify sanitizes any HTML in text segments
 */
function renderContent(content) {
  if (!content) return null;

  // Split on triple-backtick code blocks first, then handle inline code
  const parts = content.split(/(```[\s\S]*?```)/g);

  return parts.map((part, i) => {
    // Triple-backtick code block
    const blockMatch = part.match(/^```([\s\S]*?)```$/);
    if (blockMatch) {
      const code = blockMatch[1].replace(/^\n/, "").replace(/\n$/, "");
      return (
        <div key={i} style={{ position: "relative", margin: "6px 0" }}>
          <pre style={{
            background: "rgba(0,0,0,0.45)",
            border: `1px solid ${T.borderSubtle}`,
            borderRadius: 4,
            padding: "8px 10px",
            paddingRight: 50,
            fontFamily: T.mono,
            fontSize: 11,
            color: "rgba(200,230,255,0.85)",
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}>
            {code}
          </pre>
          <CopyButton text={code} />
        </div>
      );
    }

    // Handle inline backtick code within non-block segments
    const inlineParts = part.split(/(`[^`\n]+`)/g);
    if (inlineParts.length > 1) {
      return (
        <span key={i}>
          {inlineParts.map((seg, j) => {
            const inlineMatch = seg.match(/^`(.+)`$/);
            if (inlineMatch) {
              return (
                <code key={j} style={{
                  background: "rgba(0,0,0,0.35)",
                  border: `1px solid ${T.borderSubtle}`,
                  borderRadius: 3,
                  padding: "1px 4px",
                  fontFamily: T.mono,
                  fontSize: "inherit",
                  color: T.primary,
                }}>
                  {inlineMatch[1]}
                </code>
              );
            }
            // Sanitize plain text segments through DOMPurify
            const clean = DOMPurify.sanitize(seg, { ALLOWED_TAGS: [] });
            return <span key={j}>{clean}</span>;
          })}
        </span>
      );
    }

    // Sanitize plain text through DOMPurify (strip any HTML/XSS)
    const clean = DOMPurify.sanitize(part, { ALLOWED_TAGS: [] });
    return <span key={i}>{clean}</span>;
  });
}

function formatTimestamp(ts) {
  if (!ts) return "";
  try {
    const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}

// ── Tool call card (collapsible) ──

function ToolCallCard({ toolCall }) {
  const [expanded, setExpanded] = useState(false);

  const statusColor = toolCall.status === "running"
    ? T.warning
    : toolCall.status === "completed"
      ? T.success
      : toolCall.status === "error"
        ? T.danger
        : T.textMuted;

  const statusLabel = (toolCall.status || "unknown").toUpperCase();

  // Truncate args for summary display
  const argsStr = toolCall.args
    ? (typeof toolCall.args === "string" ? toolCall.args : JSON.stringify(toolCall.args, null, 2))
    : "";
  const argsSummary = argsStr.length > 60 ? argsStr.slice(0, 60) + "..." : argsStr;

  const resultStr = toolCall.result
    ? (typeof toolCall.result === "string" ? toolCall.result : JSON.stringify(toolCall.result, null, 2))
    : null;

  return (
    <div style={{
      marginTop: 6,
      background: "rgba(0,0,0,0.25)",
      border: `1px solid ${T.borderSubtle}`,
      borderRadius: 4,
      overflow: "hidden",
    }}>
      {/* Header row — always visible */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 8px",
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <span style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: statusColor,
          flexShrink: 0,
          boxShadow: `0 0 4px ${statusColor}60`,
        }} />
        <span style={{ fontFamily: T.mono, fontSize: 10, color: T.primary, fontWeight: 700, letterSpacing: "0.04em" }}>
          {toolCall.name || "tool"}
        </span>
        <span style={{ fontFamily: T.mono, fontSize: 9, color: T.textMuted, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {argsSummary}
        </span>
        <span style={{ fontFamily: T.mono, fontSize: 8, color: statusColor, letterSpacing: "0.08em" }}>
          {statusLabel}
        </span>
        <span style={{ fontFamily: T.mono, fontSize: 8, color: T.textMuted }}>{expanded ? "▲" : "▼"}</span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ padding: "4px 8px 8px", borderTop: `1px solid ${T.borderSubtle}` }}>
          {toolCall.args && (
            <div style={{ marginBottom: resultStr ? 6 : 0 }}>
              <div style={{ fontFamily: T.mono, fontSize: 8, color: T.textMuted, letterSpacing: "0.1em", marginBottom: 2 }}>ARGS</div>
              <pre style={{
                margin: 0,
                fontFamily: T.mono,
                fontSize: 10,
                color: "rgba(200,230,255,0.7)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}>
                {typeof toolCall.args === "string" ? toolCall.args : JSON.stringify(toolCall.args, null, 2)}
              </pre>
            </div>
          )}
          {resultStr && (
            <div>
              <div style={{ fontFamily: T.mono, fontSize: 8, color: T.textMuted, letterSpacing: "0.1em", marginBottom: 2 }}>RESULT</div>
              <pre style={{
                margin: 0,
                fontFamily: T.mono,
                fontSize: 10,
                color: "rgba(200,230,255,0.6)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: 120,
                overflowY: "auto",
              }}>
                {resultStr}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Message components ──

function UserMessage({ msg, accent }) {
  return (
    <div style={{
      display: "flex",
      justifyContent: "flex-end",
      marginBottom: 8,
      paddingLeft: 40,
    }}>
      <div style={{
        maxWidth: "80%",
        padding: "8px 12px",
        borderRadius: "0 6px 6px 6px",
 background: "rgba(0,212,255,0.06)",
 border: `1px solid ${T.borderSubtle}`,
 borderLeft: `2px solid ${accent}`,
      }}>
        <div style={{
          fontFamily: T.mono,
          fontSize: 8,
          color: T.textMuted,
          letterSpacing: "0.1em",
          marginBottom: 4,
          textAlign: "right",
        }}>
          {formatTimestamp(msg.timestamp)}
        </div>
        <div style={{
          fontFamily: T.sans,
          fontSize: 13,
          color: T.textMain,
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}>
          {renderContent(msg.content)}
        </div>
      </div>
    </div>
  );
}

function AssistantMessage({ msg, accent, agentLabel }) {
  return (
    <div style={{
      display: "flex",
      justifyContent: "flex-start",
      marginBottom: 8,
      paddingRight: 40,
    }}>
      <div style={{
        maxWidth: "85%",
        width: "100%",
        padding: "8px 12px",
        borderRadius: "6px 6px 6px 0",
        background: "rgba(0,0,0,0.2)",
        border: `1px solid ${T.borderSubtle}`,
        borderLeft: `2px solid ${accent}`,
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 6,
        }}>
          <span style={{
            fontFamily: T.mono,
            fontSize: 8,
            fontWeight: 700,
            letterSpacing: "0.12em",
            color: accent,
            background: `${accent}12`,
            border: `1px solid ${accent}30`,
            borderRadius: 3,
            padding: "1px 5px",
          }}>
            {agentLabel}
          </span>
          <span style={{ fontFamily: T.mono, fontSize: 8, color: T.textMuted, letterSpacing: "0.06em" }}>
            {formatTimestamp(msg.timestamp)}
          </span>
        </div>
        {msg.content && (
          <div style={{
            fontFamily: T.sans,
            fontSize: 13,
            color: T.textMain,
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}>
            {renderContent(msg.content)}
          </div>
        )}
        {/* Tool calls */}
        {msg.tool_calls && msg.tool_calls.length > 0 && (
          <div style={{ marginTop: msg.content ? 6 : 0 }}>
            {msg.tool_calls.map((tc, i) => (
              <ToolCallCard key={i} toolCall={tc} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SystemMessage({ msg }) {
  return (
    <div style={{
      textAlign: "center",
      marginBottom: 8,
      padding: "4px 12px",
    }}>
      <span style={{
        fontFamily: T.mono,
        fontSize: 10,
        color: T.textMuted,
        fontStyle: "italic",
        letterSpacing: "0.04em",
      }}>
        {msg.content}
      </span>
    </div>
  );
}

// ── Main component ──

export default function ChatTerminal({
  agent,
  messages,
  loading,
  error,
  onSend,
  onCancel,
  model,
}) {
  const [input, setInput] = useState("");
  const [isAtBottom, setIsAtBottom] = useState(true);
  const scrollRef = useRef(null);
  const lastMsgCountRef = useRef(0);

  const accent = AGENT_ACCENTS[agent] || T.primary;
  const agentLabel = AGENT_LABELS[agent] || agent.toUpperCase();

  // ── Auto-scroll logic ──

  const checkAtBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= 50;
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const handleScroll = useCallback(() => {
    setIsAtBottom(checkAtBottom());
  }, [checkAtBottom]);

  // Scroll to bottom when new messages arrive AND user is at bottom
  useEffect(() => {
    if (isAtBottom && messages.length > lastMsgCountRef.current) {
      scrollToBottom();
    }
    lastMsgCountRef.current = messages.length;
  }, [messages.length, isAtBottom, scrollToBottom]);

  // Also scroll when loading starts (assistant generating)
  useEffect(() => {
    if (loading && isAtBottom) {
      scrollToBottom();
    }
  }, [loading, isAtBottom, scrollToBottom]);

  // ── Input handling ──

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || loading) return;
    onSend(text);
    setInput("");
  }, [input, loading, onSend]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    // Shift+Enter allows newline — default textarea behavior
  }, [handleSend]);

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      background: T.bg,
      fontFamily: T.mono,
      color: T.textMain,
    }}>
      {/* ── Top bar ── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 14px",
        background: T.panelBg,
        borderBottom: `1px solid ${T.borderSubtle}`,
        borderLeft: `3px solid ${accent}`,
      }}>
        <span style={{
          fontFamily: T.mono,
          fontSize: 11,
          fontWeight: 700,
          color: accent,
          letterSpacing: "0.1em",
        }}>
          {agentLabel}
        </span>
        <span style={{ fontFamily: T.mono, fontSize: 9, color: T.textMuted, letterSpacing: "0.06em" }}>
          {model || "—"}
        </span>
        <div style={{ flex: 1 }} />
        {loading && (
          <span style={{
            fontFamily: T.mono,
            fontSize: 8,
            color: T.warning,
            letterSpacing: "0.1em",
            animation: "pulse 1.5s ease-in-out infinite",
          }}>
            ● GENERATING
          </span>
        )}
      </div>

      {/* ── Scrollable message area ── */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px 14px",
          position: "relative",
        }}
      >
        {messages.length === 0 && !error && (
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            fontFamily: T.mono,
            fontSize: 11,
            color: T.textMuted,
            letterSpacing: "0.06em",
          }}>
            NO MESSAGES — START A CONVERSATION
          </div>
        )}

        {messages.map((msg, i) => {
          switch (msg.role) {
            case "user":
              return <UserMessage key={i} msg={msg} accent={accent} />;
            case "assistant":
              return <AssistantMessage key={i} msg={msg} accent={accent} agentLabel={agentLabel} />;
            case "system":
              return <SystemMessage key={i} msg={msg} />;
            default:
              return (
                <div key={i} style={{
                  fontFamily: T.mono,
                  fontSize: 10,
                  color: T.textMuted,
                  marginBottom: 4,
                  whiteSpace: "pre-wrap",
                }}>
                  {renderContent(msg.content)}
                </div>
              );
          }
        })}

        {/* Error inline */}
        {error && (
          <div style={{
            textAlign: "center",
            padding: "8px 12px",
            margin: "6px 0",
            background: "rgba(255,68,68,0.08)",
            border: `1px solid rgba(255,68,68,0.2)`,
            borderRadius: 4,
            fontFamily: T.mono,
            fontSize: 10,
            color: T.danger,
            letterSpacing: "0.04em",
          }}>
            {error}
          </div>
        )}
      </div>

      {/* ── "New messages" scroll badge ── */}
      {!isAtBottom && messages.length > 0 && (
        <div
          onClick={scrollToBottom}
          style={{
            position: "absolute",
            bottom: 60,
            right: 20,
            background: `rgba(0,212,255,0.15)`,
            border: `1px solid ${T.borderLight}`,
            borderRadius: 4,
            padding: "3px 8px",
            fontFamily: T.mono,
            fontSize: 9,
            color: T.primary,
            cursor: "pointer",
            letterSpacing: "0.06em",
            zIndex: 10,
            backdropFilter: "blur(4px)",
          }}
        >
          ↓ NEW
        </div>
      )}

      {/* ── Input bar ── */}
      <div style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 8,
        padding: "8px 14px",
        background: T.panelBg,
        borderTop: `1px solid ${T.borderSubtle}`,
      }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Message ${agentLabel}...`}
          rows={1}
          style={{
            flex: 1,
            background: "rgba(0,0,0,0.3)",
            border: `1px solid ${T.borderLight}`,
            borderRadius: 4,
            padding: "8px 10px",
            fontFamily: T.mono,
            fontSize: 12,
            color: T.textMain,
            resize: "none",
            outline: "none",
            minHeight: 36,
            maxHeight: 100,
            lineHeight: 1.4,
          }}
          onFocus={e => { e.target.style.borderColor = T.primary; }}
          onBlur={e => { e.target.style.borderColor = T.borderLight; }}
        />

        {/* Cancel button — only when loading */}
        {loading && (
          <button
            onClick={onCancel}
            style={{
              background: "rgba(255,68,68,0.12)",
              border: "1px solid rgba(255,68,68,0.3)",
              borderRadius: 4,
              padding: "6px 12px",
              fontFamily: T.mono,
              fontSize: 10,
              fontWeight: 700,
              color: T.danger,
              cursor: "pointer",
              letterSpacing: "0.08em",
              whiteSpace: "nowrap",
            }}
          >
            ■ STOP
          </button>
        )}

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          style={{
            background: loading || !input.trim()
              ? "rgba(0,212,255,0.08)"
              : "rgba(0,212,255,0.15)",
            border: `1px solid ${loading || !input.trim() ? T.borderSubtle : T.primary}`,
            borderRadius: 4,
            padding: "6px 12px",
            fontFamily: T.mono,
            fontSize: 10,
            fontWeight: 700,
            color: loading || !input.trim() ? T.textMuted : T.primary,
            cursor: loading || !input.trim() ? "not-allowed" : "pointer",
            letterSpacing: "0.08em",
            whiteSpace: "nowrap",
          }}
        >
          → SEND
        </button>
      </div>
    </div>
  );
}
