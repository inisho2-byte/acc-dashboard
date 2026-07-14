import { useState, useRef, useCallback } from "react";
import DOMPurify from "dompurify";
import * as api from "../api";
import { FONTS, SOURCE_COLORS } from "../styles/theme.js";
import PanelLayout from "../components/PanelLayout";
import EmptyState from "../components/EmptyState";

export default function SearchPanel() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sourceFilter, setSourceFilter] = useState("");
  const [copiedId, setCopiedId] = useState(null);
  const inputRef = useRef(null);

  const doSearch = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    const res = await api.search(query.trim(), 30, sourceFilter || null);
    setResults(res);
    setLoading(false);
  }, [query, sourceFilter]);

  const handleSubmit = useCallback(e => {
    e.preventDefault();
    doSearch();
  }, [doSearch]);

  const searchForm = (
    <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8 }}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search sessions, messages, vault..."
        style={{ flex: 1, padding: "8px 12px", background: "rgba(0,212,255,0.06)", border: "1px solid rgba(0,212,255,0.2)", borderRadius: 4, fontFamily: FONTS.mono, fontSize: 11, color: "#e8f4fd", outline: "none" }}
      />
      <select
        value={sourceFilter}
        onChange={e => setSourceFilter(e.target.value)}
        style={{ padding: "6px 10px", background: "rgba(0,212,255,0.06)", border: "1px solid rgba(0,212,255,0.2)", borderRadius: 4, fontFamily: FONTS.mono, fontSize: 10, color: "#e8f4fd", outline: "none", cursor: "pointer" }}
      >
        <option value="">all</option>
        <option value="session">sessions</option>
        <option value="discord">discord</option>
        <option value="vault">vault</option>
        <option value="error">error</option>
        <option value="cron">cron</option>
      </select>
      <button
        type="submit"
        disabled={loading || !query.trim()}
        style={{ padding: "8px 14px", background: loading ? "rgba(0,212,255,0.08)" : "rgba(0,212,255,0.2)", border: "1px solid rgba(0,212,255,0.4)", borderRadius: 4, color: loading ? "rgba(0,212,255,0.4)" : "#00d4ff", fontFamily: FONTS.mono, fontSize: 10, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", letterSpacing: "0.08em" }}
      >
        {loading ? "..." : "SEARCH"}
      </button>
    </form>
  );

  return (
    <PanelLayout
      title="SEARCH"
      icon="⌕"
      accentColor="#2dd4bf"
    >
      {/* Search form lives outside PanelLayout's content scroll to stay fixed at top */}
      {searchForm}

      {results && (
        <div style={{ flex: 1, overflowY: "auto" }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.5)", letterSpacing: "0.1em", marginBottom: 8 }}>
            {results.total ?? 0} RESULTS · {Object.entries(results.sources || {}).map(([k, v]) => `${k}: ${v}`).join(" · ")}
          </div>
          {results.results?.length === 0 && (
            <EmptyState
              icon="⌕"
              title="No results"
              description="Try a different search query or source filter"
            />
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {results.results?.map((r, i) => (
              <div key={r.id || i} className="fade-up" style={{ animationDelay: `${i * 50}ms`, padding: "10px 12px", borderRadius: 6, background: "rgba(0,212,255,0.03)", border: "1px solid rgba(0,212,255,0.08)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span className="label-tag" style={{ background: `${SOURCE_COLORS[r.source] || "#888"}15`, color: SOURCE_COLORS[r.source] || "#888", border: `1px solid ${SOURCE_COLORS[r.source] || "#888"}30` }}>{r.source}</span>
                  <span style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(150,180,220,0.3)" }}>{r.score?.toFixed?.(2) ?? "—"}</span>
                </div>
                <div style={{ fontFamily: FONTS.sans, fontSize: 12, fontWeight: 500, color: "rgba(200,230,255,0.85)", marginBottom: 2 }}>{r.title}</div>
                <div style={{ fontFamily: FONTS.sans, fontSize: 11, color: "rgba(150,180,220,0.5)", lineHeight: 1.4 }}>{DOMPurify.sanitize(r.snippet || "")}</div>
                {(r.action_url || r.action_label) && (
                  <div style={{ marginTop: 6 }}>
                    {(() => {
                      const sc = SOURCE_COLORS[r.source] || "#888";
                      if (r.action_url?.startsWith("http://") || r.action_url?.startsWith("https://")) {
                        return <a href={r.action_url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", fontSize: 9, color: sc, border: `1px solid ${sc}30`, background: `${sc}10`, padding: "3px 8px", borderRadius: 3, cursor: "pointer", textDecoration: "none" }}>{r.action_label}</a>;
                      }
                      if (r.action_url?.startsWith("obsidian://")) {
                        return <a href={r.action_url} style={{ display: "inline-block", fontSize: 9, color: sc, border: `1px solid ${sc}30`, background: `${sc}10`, padding: "3px 8px", borderRadius: 3, cursor: "pointer", textDecoration: "none" }}>{r.action_label}</a>;
                      }
                      if (!r.action_url && r.action_label) {
                        const isCopied = copiedId === `${r.id || i}`;
                        return (
                          <span
                            onClick={() => {
                              navigator.clipboard.writeText(r.action_label);
                              setCopiedId(`${r.id || i}`);
                              setTimeout(() => setCopiedId(null), 2000);
                            }}
                            style={{ display: "inline-block", fontSize: 9, color: sc, border: `1px solid ${sc}30`, background: `${sc}10`, padding: "3px 8px", borderRadius: 3, cursor: "pointer", textDecoration: "none" }}
                          >
                            {isCopied ? "copied!" : r.action_label}
                          </span>
                        );
                      }
                      return null;
                    })()}
                  </div>
                )}
                {r.timestamp && (
                  <div style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(150,180,220,0.3)", marginTop: 3 }}>{new Date(r.timestamp).toLocaleString()}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!results && !loading && (
        <EmptyState
          icon="⌕"
          title="Enter query to search"
          description="Indexes sessions, Discord messages, and vault files"
        />
      )}
    </PanelLayout>
  );
}