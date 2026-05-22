import { useState, useEffect, useCallback } from "react";
import * as api from "../api";
import { FONTS, AGENT_COLORS } from "../styles/theme.js";

function KeywordTag({ keyword, count, color }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 4,
        background: `${color}0d`,
        border: `1px solid ${color}25`,
        fontFamily: FONTS.mono,
        fontSize: 10,
        color: "#e8f4fd",
      }}
    >
      <span>{keyword}</span>
      <span
        style={{
          fontFamily: FONTS.mono,
          fontSize: 8,
          color,
          fontWeight: 600,
        }}
      >
        {count}
      </span>
    </div>
  );
}

export default function ContextView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const res = await api.getContextGaps();
    setData(res);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 60000);
    return () => clearInterval(interval);
  }, [loadData]);

  const gaps = data?.gaps;
  const sessionCounts = data?.session_counts;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        height: "100%",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div
          style={{
            fontFamily: FONTS.mono,
            fontSize: 9,
            color: "rgba(0,212,255,0.5)",
            letterSpacing: "0.16em",
          }}
        >
          CONTEXT GAPS
        </div>
        {sessionCounts && (
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span
              style={{
                fontFamily: FONTS.mono,
                fontSize: 9,
                color: AGENT_COLORS.arete,
                letterSpacing: "0.08em",
              }}
            >
              ARETE · {sessionCounts.arete ?? 0}
            </span>
            <span
              style={{
                fontFamily: FONTS.mono,
                fontSize: 9,
                color: AGENT_COLORS.shu,
                letterSpacing: "0.08em",
              }}
            >
              SHU · {sessionCounts.shu ?? 0}
            </span>
          </div>
        )}
      </div>

      {/* Loading state */}
      {loading && !data && (
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
            Loading context gaps...
          </span>
        </div>
      )}

      {/* Empty state */}
      {!loading && (!gaps || (!gaps.arete_only && !gaps.shu_only && !gaps.shared)) && (
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
            No context gap data available
          </span>
        </div>
      )}

      {/* Data */}
      {gaps && (
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {/* Two-column: Arete-only / Shu-only */}
          {(gaps.arete_only || gaps.shu_only) && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              {/* Arete-only column */}
              <div className="panel" style={{ padding: "12px 14px" }}>
                <div
                  style={{
                    fontFamily: FONTS.mono,
                    fontSize: 9,
                    color: AGENT_COLORS.arete,
                    letterSpacing: "0.12em",
                    marginBottom: 8,
                    opacity: 0.7,
                  }}
                >
                  ARETE-ONLY TOPICS
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                  }}
                >
                  {gaps.arete_only && Object.keys(gaps.arete_only).length > 0
                    ? Object.entries(gaps.arete_only).map(([kw, count]) => (
                        <KeywordTag
                          key={kw}
                          keyword={kw}
                          count={count}
                          color={AGENT_COLORS.arete}
                        />
                      ))
                    : (
                      <span
                        style={{
                          fontFamily: FONTS.mono,
                          fontSize: 9,
                          color: "rgba(150,180,220,0.25)",
                        }}
                      >
                        None
                      </span>
                    )}
                </div>
              </div>

              {/* Shu-only column */}
              <div className="panel" style={{ padding: "12px 14px" }}>
                <div
                  style={{
                    fontFamily: FONTS.mono,
                    fontSize: 9,
                    color: AGENT_COLORS.shu,
                    letterSpacing: "0.12em",
                    marginBottom: 8,
                    opacity: 0.7,
                  }}
                >
                  SHU-ONLY TOPICS
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                  }}
                >
                  {gaps.shu_only && Object.keys(gaps.shu_only).length > 0
                    ? Object.entries(gaps.shu_only).map(([kw, count]) => (
                        <KeywordTag
                          key={kw}
                          keyword={kw}
                          count={count}
                          color={AGENT_COLORS.shu}
                        />
                      ))
                    : (
                      <span
                        style={{
                          fontFamily: FONTS.mono,
                          fontSize: 9,
                          color: "rgba(150,180,220,0.25)",
                        }}
                      >
                        None
                      </span>
                    )}
                </div>
              </div>
            </div>
          )}

          {/* Shared topics section */}
          {gaps.shared && Object.keys(gaps.shared).length > 0 && (
            <div className="panel" style={{ padding: "12px 14px" }}>
              <div
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 9,
                  color: "rgba(150,180,220,0.5)",
                  letterSpacing: "0.12em",
                  marginBottom: 10,
                  textAlign: "center",
                }}
              >
                SHARED TOPICS
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  justifyContent: "center",
                }}
              >
                {Object.entries(gaps.shared).map(([kw, counts]) => {
                  const areteCount = counts.arete ?? 0;
                  const shuCount = counts.shu ?? 0;
                  return (
                    <div
                      key={kw}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "5px 12px",
                        borderRadius: 4,
                        background: "rgba(150,180,220,0.05)",
                        border: "1px solid rgba(150,180,220,0.12)",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: FONTS.mono,
                          fontSize: 10,
                          color: "#e8f4fd",
                        }}
                      >
                        {kw}
                      </span>
                      <span
                        style={{
                          fontFamily: FONTS.mono,
                          fontSize: 8,
                          color: AGENT_COLORS.arete,
                        }}
                      >
                        A:{areteCount}
                      </span>
                      <span
                        style={{
                          fontFamily: FONTS.mono,
                          fontSize: 8,
                          color: AGENT_COLORS.shu,
                        }}
                      >
                        S:{shuCount}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
