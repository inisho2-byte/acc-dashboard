import { useState, useEffect, useCallback } from "react";
import * as api from "../api.js";
import { FONTS } from "../styles/theme.js";
import PanelLayout from "../components/PanelLayout";
import EmptyState from "../components/EmptyState";

const COLUMNS = [
  { key: "pending", label: "PENDING", color: "#f59e0b" },
  { key: "in_progress", label: "IN PROGRESS", color: "#00d4ff" },
  { key: "done", label: "DONE", color: "#00ff88" },
];

const PRIORITY_CHIP = {
  low: { bg: "rgba(0,212,255,0.08)", color: "#7dd3fc", border: "rgba(0,212,255,0.2)" },
  medium: { bg: "rgba(245,158,11,0.08)", color: "#f59e0b", border: "rgba(245,158,11,0.2)" },
  high: { bg: "rgba(255,68,68,0.08)", color: "#ff4444", border: "rgba(255,68,68,0.2)" },
};

function relativeTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  } catch { return ""; }
}

function TaskCard({ task, onMoveBack, onMoveForward, onDelete }) {
  const chip = PRIORITY_CHIP[task.priority] || PRIORITY_CHIP.medium;
  return (
    <div className="panel" style={{ padding: 12, marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ fontFamily: "'Inter Tight', 'Inter', sans-serif", fontSize: 14, fontWeight: 500, color: "rgba(200,230,255,0.9)", lineHeight: 1.3, flex: 1 }}>{task.title}</div>
        <span style={{
          fontFamily: FONTS.mono, fontSize: 8, letterSpacing: "0.06em",
          background: chip.bg, color: chip.color, border: `1px solid ${chip.border}`,
          borderRadius: 3, padding: "2px 6px", flexShrink: 0, textTransform: "uppercase",
        }}>{task.priority}</span>
      </div>
      {task.notes && (
        <div style={{ fontFamily: FONTS.sans, fontSize: 12, color: "rgba(150,180,220,0.45)", marginTop: 6, lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{task.notes}</div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, paddingTop: 6, borderTop: "1px solid rgba(0,212,255,0.05)" }}>
        <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: "rgba(150,180,220,0.3)" }}>{relativeTime(task.updated_at || task.created_at)}</span>
        <div style={{ display: "flex", gap: 4 }}>
          {task.status !== "pending" && (
            <button onClick={() => onMoveBack(task.id)} style={actionBtnStyle} title="Move back">◀</button>
          )}
          {task.status !== "done" && (
            <button onClick={() => onMoveForward(task.id)} style={actionBtnStyle} title="Move forward">▶</button>
          )}
          <button onClick={() => onDelete(task.id)} style={{...actionBtnStyle, color: "rgba(255,68,68,0.6)"}} title="Delete">✕</button>
        </div>
      </div>
    </div>
  );
}

const actionBtnStyle = {
  background: "none", border: "1px solid rgba(0,212,255,0.08)", borderRadius: 3,
  color: "rgba(200,230,255,0.5)", fontSize: 11, cursor: "pointer", padding: "1px 5px",
  transition: "all 0.15s ease", fontFamily: FONTS.mono,
};

function AddTaskForm({ onSave, onCancel }) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("medium");
  const [notes, setNotes] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({ title: title.trim(), priority, notes: notes.trim() || null });
  };

  return (
    <div className="panel" style={{ padding: 14, marginBottom: 8, borderLeft: "2px solid #00d4ff" }}>
      <form onSubmit={handleSubmit}>
        <input
          value={title} onChange={e => setTitle(e.target.value)} placeholder="Task title…"
          autoFocus
          style={{ width: "100%", background: "rgba(0,212,255,0.04)", border: "1px solid rgba(0,212,255,0.12)", borderRadius: 4, padding: "6px 10px", color: "rgba(200,230,255,0.9)", fontFamily: "'Inter Tight', 'Inter', sans-serif", fontSize: 13, outline: "none", marginBottom: 8 }}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <select value={priority} onChange={e => setPriority(e.target.value)} style={{ background: "rgba(0,212,255,0.04)", border: "1px solid rgba(0,212,255,0.12)", borderRadius: 4, padding: "4px 8px", color: "rgba(200,230,255,0.7)", fontFamily: FONTS.mono, fontSize: 10, outline: "none" }}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        <textarea
          value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional)…"
          rows={2}
          style={{ width: "100%", background: "rgba(0,212,255,0.04)", border: "1px solid rgba(0,212,255,0.12)", borderRadius: 4, padding: "6px 10px", color: "rgba(200,230,255,0.7)", fontFamily: FONTS.sans, fontSize: 12, outline: "none", resize: "vertical", marginBottom: 8 }}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: "0.08em", background: "rgba(0,212,255,0.12)", color: "#00d4ff", border: "1px solid rgba(0,212,255,0.25)", borderRadius: 4, padding: "5px 14px", cursor: "pointer" }}>SAVE</button>
          <button type="button" onClick={onCancel} style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: "0.08em", background: "transparent", color: "rgba(150,180,220,0.4)", border: "1px solid rgba(0,212,255,0.08)", borderRadius: 4, padding: "5px 14px", cursor: "pointer" }}>CANCEL</button>
        </div>
      </form>
    </div>
  );
}

export default function TasksPanel() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const fetchTasks = useCallback(async () => {
    try {
      const data = await api.getBoard();
      setTasks(data);
      setLoading(false);
    } catch { /* retry next cycle */ }
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const handleCreate = async ({ title, priority, notes }) => {
    setShowForm(false);
    // Optimistic: add local placeholder
    const tempId = "temp-" + Date.now();
    const now = new Date().toISOString();
    const optimistic = { id: tempId, title, priority, status: "pending", notes, created_at: now, updated_at: now };
    setTasks(prev => [...prev, optimistic]);
    try {
      await api.createBoardTask(title, priority, notes);
      await fetchTasks();
    } catch {
      await fetchTasks(); // revert on failure
    }
  };

  const handleMoveForward = async (taskId) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const order = ["pending", "in_progress", "done"];
    const idx = order.indexOf(task.status);
    if (idx >= order.length - 1) return;
    const newStatus = order[idx + 1];
    // Optimistic
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t));
    try {
      await api.moveBoardTask(taskId, 1);
      await fetchTasks();
    } catch {
      await fetchTasks();
    }
  };

  const handleMoveBack = async (taskId) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const order = ["pending", "in_progress", "done"];
    const idx = order.indexOf(task.status);
    if (idx <= 0) return;
    const newStatus = order[idx - 1];
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t));
    try {
      await api.moveBoardTask(taskId, -1);
      await fetchTasks();
    } catch {
      await fetchTasks();
    }
  };

  const handleDelete = async (taskId) => {
    setTasks(prev => prev.filter(t => t.id !== taskId));
    try {
      await api.deleteBoardTask(taskId);
      await fetchTasks();
    } catch {
      await fetchTasks();
    }
  };

  const grouped = {};
  for (const col of COLUMNS) grouped[col.key] = tasks.filter(t => t.status === col.key);

  const panelStats = [
    { label: "Pending", value: grouped.pending?.length || 0 },
    { label: "In Progress", value: grouped.in_progress?.length || 0 },
    { label: "Done", value: grouped.done?.length || 0 },
  ];

  const actions = (
    <button
      onClick={() => setShowForm(true)}
      style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: "0.08em", background: "rgba(245,158,11,0.08)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 6, padding: "6px 14px", cursor: "pointer" }}
    >+ Add task</button>
  );

  return (
    <PanelLayout
      title="TASKS"
      icon="☐"
      accentColor="#f59e0b"
      loading={loading}
      stats={panelStats}
      actions={actions}
    >
      {/* 3-column board */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, alignItems: "start" }}>
        {COLUMNS.map(col => {
          const colTasks = grouped[col.key] || [];
          return (
            <div key={col.key}>
              {/* Column header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, paddingBottom: 6, borderBottom: `1px solid ${col.color}25` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: col.color, letterSpacing: "0.12em" }}>{col.label}</span>
                  <span style={{ fontFamily: FONTS.mono, fontSize: 9, background: `${col.color}15`, color: col.color, border: `1px solid ${col.color}25`, borderRadius: 3, padding: "1px 6px" }}>{colTasks.length}</span>
                </div>
              </div>
              {/* Add form in Pending column */}
              {col.key === "pending" && showForm && (
                <AddTaskForm onSave={handleCreate} onCancel={() => setShowForm(false)} />
              )}
              {/* Cards */}
              {colTasks.length === 0 && !showForm && (
                <EmptyState icon="☐" title="No tasks" description="Tasks will appear here" />
              )}
              {colTasks.map(task => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onMoveBack={handleMoveBack}
                  onMoveForward={handleMoveForward}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          );
        })}
      </div>
    </PanelLayout>
  );
}