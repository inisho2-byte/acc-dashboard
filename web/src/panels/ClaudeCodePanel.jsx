import { useState, useEffect, useCallback } from 'react';
import {
  getClaudeSessions, getClaudeTasks, getClaudePlans, getClaudePlanContent,
  getClaudeSkills, getClaudeSettings, getClaudeFileHistory
} from '../api.js';

const POLL_MS = 30000; // 30s refresh

function StatusDot({ status }) {
  const color = status === 'active' ? '#4caf50' : status === 'idle' ? '#ff9800' : '#666';
  return <span style={{
    display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
    backgroundColor: color, marginRight: 6, verticalAlign: 'middle'
  }} />;
}

function relativeTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function TaskBadge({ status }) {
  const colors = {
    pending: '#666', in_progress: '#2196f3', completed: '#4caf50', blocked: '#f44336'
  };
  return <span style={{
    display: 'inline-block', padding: '2px 8px', borderRadius: 4,
    backgroundColor: colors[status] || '#666', color: '#fff', fontSize: 11,
    fontWeight: 600, textTransform: 'uppercase', marginLeft: 6
  }}>{status.replace('_', ' ')}</span>;
}

// ── Sessions View ──────────────────────────────────────────────────────
function SessionsView({ sessions }) {
  if (!sessions.length) return <div style={{ color: '#888', padding: 20 }}>No Claude Code sessions found.</div>;
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    {sessions.map(s => (
      <div key={s.id} style={{
        background: '#1a1d23', borderRadius: 8, padding: '12px 16px',
        border: '1px solid #2a2d35'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <StatusDot status={s.status} />
          <span style={{ fontWeight: 600, color: '#e0e0e0' }}>{s.display_cwd || s.cwd}</span>
          <span style={{ color: '#888', fontSize: 12 }}>v{s.version || '?'}</span>
          <span style={{ color: '#888', fontSize: 12, marginLeft: 'auto' }}>
            PID {s.pid || '?'} · {s.kind || 'session'} · {relativeTime(s.updated_at)}
          </span>
        </div>
        {s.last_prompt && <div style={{
          color: '#aaa', fontSize: 13, marginTop: 4, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap'
        }}>{s.last_prompt}</div>}
        <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 12, color: '#666' }}>
          <span>{s.task_count} tasks</span>
        </div>
      </div>
    ))}
  </div>;
}

// ── Tasks View ──────────────────────────────────────────────────────────
function TasksView({ tasks }) {
  const [filter, setFilter] = useState('all');
  const filtered = filter === 'all' ? tasks : tasks.filter(t => t.status === filter);
  const counts = { all: tasks.length, pending: 0, in_progress: 0, completed: 0, blocked: 0 };
  tasks.forEach(t => { if (counts[t.status] !== undefined) counts[t.status]++; });

  return <div>
    <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
      {['all', 'pending', 'in_progress', 'completed', 'blocked'].map(f => (
        <button key={f} onClick={() => setFilter(f)} style={{
          padding: '4px 12px', borderRadius: 4, border: 'none', cursor: 'pointer',
          backgroundColor: filter === f ? '#2196f3' : '#2a2d35', color: filter === f ? '#fff' : '#aaa',
          fontSize: 12
        }}>{f.replace('_', ' ')} ({counts[f] ?? 0})</button>
      ))}
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {filtered.map(t => (
        <div key={`${t.session_id}-${t.id}`} style={{
          background: '#1a1d23', borderRadius: 6, padding: '8px 12px',
          border: '1px solid #2a2d35', display: 'flex', alignItems: 'center'
        }}>
          <span style={{ color: '#e0e0e0', fontSize: 13 }}>{t.subject}</span>
          <TaskBadge status={t.status} />
        </div>
      ))}
    </div>
  </div>;
}

// ── Plans View ──────────────────────────────────────────────────────────
function PlansView({ plans, onSelectPlan }) {
  if (!plans.length) return <div style={{ color: '#888', padding: 20 }}>No plans found.</div>;
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
    {plans.map(p => (
      <div key={p.filename} onClick={() => onSelectPlan(p.filename)} style={{
        background: '#1a1d23', borderRadius: 8, padding: 12, border: '1px solid #2a2d35',
        cursor: 'pointer'
      }}>
        <div style={{ fontWeight: 600, color: '#e0e0e0', fontSize: 14 }}>{p.title}</div>
        <div style={{ color: '#888', fontSize: 11, marginTop: 4 }}>{p.filename} · {relativeTime(p.mtime)}</div>
        {p.content_preview && <div style={{
          color: '#aaa', fontSize: 12, marginTop: 6, overflow: 'hidden',
          textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical'
        }}>{p.content_preview}</div>}
      </div>
    ))}
  </div>;
}

// ── Skills View ─────────────────────────────────────────────────────────
function SkillsView({ skills }) {
  if (!skills.length) return <div style={{ color: '#888', padding: 20 }}>No Claude Code skills found.</div>;
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    {skills.map(s => (
      <div key={s.name} style={{
        background: '#1a1d23', borderRadius: 6, padding: '8px 12px',
        border: '1px solid #2a2d35'
      }}>
        <span style={{ fontWeight: 600, color: '#e0e0e0' }}>{s.name}</span>
        {s.description && <span style={{ color: '#aaa', fontSize: 12, marginLeft: 8 }}>{s.description.slice(0, 80)}</span>}
      </div>
    ))}
  </div>;
}

// ── Settings View ───────────────────────────────────────────────────────
function SettingsView({ settings }) {
  if (!settings || !settings.permissions_summary) return <div style={{ color: '#888', padding: 20 }}>No settings found.</div>;
  const ps = settings.permissions_summary;
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    <div>
      <div style={{ color: '#e0e0e0', fontWeight: 600, marginBottom: 4 }}>Version</div>
      <div style={{ color: '#aaa', fontSize: 13 }}>{settings.version || 'unknown'}</div>
    </div>
    <div>
      <div style={{ color: '#e0e0e0', fontWeight: 600, marginBottom: 4 }}>Effort Level</div>
      <div style={{ color: '#aaa', fontSize: 13 }}>{settings.effort_level || 'unknown'}</div>
    </div>
    <div>
      <div style={{ color: '#e0e0e0', fontWeight: 600, marginBottom: 4 }}>Theme</div>
      <div style={{ color: '#aaa', fontSize: 13 }}>{settings.theme || 'unknown'}</div>
    </div>
    <div>
      <div style={{ color: '#e0e0e0', fontWeight: 600, marginBottom: 4 }}>Hooks</div>
      <div style={{ color: '#aaa', fontSize: 13 }}>{settings.hooks_count} hook groups</div>
    </div>
    <div>
      <div style={{ color: '#e0e0e0', fontWeight: 600, marginBottom: 4 }}>Permissions Mode</div>
      <div style={{ color: '#2196f3', fontSize: 13, fontWeight: 600 }}>{ps.mode}</div>
    </div>
    <div>
      <div style={{ color: '#4caf50', fontWeight: 600, marginBottom: 4 }}>Allowed</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {ps.allowed_categories.map(c => (
          <span key={c} style={{ background: '#1a2e1a', color: '#4caf50', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>{c}</span>
        ))}
      </div>
    </div>
    <div>
      <div style={{ color: '#f44336', fontWeight: 600, marginBottom: 4 }}>Denied</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {ps.denied_categories.map(c => (
          <span key={c} style={{ background: '#2e1a1a', color: '#f44336', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>{c}</span>
        ))}
      </div>
    </div>
  </div>;
}

// ── File History View ──────────────────────────────────────────────────
function FileHistoryView({ files }) {
  if (!files.length) return <div style={{ color: '#888', padding: 20 }}>No file history found for this session.</div>;
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    {files.map(f => (
      <div key={`${f.file_hash}-${f.version}`} style={{
        background: '#1a1d23', borderRadius: 4, padding: '6px 12px',
        border: '1px solid #2a2d35', fontSize: 12,
        display: 'flex', justifyContent: 'space-between'
      }}>
        <span style={{ color: '#e0e0e0' }}>{f.file_hash.slice(0, 12)}@v{f.version}</span>
        <span style={{ color: '#888' }}>{(f.size_bytes / 1024).toFixed(1)} KB · {relativeTime(f.mtime)}</span>
      </div>
    ))}
  </div>;
}

// ── Main Panel ──────────────────────────────────────────────────────────
const TABS = ['sessions', 'tasks', 'plans', 'skills', 'settings'];

export default function ClaudeCodePanel() {
  const [tab, setTab] = useState('sessions');
  const [sessions, setSessions] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [plans, setPlans] = useState([]);
  const [skills, setSkills] = useState([]);
  const [settings, setSettings] = useState(null);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [planContent, setPlanContent] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [s, t, p, sk, st] = await Promise.all([
        getClaudeSessions(),
        getClaudeTasks(),
        getClaudePlans(),
        getClaudeSkills(),
        getClaudeSettings(),
      ]);
      if (s) setSessions(s);
      if (t) setTasks(t);
      if (p) setPlans(p);
      if (sk) setSkills(sk);
      if (st) setSettings(st);
    } catch (e) {
      console.warn('Claude Code fetch error:', e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); const iv = setInterval(refresh, POLL_MS); return () => clearInterval(iv); }, [refresh]);

  const handleSelectPlan = async (filename) => {
    setSelectedPlan(filename);
    const data = await getClaudePlanContent(filename);
    if (data) setPlanContent(data.content);
  };

  if (loading && !sessions.length) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading Claude Code data...</div>;
  }

  return <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
    <div style={{
      display: 'flex', gap: 4, marginBottom: 12, padding: '0 4px',
      borderBottom: '1px solid #2a2d35'
    }}>
      {TABS.map(t => (
        <button key={t} onClick={() => { setTab(t); setSelectedPlan(null); }} style={{
          padding: '6px 14px', border: 'none', cursor: 'pointer',
          background: tab === t ? '#1a6fb5' : 'transparent',
          color: tab === t ? '#fff' : '#888', borderRadius: '4px 4px 0 0',
          fontSize: 13, fontWeight: tab === t ? 600 : 400
        }}>{t.toUpperCase()}</button>
      ))}
    </div>

    <div style={{ flex: 1, overflow: 'auto', padding: '0 4px' }}>
      {selectedPlan && tab === 'plans' ? (
        <div>
          <button onClick={() => setSelectedPlan(null)} style={{
            background: 'none', border: '1px solid #444', color: '#aaa', padding: '4px 12px',
            borderRadius: 4, cursor: 'pointer', marginBottom: 12, fontSize: 12
          }}>← Back to plans</button>
          <pre style={{
            color: '#ccc', fontSize: 12, background: '#1a1d23', padding: 16,
            borderRadius: 8, overflow: 'auto', maxHeight: '80vh', whiteSpace: 'pre-wrap'
          }}>{planContent}</pre>
        </div>
      ) : tab === 'sessions' ? <SessionsView sessions={sessions} />
      : tab === 'tasks' ? <TasksView tasks={tasks} />
      : tab === 'plans' ? <PlansView plans={plans} onSelectPlan={handleSelectPlan} />
      : tab === 'skills' ? <SkillsView skills={skills} />
      : tab === 'settings' ? <SettingsView settings={settings} />
      : null}
    </div>
  </div>;
}