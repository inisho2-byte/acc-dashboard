import { useState, useEffect, useMemo, useRef } from "react";
import { FONTS } from "../styles/theme.js";

export default function CommandPalette({ sessions, projects, skills, agents, errors, activeTab, onNavigate, onRunSkill, onClose }) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const commands = useMemo(() => {
    const q = query.trim().toLowerCase();
    const cmds = [];

    // Navigation
    const tabs = [
      { label: "Go to Sessions", action: "tab", data: "sessions", icon: "→" },
      { label: "Go to Errors", action: "tab", data: "errors", icon: "→" },
      { label: "Go to Skills", action: "tab", data: "skills", icon: "→" },
      { label: "Go to Search", action: "tab", data: "search", icon: "→" },
      { label: "Go to Briefing", action: "tab", data: "briefing", icon: "→" },
      { label: "Go to Dashboard", action: "tab", data: "errors-dashboard", icon: "→" },
    ];
    cmds.push(...tabs);

    // Sessions
    if (sessions?.length) {
      sessions.forEach(s => {
        cmds.push({
          label: `Open session: ${s.title || s.preview || s.id || "Untitled"}`,
          action: "session",
          data: s,
          icon: "◈",
        });
      });
    }

    // Projects
    if (projects?.length) {
      projects.forEach(p => {
        cmds.push({
          label: `Open project: ${p.slug || p.name || "Untitled"}`,
          action: "project",
          data: p,
          icon: "◆",
        });
      });
    }

    // Skills
    if (skills?.length) {
      skills.forEach(sk => {
        cmds.push({
          label: `Run skill: ${sk.name}`,
          action: "skill",
          data: sk.name,
          icon: "▸",
        });
      });
    }

    // Agents
    if (agents?.length) {
      agents.forEach(a => {
        cmds.push({
          label: `Go to agent: ${a.name || a.id}`,
          action: "tab",
          data: "sessions",
          extra: () => {},
          icon: "●",
        });
      });
    }

    if (!q) return cmds;
    return cmds.filter(c => c.label.toLowerCase().includes(q));
  }, [query, sessions, projects, skills, agents, errors, activeTab]);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex(i => (i + 1) % commands.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(i => (i - 1 + commands.length) % commands.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const cmd = commands[selectedIndex];
        if (cmd) execute(cmd);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [commands, selectedIndex, onClose]);

  const execute = (cmd) => {
    if (cmd.action === "tab") onNavigate("tab", cmd.data);
    else if (cmd.action === "session") onNavigate("session", cmd.data);
    else if (cmd.action === "project") onNavigate("project", cmd.data);
    else if (cmd.action === "skill") onRunSkill(cmd.data);
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 160, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} />
      <div className="panel palette-enter" style={{ position: "relative", width: 520, maxWidth: "90vw", display: "flex", flexDirection: "column", maxHeight: "70vh" }} onClick={e => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Type a command..."
          style={{
            width: "100%",
            padding: "10px 14px",
            background: "transparent",
            border: "none",
            borderBottom: "1px solid rgba(0,212,255,0.2)",
            fontFamily: FONTS.mono,
            fontSize: 12,
            color: "#e8f4fd",
            outline: "none",
          }}
        />
        <div style={{ overflowY: "auto", flex: 1 }}>
          {commands.length === 0 && (
            <div style={{ padding: 16, textAlign: "center", fontFamily: FONTS.mono, fontSize: 10, color: "rgba(150,180,220,0.4)" }}>
              No matching commands
            </div>
          )}
          {commands.map((cmd, i) => (
            <div
              key={`${cmd.label}-${i}`}
              onClick={() => execute(cmd)}
              onMouseEnter={() => setSelectedIndex(i)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 14px",
                cursor: "pointer",
                background: i === selectedIndex ? "rgba(0,212,255,0.1)" : "transparent",
                borderBottom: "1px solid rgba(0,212,255,0.06)",
              }}
            >
              <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: "rgba(0,212,255,0.5)", width: 20, textAlign: "center" }}>{cmd.icon}</span>
              <span style={{ fontFamily: FONTS.sans, fontSize: 12, color: i === selectedIndex ? "#00d4ff" : "rgba(200,230,255,0.8)" }}>{cmd.label}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 12, padding: "6px 14px", borderTop: "1px solid rgba(0,212,255,0.1)", fontFamily: FONTS.mono, fontSize: 8, color: "rgba(150,180,220,0.35)" }}>
          <span>↑↓ to navigate</span>
          <span>↵ to run</span>
          <span>Esc to close</span>
        </div>
      </div>
    </div>
  );
}
