import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import * as api from "../api.js";
import { FONTS } from "../styles/theme.js";
import PanelLayout from "../components/PanelLayout";
import EmptyState from "../components/EmptyState";

const AGENT_COLORS = {
  scout: "#7DD3FC",
  scribe: "#F472B6",
  reach: "#E879F9",  // spec says #FBBF24 for donut but #E879F9 for reach card
  dev: "#A78BFA",
};

const AGENT_ORDER = ["scout", "scribe", "reach", "dev"];

function formatDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch { return "—"; }
}

function renderMarkdown(md) {
  if (!md) return "";
  let html = md
    // Code blocks (fenced)
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
      `<pre style="background:rgba(0,212,255,0.04);border:1px solid rgba(0,212,255,0.1);border-radius:6px;padding:12px;overflow-x:auto;margin:12px 0;font-family:'JetBrains Mono','Fira Code',monospace;font-size:12px;color:rgba(200,230,255,0.85)">${escHtml(code.trim())}</pre>`)
    // Inline code
    .replace(/`([^`]+)`/g, '<code style="background:rgba(0,212,255,0.06);padding:1px 5px;border-radius:3px;font-family:\'JetBrains Mono\',monospace;font-size:12px;color:#00d4ff">$1</code>')
    // Headers
    .replace(/^### (.+)$/gm, '<h3 style="font-family:\'Inter Tight\',sans-serif;font-size:14px;font-weight:600;color:rgba(200,230,255,0.85);margin:16px 0 6px">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="font-family:\'Inter Tight\',sans-serif;font-size:17px;font-weight:600;color:rgba(200,230,255,0.9);margin:20px 0 8px;border-bottom:1px solid rgba(0,212,255,0.08);padding-bottom:6px">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="font-family:\'Inter Tight\',sans-serif;font-size:22px;font-weight:600;color:rgba(244,244,248,0.95);margin:0 0 16px">$1</h1>')
    // Blockquote
    .replace(/^> (.+)$/gm, '<blockquote style="border-left:2px solid rgba(0,212,255,0.2);padding-left:12px;color:rgba(150,180,220,0.6);margin:8px 0">$1</blockquote>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:rgba(244,244,248,0.95)">$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Tables (basic)
    .replace(/\|(.+)\|/g, (match) => {
      const cells = match.split("|").filter(c => c.trim());
      if (cells.every(c => /^[\s-]+$/.test(c))) return "";
      return `<div style="display:flex;gap:8px;padding:4px 8px;border-bottom:1px solid rgba(0,212,255,0.04)">${cells.map(c => `<span style="flex:1;font-size:12px;color:rgba(200,230,255,0.7)">${c.trim()}</span>`).join("")}</div>`;
    })
    // Unordered list
    .replace(/^- (.+)$/gm, '<div style="padding-left:16px;margin:2px 0;color:rgba(200,230,255,0.75);font-size:13px">· $1</div>')
    // Ordered list
    .replace(/^(\d+)\. (.+)$/gm, '<div style="padding-left:16px;margin:2px 0;color:rgba(200,230,255,0.75);font-size:13px">$1. $2</div>')
    // Horizontal rule
    .replace(/^---$/gm, '<hr style="border:none;border-top:1px solid rgba(0,212,255,0.08);margin:16px 0" />')
    // Paragraphs
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n/g, '<br/>');
  return html;
}

function escHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export default function ContentPanel() {
  const [docs, setDocs] = useState([]);
  const [selected, setSelected] = useState(null); // path string
  const [content, setContent] = useState(null);   // { path, title, content, ... }
  const [mode, setMode] = useState("view");        // "view" | "edit"
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const contentRef = useRef(null);

  const loadDocs = useCallback(async () => {
    try {
      const data = await api.getContentList();
      setDocs(data);
      setLoading(false);
      // Auto-select first doc if none selected
      if (!selected && data.length > 0) {
        setSelected(data[0].path);
      }
    } catch { /* retry */ }
  }, []);

  useEffect(() => { loadDocs(); }, [loadDocs]);

  // Load content when selection changes
  useEffect(() => {
    if (!selected) { setContent(null); return; }
    (async () => {
      try {
        const data = await api.getContentDoc(selected);
        setContent(data);
        setMode("view");
      } catch { setContent(null); }
    })();
  }, [selected]);

  const handleSave = async () => {
    if (!content) return;
    setSaving(true);
    try {
      await api.saveContentDoc(content.path, editText);
      // Reload content
      const data = await api.getContentDoc(content.path);
      setContent(data);
      setMode("view");
      await loadDocs(); // refresh sidebar (title may have changed)
    } catch { /* keep edit mode */ }
    setSaving(false);
  };

  const handleCancel = () => {
    setMode("view");
    setEditText("");
  };

  // Group docs by agent
  const grouped = useMemo(() => {
    const groups = {};
    for (const agent of AGENT_ORDER) groups[agent] = [];
    for (const doc of docs) {
      if (!groups[doc.agent]) groups[doc.agent] = [];
      groups[doc.agent].push(doc);
    }
    return groups;
  }, [docs]);

  return (
    <PanelLayout
      title="CONTENT"
      icon="🗎"
      accentColor="#f59e0b"
      loading={loading}
      stats={docs.length > 0 ? [{ label: "Items", value: docs.length }] : []}
    >
      {!loading && docs.length === 0 ? (
        <EmptyState icon="🗎" title="No content yet" description="Documents will appear when agents generate them" />
      ) : (
    <div style={{ display: "flex", gap: 0, height: "100%" }}>
      {/* ── SIDEBAR ── */}
      <div style={{ width: 280, borderRight: "1px solid rgba(0,212,255,0.08)", overflowY: "auto", padding: "16px 0", flexShrink: 0 }} className="panel-scroll">
        <div style={{ padding: "0 16px 12px" }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.5)", letterSpacing: "0.16em", marginBottom: 4 }}>CONTENT LIBRARY</div>
          <div style={{ fontFamily: "'Inter Tight', 'Inter', sans-serif", fontSize: "clamp(28px, 3vw, 42px)", fontWeight: 500, color: "rgba(200,230,255,0.85)", letterSpacing: "-0.02em", lineHeight: 1.1 }}>Documents.</div>
        </div>
        {AGENT_ORDER.map(agent => {
          const agentDocs = grouped[agent] || [];
          if (agentDocs.length === 0) return null;
          const color = AGENT_COLORS[agent] || "#A78BFA";
          return (
            <div key={agent} style={{ marginBottom: 8 }}>
              <div style={{ fontFamily: FONTS.mono, fontSize: 9, color, letterSpacing: "0.14em", padding: "6px 16px 4px", textTransform: "uppercase" }}>{agent}</div>
              {agentDocs.map(doc => {
                const isSelected = selected === doc.path;
                return (
                  <div
                    key={doc.path}
                    onClick={() => setSelected(doc.path)}
                    style={{
                      padding: "6px 16px 6px 20px", cursor: "pointer",
                      borderLeft: isSelected ? `2px solid ${color}` : "2px solid transparent",
                      background: isSelected ? "rgba(255,255,255,0.04)" : "transparent",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <div style={{ fontFamily: "'Inter Tight', 'Inter', sans-serif", fontSize: 13, fontWeight: 500, color: isSelected ? "rgba(244,244,248,0.95)" : "rgba(200,230,255,0.65)", lineHeight: 1.3 }}>{doc.title}</div>
                    <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(150,180,220,0.3)", marginTop: 2 }}>{doc.filename}</div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* ── PREVIEW PANEL ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: 24 }} className="panel-scroll">
        {!content ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: "rgba(150,180,220,0.2)", letterSpacing: "0.08em" }}>Select a document to read</div>
          </div>
        ) : mode === "edit" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontFamily: "'Inter Tight', 'Inter', sans-serif", fontSize: 22, fontWeight: 600, color: "rgba(200,230,255,0.9)" }}>{content.title}</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={handleSave} disabled={saving} style={{
                  fontFamily: FONTS.mono, fontSize: 10, letterSpacing: "0.08em",
                  background: "rgba(0,255,136,0.1)", color: "#00ff88", border: "1px solid rgba(0,255,136,0.25)", borderRadius: 4, padding: "5px 14px", cursor: saving ? "wait" : "pointer",
                }}>{saving ? "SAVING…" : "SAVE"}</button>
                <button onClick={handleCancel} style={{
                  fontFamily: FONTS.mono, fontSize: 10, letterSpacing: "0.08em",
                  background: "transparent", color: "rgba(150,180,220,0.4)", border: "1px solid rgba(0,212,255,0.08)", borderRadius: 4, padding: "5px 14px", cursor: "pointer",
                }}>CANCEL</button>
              </div>
            </div>
            <textarea
              value={editText}
              onChange={e => setEditText(e.target.value)}
              style={{
                flex: 1, width: "100%", background: "rgba(0,212,255,0.03)", border: "1px solid rgba(0,212,255,0.1)", borderRadius: 6, padding: 16,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: 13, color: "rgba(200,230,255,0.85)", lineHeight: 1.6, resize: "none", outline: "none",
              }}
            />
          </div>
        ) : (
          <div>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <div>
                <div style={{ fontFamily: "'Inter Tight', 'Inter', sans-serif", fontSize: 22, fontWeight: 600, color: "rgba(200,230,255,0.95)", lineHeight: 1.2 }}>{content.title}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
                  <span style={{
                    fontFamily: FONTS.mono, fontSize: 8, letterSpacing: "0.06em", textTransform: "uppercase",
                    background: `${AGENT_COLORS[content.path?.split("/")[0]] || "#A78BFA"}15`, color: AGENT_COLORS[content.path?.split("/")[0]] || "#A78BFA",
                    border: `1px solid ${AGENT_COLORS[content.path?.split("/")[0]] || "#A78BFA"}25`, borderRadius: 3, padding: "2px 7px",
                  }}>{content.path?.split("/")[0] || "unknown"}</span>
                  <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(150,180,220,0.35)" }}>{formatDate(content.modified_at)}</span>
                  <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(150,180,220,0.25)" }}>{(content.size || 0).toLocaleString()} bytes</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => { setMode("edit"); setEditText(content.content || ""); }}
                  style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: "0.06em", background: "rgba(0,212,255,0.08)", color: "#00d4ff", border: "1px solid rgba(0,212,255,0.2)", borderRadius: 4, padding: "5px 12px", cursor: "pointer" }}
                >EDIT</button>
              </div>
            </div>
            {/* Rendered markdown */}
            <div
              ref={contentRef}
              style={{ fontFamily: FONTS.sans, fontSize: 14, lineHeight: 1.7, color: "rgba(200,230,255,0.7)" }}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(content.content || "") }}
            />
          </div>
        )}
      </div>
    </div>
      )}
    </PanelLayout>
  );
}