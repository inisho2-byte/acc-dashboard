import { useState, useEffect } from "react";
import * as api from "../api.js";
import { FONTS } from "../styles/theme.js";
import PanelLayout from "../components/PanelLayout";
import EmptyState from "../components/EmptyState";

export default function PipelinePanel() {
  const [pipeline, setPipeline] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchPipeline = async () => {
      try {
        const data = await api.getPipeline();
        if (!cancelled) setPipeline(data);
      } catch {
        // Pipeline may be unavailable if mailbox is empty
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchPipeline();
    const interval = setInterval(fetchPipeline, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const stages = pipeline?.stages || [];
  const active = pipeline?.active || false;
  const message = pipeline?.message;

  const panelStats = stages.length > 0 ? [{ label: "Stages", value: stages.length }] : [];

  const getAgentColor = (agent) => agent === "arete" ? "#00d4ff" : "#a78bfa";
  const getStatusIcon = (status) => {
    switch (status) {
      case "active": return "●";
      case "completed": return "✓";
      case "waiting": return "◎";
      default: return "○";
    }
  };
  const getStatusColor = (status) => {
    switch (status) {
      case "active": return "#00ff88";
      case "completed": return "#00d4ff";
      case "waiting": return "#f59e0b";
      default: return "rgba(150,180,220,0.3)";
    }
  };

  return (
    <PanelLayout
      title="PIPELINE"
      icon="▸"
      accentColor="#f59e0b"
      loading={loading}
      stats={panelStats}
    >
      {!active && stages.length === 0 ? (
        <EmptyState icon="▸" title="No active pipeline" description={message || "Pipeline activates when ARETE dispatches tasks to Shu. Inter-agent messages via Tailscale will appear here."} />
      ) : (
        <div style={{ padding: 16 }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.5)", letterSpacing: "0.16em", marginBottom: 16 }}>
            AGENT PIPELINE {active && <span style={{ color: "#00ff88" }}>· ACTIVE</span>}
          </div>

      {/* Horizontal flow diagram */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, overflowX: "auto", padding: "8px 0" }}>
        {stages.map((stage, i) => (
          <div key={stage.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {/* Stage node */}
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
              padding: "10px 14px", borderRadius: 8, minWidth: 90,
              background: stage.status === "active" ? `${getAgentColor(stage.agent)}10` : "rgba(255,255,255,0.02)",
              border: `1px solid ${stage.status === "active" ? getAgentColor(stage.agent) + "40" : "rgba(0,212,255,0.08)"}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontFamily: FONTS.mono, fontSize: 8, color: getAgentColor(stage.agent), letterSpacing: "0.08em" }}>
                  {stage.agent.toUpperCase()}
                </span>
                <span style={{ color: getStatusColor(stage.status), fontSize: 10, animation: stage.status === "active" ? "pulse 1.5s infinite" : "none" }}>
                  {getStatusIcon(stage.status)}
                </span>
              </div>
              <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(200,230,255,0.6)", textAlign: "center", lineHeight: 1.3, maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {stage.summary || stage.id.replace(/_/g, " ")}
              </div>
              {stage.timestamp && (
                <div style={{ fontFamily: FONTS.mono, fontSize: 7, color: "rgba(150,180,220,0.3)" }}>
                  {new Date(stage.timestamp).toLocaleTimeString()}
                </div>
              )}
            </div>

            {/* Arrow between stages */}
            {i < stages.length - 1 && (
              <div style={{ color: getAgentColor(stages[i + 1]?.agent || "arete"), fontFamily: FONTS.mono, fontSize: 14, opacity: 0.4 }}>
                →
              </div>
            )}
          </div>
        ))}
      </div>

      {/* No stages message */}
      {stages.length === 0 && (
        <EmptyState icon="▸" title="Waiting for pipeline" description="Waiting for inter-agent message flow..." />
      )}
    </div>
      )}
    </PanelLayout>
  );
}