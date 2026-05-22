import { useState, useEffect, useCallback } from "react";
import * as api from "../api";
import { FONTS, AGENT_COLORS } from "../styles/theme.js";

const AGENT_LABELS = {
  shu: "SHU",
  arete: "ARETE",
};

function formatTime(ts) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return ts;
  }
}

function isRelevant(str) {
  return str !== null && str !== undefined && str !== "";
}

export default function IBCBFeedPanel() {
  const [messages, setMessages] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const loadData = useCallback(async () => {
    const [msgs, st] = await Promise.all([
      api.getIBCB(30),
      api.getIBCBStats(),
    ]);
    if (msgs) {
      setMessages(msgs);
      setError(false);
    } else if (messages === null) {
      setError(true);
    }
    if (st) setStats(st);
    setLoading(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadData();
    const interval = setInterval(() => {
      api.getIBCB(30).then((msgs) => {
        if (msgs) {
          setMessages(msgs);
          setError(false);
        }
      });
    }, 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  const hasData = messages && Array.isArray(messages) && messages.length > 0;

  function formatLabel(msg) {
    const sender = AGENT_LABELS[msg.sender_label] || (msg.sender_label || "").toUpperCase();
    const recipient = AGENT_LABELS[msg.recipient_label] || (msg.recipient_label || "").toUpperCase();
    if (sender && recipient) return `${sender} → ${recipient}`;
    if (sender) return sender;
    if (recipient) return `→ ${recipient}`;
    return "—";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%" }}>
      {/* Stats header bar */}
      <div
        style={{
          display: "flex",
          gap: 16,
          padding: "8px 12px",
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 6,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              fontFamily: FONTS.mono,
              fontSize: 9,
              color: "rgba(150,180,220,0.4)",
              letterSpacing: "0.06em",
            }}
          >
            INBOUND
          </span>
          <span
            style={{
              fontFamily: FONTS.mono,
              fontSize: 18,
              fontWeight: 700,
              color: AGENT_COLORS.shu,
            }}
          >
            {stats?.inbound ?? "—"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              fontFamily: FONTS.mono,
              fontSize: 9,
              color: "rgba(150,180,220,0.4)",
              letterSpacing: "0.06em",
            }}
          >
            OUTBOUND
          </span>
          <span
            style={{
              fontFamily: FONTS.mono,
              fontSize: 18,
              fontWeight: 700,
              color: AGENT_COLORS.arete,
            }}
          >
            {stats?.outbound ?? "—"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
          <span
            style={{
              fontFamily: FONTS.mono,
              fontSize: 9,
              color: "rgba(150,180,220,0.4)",
              letterSpacing: "0.06em",
            }}
          >
            PEERS
          </span>
          <span
            style={{
              fontFamily: FONTS.mono,
              fontSize: 18,
              fontWeight: 700,
              color: "rgba(150,180,220,0.7)",
            }}
          >
            {stats?.peers ?? "—"}
          </span>
        </div>
      </div>

      {/* Loading state */}
      {loading && (
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
              animation: "pulse 1.5s ease-in-out infinite",
            }}
          >
            ⏳ Loading bridge feed...
          </span>
        </div>
      )}

      {/* Empty / error state */}
      {!loading && !hasData && (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontFamily: FONTS.mono,
                fontSize: 11,
                color: error
                  ? "rgba(255,68,68,0.5)"
                  : "rgba(150,180,220,0.3)",
                letterSpacing: "0.06em",
              }}
            >
              {error ? "⚠ Failed to load bridge data" : "No bridge data available"}
            </div>
            {!error && (
              <div
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 9,
                  color: "rgba(150,180,220,0.2)",
                  marginTop: 6,
                }}
              >
                Messages between Shu and ARETE will appear here
              </div>
            )}
          </div>
        </div>
      )}

      {/* Timeline */}
      {hasData && (
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            position: "relative",
          }}
        >
          {/* Center vertical line */}
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: 0,
              bottom: 0,
              width: 2,
              background:
                "linear-gradient(to bottom, transparent 0%, rgba(0,212,255,0.15) 10%, rgba(0,212,255,0.15) 90%, transparent 100%)",
              transform: "translateX(-50%)",
              pointerEvents: "none",
            }}
          />

          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "4px 0" }}>
            {messages.map((msg, i) => {
              const isInbound = msg.direction === "inbound";
              const cardColor = isInbound ? AGENT_COLORS.shu : AGENT_COLORS.arete;
              const cardLabel = formatLabel(msg);
              const cardBg = isInbound
                ? "rgba(167,139,250,0.06)"
                : "rgba(0,212,255,0.06)";

              return (
                <div
                  key={msg.id || i}
                  className="fade-up"
                  style={{
                    display: "flex",
                    animationDelay: `${(i % 20) * 30}ms`,
                  }}
                >
                  {/* Left side — inbound */}
                  <div
                    style={{
                      width: "50%",
                      paddingRight: 16,
                      display: "flex",
                      justifyContent: isInbound ? "flex-end" : "flex-start",
                    }}
                  >
                    {isInbound && (
                      <MessageCard
                        msg={msg}
                        cardColor={cardColor}
                        cardBg={cardBg}
                        cardLabel={cardLabel}
                      />
                    )}
                  </div>

                  {/* Center dot */}
                  <div
                    style={{
                      width: 0,
                      display: "flex",
                      justifyContent: "center",
                      position: "relative",
                      zIndex: 1,
                      flexShrink: 0,
                    }}
                  >
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: cardColor,
                        border: "2px solid rgba(0,5,16,0.9)",
                      }}
                    />
                  </div>

                  {/* Right side — outbound */}
                  <div
                    style={{
                      width: "50%",
                      paddingLeft: 16,
                      display: "flex",
                      justifyContent: isInbound ? "flex-start" : "flex-start",
                    }}
                  >
                    {!isInbound && (
                      <MessageCard
                        msg={msg}
                        cardColor={cardColor}
                        cardBg={cardBg}
                        cardLabel={cardLabel}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function MessageCard({ msg, cardColor, cardBg, cardLabel }) {
  const sigColor = msg.signature ? "#00ff88" : "rgba(150,180,220,0.3)";
  const sigIcon = msg.signature ? "✓" : "✗";
  const sigLabel = msg.signature ? "verified" : "unsigned";

  return (
    <div
      style={{
        maxWidth: 360,
        padding: "8px 10px",
        borderRadius: 6,
        background: cardBg,
        border: `1px solid ${cardColor}18`,
      }}
    >
      {/* Header: label + timestamp */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 4,
          gap: 8,
        }}
      >
        <span
          style={{
            fontFamily: FONTS.mono,
            fontSize: 9,
            fontWeight: 700,
            color: cardColor,
            letterSpacing: "0.06em",
          }}
        >
          {cardLabel}
        </span>
        <span
          style={{
            fontFamily: FONTS.mono,
            fontSize: 8,
            color: "rgba(150,180,220,0.3)",
            flexShrink: 0,
          }}
        >
          {formatTime(msg.received_at)}
        </span>
      </div>

      {/* Message text */}
      <div
        style={{
          fontFamily: FONTS.sans,
          fontSize: 11,
          color: "rgba(200,230,255,0.75)",
          lineHeight: 1.4,
          marginBottom: 6,
          wordBreak: "break-word",
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
        }}
      >
        {isRelevant(msg.message) ? msg.message : "(no content)"}
      </div>

      {/* Footer badges */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {msg.latency_ms != null && (
          <span
            style={{
              fontFamily: FONTS.mono,
              fontSize: 8,
              color: "rgba(245,158,11,0.7)",
              background: "rgba(245,158,11,0.1)",
              border: "1px solid rgba(245,158,11,0.2)",
              borderRadius: 3,
              padding: "1px 5px",
              letterSpacing: "0.04em",
            }}
          >
            ⏱ {msg.latency_ms}ms
          </span>
        )}
        <span
          style={{
            fontFamily: FONTS.mono,
            fontSize: 8,
            color: sigColor,
            border: `1px solid ${sigColor}25`,
            background: `${sigColor}08`,
            borderRadius: 3,
            padding: "1px 5px",
            letterSpacing: "0.04em",
          }}
          title={sigLabel}
        >
          {sigIcon} {sigLabel}
        </span>
      </div>
    </div>
  );
}
