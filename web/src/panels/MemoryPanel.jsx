import { useState } from "react";
import MemoryExplorer from "./MemoryExplorer";
import ContextView from "./ContextView";
import PanelLayout from "../components/PanelLayout";
import EmptyState from "../components/EmptyState";
import { FONTS } from "../styles/theme.js";

const SUB_TAB_STYLE = {
  display: "inline-flex",
  alignItems: "center",
  gap: 0,
  background: "rgba(0,212,255,0.08)",
  borderRadius: 4,
  padding: "1px 2px",
};

const SUB_TAB_BTN = (active) => ({
  fontFamily: FONTS.mono,
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "1px",
  padding: "4px 12px",
  border: "none",
  borderRadius: 3,
  cursor: "pointer",
  color: active ? "#00d4ff" : "#9ca3af",
  background: active ? "rgba(0,212,255,0.15)" : "transparent",
  borderBottom: active ? "2px solid #00d4ff" : "2px solid transparent",
  transition: "all 0.15s ease",
});

export default function MemoryPanel() {
  const [subTab, setSubTab] = useState("memory"); // "memory" | "context"

  const actions = (
    <div style={SUB_TAB_STYLE}>
      <button style={SUB_TAB_BTN(subTab === "memory")} onClick={() => setSubTab("memory")}>Memory</button>
      <button style={SUB_TAB_BTN(subTab === "context")} onClick={() => setSubTab("context")}>Context Gaps</button>
    </div>
  );

  return (
    <PanelLayout
      title="MEMORY"
      icon="◊"
      accentColor="#a78bfa"
      actions={actions}
    >
      {subTab === "memory" ? <MemoryExplorer /> : <ContextView />}
    </PanelLayout>
  );
}