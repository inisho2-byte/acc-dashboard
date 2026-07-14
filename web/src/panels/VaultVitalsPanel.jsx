import { useState, useEffect } from "react";
import * as api from "../api.js";
import { FONTS } from "../styles/theme.js";
import PanelLayout from "../components/PanelLayout";
import EmptyState from "../components/EmptyState";

export default function VaultVitalsPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const fetchVaultVitals = async () => {
      try {
        const res = await api.getVaultVitals();
        if (!cancelled) {
          setData(res);
          setLastUpdated(Date.now());
        }
      } catch {
        // Vault vitals may be unavailable
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchVaultVitals();
    const interval = setInterval(fetchVaultVitals, 60000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const relativeTime = (dateStr) => {
    if (!dateStr) return "—";
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diffMs = now - then;
    if (diffMs < 0) return "just now";
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  const renderGrowthBadge = (growthRate) => {
    if (growthRate === null || growthRate === undefined) {
      return <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(150,180,220,0.35)", padding: "2px 6px", borderRadius: 4, background: "rgba(150,180,220,0.06)", border: "1px solid rgba(150,180,220,0.1)" }}>→ 0%</span>;
    }
    const isPos = growthRate > 0;
    const isNeg = growthRate < 0;
    const color = isPos ? "#00ff88" : isNeg ? "#ff4444" : "rgba(150,180,220,0.5)";
    const arrow = isPos ? "↑" : isNeg ? "↓" : "→";
    const bg = isPos ? "rgba(0,255,136,0.08)" : isNeg ? "rgba(255,68,68,0.08)" : "rgba(150,180,220,0.06)";
    const borderColor = isPos ? "rgba(0,255,136,0.2)" : isNeg ? "rgba(255,68,68,0.2)" : "rgba(150,180,220,0.1)";
    return (
      <span style={{ fontFamily: FONTS.mono, fontSize: 9, color, padding: "2px 6px", borderRadius: 4, background: bg, border: `1px solid ${borderColor}` }}>
        {arrow} {Math.abs(growthRate).toFixed(1)}%
      </span>
    );
  };

  // Build stats for PanelLayout header strip
  const stats = data ? [
    { label: "Entities", value: data.entity_count ?? "—" },
    { label: "Files", value: data.file_count ?? "—" },
    { label: "Size", value: data.total_size ?? "—" },
  ] : [];

  const hasData = !loading && data;

  return (
    <PanelLayout
      title="VAULT"
      icon="◆"
      accentColor="#2dd4bf"
      loading={loading && !data}
      lastUpdated={lastUpdated}
      stats={stats}
    >
      {hasData ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Entity count + growth */}
          <div className="panel" style={{ padding: "12px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.5)", letterSpacing: "0.12em", marginBottom: 4 }}>
                  ENTITIES
                </div>
                <div style={{ fontFamily: FONTS.mono, fontSize: 28, fontWeight: 700, color: "#00d4ff", lineHeight: 1 }}>
                  {data.entity_count ?? "—"}
                </div>
              </div>
              {renderGrowthBadge(data.growth_rate)}
            </div>
          </div>

          {/* Warning badges row */}
          <div style={{ display: "flex", gap: 8 }}>
            <div className="panel" style={{ flex: 1, padding: "10px 12px", textAlign: "center" }}>
              <div style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(245,158,11,0.6)", letterSpacing: "0.1em", marginBottom: 4 }}>STALE</div>
              <div style={{ fontFamily: FONTS.mono, fontSize: 18, fontWeight: 700, color: "#f59e0b" }}>
                {data.stale_notes ?? "—"}
              </div>
              <div style={{ fontFamily: FONTS.mono, fontSize: 7, color: "rgba(245,158,11,0.4)" }}>&gt;30 days</div>
            </div>
            <div className="panel" style={{ flex: 1, padding: "10px 12px", textAlign: "center" }}>
              <div style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(255,68,68,0.6)", letterSpacing: "0.1em", marginBottom: 4 }}>ORPHANED</div>
              <div style={{ fontFamily: FONTS.mono, fontSize: 18, fontWeight: 700, color: "#ff4444" }}>
                {data.orphaned_notes ?? "—"}
              </div>
              <div style={{ fontFamily: FONTS.mono, fontSize: 7, color: "rgba(255,68,68,0.4)" }}>no links</div>
            </div>
          </div>

          {/* Top linked entities */}
          <div className="panel" style={{ padding: "12px 14px" }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.5)", letterSpacing: "0.14em", marginBottom: 8 }}>
              TOP LINKED
            </div>
            {(data.top_linked || []).slice(0, 10).map((entity, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", borderBottom: i < Math.min((data.top_linked || []).length, 10) - 1 ? "1px solid rgba(0,212,255,0.05)" : "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
                  <span style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(150,180,220,0.3)", width: 16, textAlign: "right", flexShrink: 0 }}>
                    {i + 1}
                  </span>
                  <span style={{ fontFamily: FONTS.sans, fontSize: 11, color: "rgba(200,230,255,0.85)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {entity.name}
                  </span>
                </div>
                <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: "#00d4ff", flexShrink: 0, marginLeft: 8 }}>
                  {entity.incoming_links} links
                </span>
              </div>
            ))}
            {(!data.top_linked || data.top_linked.length === 0) && (
              <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(150,180,220,0.3)", textAlign: "center", padding: 8 }}>
                No linked entities
              </div>
            )}
          </div>

          {/* Recently modified */}
          <div className="panel" style={{ padding: "12px 14px" }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(0,212,255,0.5)", letterSpacing: "0.14em", marginBottom: 8 }}>
              RECENTLY MODIFIED
            </div>
            {(data.recently_modified || []).slice(0, 10).map((note, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", borderBottom: i < Math.min((data.recently_modified || []).length, 10) - 1 ? "1px solid rgba(0,212,255,0.05)" : "none" }}>
                <span style={{ fontFamily: FONTS.sans, fontSize: 11, color: "rgba(200,230,255,0.85)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, marginRight: 8 }}>
                  {note.name || note.path}
                </span>
                <span style={{ fontFamily: FONTS.mono, fontSize: 8, color: "rgba(150,180,220,0.35)", flexShrink: 0 }}>
                  {relativeTime(note.modified)}
                </span>
              </div>
            ))}
            {(!data.recently_modified || data.recently_modified.length === 0) && (
              <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(150,180,220,0.3)", textAlign: "center", padding: 8 }}>
                No recent modifications
              </div>
            )}
          </div>
        </div>
      ) : !loading ? (
        <EmptyState icon="◆" title="No vault data available" description="Vault vitals could not be loaded. Check that the vault path is configured." />
      ) : null}
    </PanelLayout>
  );
}