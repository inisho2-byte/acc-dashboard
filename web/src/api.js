const API = '/api';

// ── Auth Token ───────────────────────────────────────────
// A2: Bearer token from localStorage for API authentication.
// If ACC_API_TOKEN env var is set on server, all /api/* routes require it.
function getAuthToken() {
  try {
    const settings = JSON.parse(localStorage.getItem('acc-settings-v1') || '{}');
    return settings.apiToken || '';
  } catch { return ''; }
}

// HTTP headers must be ISO-8859-1 (Latin-1) — strip any non-ASCII chars
// to prevent TypeError: "String contains non ISO-8859-1 code point"
function sanitizeHeaderValue(value) {
  return value.replace(/[^\x20-\x7E]/g, '');
}

function authHeaders() {
  const token = sanitizeHeaderValue(getAuthToken());
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

// ── Core Fetch Helpers ────────────────────────────────────

export async function fetchJSON(url) {
  try {
    const r = await fetch(url, { headers: authHeaders() });
    if (r.status === 401) {
      console.warn('Auth failed — check API Token in Settings');
      return null;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    console.warn('fetch:', url, e);
    return null;
  }
}

export async function postJSON(url, body = {}) {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
    if (r.status === 401) {
      console.warn('Auth failed — check API Token in Settings');
      return { success: false, error: 'Authentication failed — check API Token' };
    }
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
    }
    return await r.json();
  } catch (e) {
    console.warn('post:', url, e);
    return { success: false, error: String(e) };
  }
}

// ── API Endpoints ─────────────────────────────────────────

export async function getHealth() {
  return fetchJSON(`${API}/health`);
}

export async function getSessions(limit = 10) {
  return fetchJSON(`${API}/sessions?limit=${limit}`);
}

export async function getProjects() {
  return fetchJSON(`${API}/projects`);
}

export async function getProjectDetail(slug) {
  return fetchJSON(`${API}/projects/${encodeURIComponent(slug)}`);
}

export async function getSkills() {
  return fetchJSON(`${API}/skills`);
}

export async function getCron() {
  return fetchJSON(`${API}/cron`);
}

export async function getErrors(limit = 10) {
  return fetchJSON(`${API}/errors?limit=${limit}`);
}

export async function getMonitoring() {
  return fetchJSON(`${API}/monitoring`);
}

export async function activateKillSwitch(adminToken) {
  try {
    const r = await fetch(`${API}/admin/kill-switch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sanitizeHeaderValue(adminToken)}`,
      },
    });
    if (r.status === 401) {
      return { success: false, error: 'Invalid admin token' };
    }
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return { success: false, error: `HTTP ${r.status}: ${text.slice(0, 200)}` };
    }
    return await r.json();
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export async function resetCircuit(circuitName, adminToken) {
  try {
    const r = await fetch(`${API}/admin/circuit/${encodeURIComponent(circuitName)}/reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sanitizeHeaderValue(adminToken)}`,
      },
    });
    return await r.json();
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export async function getActivity(limit = 50) {
  return fetchJSON(`${API}/activity?limit=${limit}`);
}

export async function getAgentActivity(agentId, limit = 50) {
  return fetchJSON(`${API}/activity/${agentId}?limit=${limit}`);
}

export async function getMailbox(limit = 30) {
  return fetchJSON(`${API}/mailbox?limit=${limit}`);
}

export async function getMailboxStats() {
  return fetchJSON(`${API}/mailbox/stats`);
}

export async function getTrading(limit = 50) {
  return fetchJSON(`${API}/trading?limit=${limit}`);
}

// Deprecated aliases — use getMailbox / getMailboxStats
export async function getIBCB(limit = 30) {
  return fetchJSON(`${API}/ibcb?limit=${limit}`);
}

export async function getIBCBStats() {
  return fetchJSON(`${API}/ibcb/stats`);
}

export async function getBriefing(hours = 24) {
  return fetchJSON(`${API}/briefing?hours=${hours}`);
}

export async function getAreteMemory() {
  return fetchJSON(`${API}/memory/arete`);
}

export async function getShuMemory() {
  return fetchJSON(`${API}/memory/shu`);
}

export async function search(q, limit = 30, source = null) {
  let url = `${API}/search?q=${encodeURIComponent(q)}&limit=${limit}`;
  if (source) url += `&source=${source}`;
  return fetchJSON(url);
}

export async function searchRebuild() {
  try {
    const r = await fetch(`${API}/search/rebuild`, { method: 'POST', headers: authHeaders() });
    return await r.json();
  } catch (e) {
    console.warn('search rebuild:', e);
    return { indexed: {} };
  }
}

export async function getContextGaps(limit = 50) {
  return fetchJSON(`${API}/context-gaps?limit=${limit}`);
}

export async function getPipeline() {
  return fetchJSON(`${API}/pipeline`);
}

export async function getAgentModels(agentId) {
  return fetchJSON(`${API}/agents/${encodeURIComponent(agentId)}/models`);
}

export async function swapModel(agentId, model) {
  return postJSON(`${API}/agents/${encodeURIComponent(agentId)}/model`, { model });
}

export async function dispatch(agent, task, skills = null) {
  let url = `${API}/dispatch?agent=${encodeURIComponent(agent)}&task=${encodeURIComponent(task)}`;
  if (skills) url += `&skills=${encodeURIComponent(skills)}`;
  try {
    const r = await fetch(url, { method: 'POST', headers: authHeaders() });
    if (!r.ok) {
      let detail = `HTTP ${r.status}`;
      try { const body = await r.json(); if (body.detail) detail = body.detail; } catch {}
      return { success: false, error: detail };
    }
    return await r.json();
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export async function runSkill(name, task = 'run') {
  try {
    const r = await fetch(`${API}/skills/${encodeURIComponent(name)}/run?task=${encodeURIComponent(task)}`, { method: 'POST', headers: authHeaders() });
    if (!r.ok) {
      let detail = `HTTP ${r.status}`;
      try { const body = await r.json(); if (body.detail) detail = body.detail; } catch {}
      return { success: false, error: detail };
    }
    return await r.json();
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

// ── Group 4: Analytics Endpoints ──────────────────────────

export async function getSkillsUsage() {
  return fetchJSON(`${API}/skills/usage`);
}

export async function getSessionTrends(days = 7) {
  return fetchJSON(`${API}/trends/sessions?days=${days}`);
}

export async function getErrorTrends(days = 7) {
  return fetchJSON(`${API}/trends/errors?days=${days}`);
}

export async function getTrends(days = 7) {
  return fetchJSON(`${API}/trends?days=${days}`);
}

export async function getHealthScore() {
  return fetchJSON(`${API}/health/score`);
}

export async function getVaultVitals() {
  return fetchJSON(`${API}/vault/vitals`);
}

export async function getCronDashboard() {
  return fetchJSON(`${API}/cron/dashboard`);
}

export async function getInferenceUsage() {
  return fetchJSON(`${API}/inference/usage`);
}

// ── Claude Code ───────────────────────────────────────────────────────

export async function getClaudeHealth() {
  return fetchJSON(`${API}/claude-code/health`);
}

export async function getClaudeSessions() {
  return fetchJSON(`${API}/claude-code/sessions`);
}

export async function getClaudeSessionHistory(sessionId, limit = 50) {
  return fetchJSON(`${API}/claude-code/sessions/${sessionId}/history?limit=${limit}`);
}

export async function getClaudeTasks() {
  return fetchJSON(`${API}/claude-code/tasks`);
}

export async function getClaudePlans() {
  return fetchJSON(`${API}/claude-code/plans`);
}

export async function getClaudePlanContent(filename) {
  return fetchJSON(`${API}/claude-code/plans/${encodeURIComponent(filename)}`);
}

export async function getClaudeSkills() {
  return fetchJSON(`${API}/claude-code/skills`);
}

export async function getClaudeSettings() {
  return fetchJSON(`${API}/claude-code/settings`);
}

export async function getClaudeFileHistory(sessionId) {
  return fetchJSON(`${API}/claude-code/file-history/${encodeURIComponent(sessionId)}`);
}

/**
 * SSE EventSource hook for real-time updates.
 * 
 * Usage:
 *   const { cleanup, reconnect } = useSSE('/api/events', (type, data) => { ... }, (state) => setStatus(state));
 *   // Call cleanup() on unmount
 *   // Call reconnect() to force reconnection
 * 
 * Event types received:
 *   - state: Full state snapshot (agents, sessions, projects)
 *   - heartbeat: Keep-alive ping
 *   - agent_status: Agent status change
 *   - session: New session event
 *   - error: Agent error
 *   - circuit: Circuit breaker state change
 *   - project: Project status change
 *   - dispatch: Task dispatch event
 */
export function useSSE(url, onEvent, onConnectionStateChange) {
  if (typeof window === 'undefined') return { cleanup: () => {}, reconnect: () => {} }; // SSR guard

  let es = null;
  let reconnectTimer = null;
  let reconnectDelay = 1000;
  const MAX_DELAY = 30000;

  function setState(state) {
    if (onConnectionStateChange) onConnectionStateChange(state);
  }

  function connect() {
    setState('connecting');
    es = new EventSource(url);

    es.onopen = () => {
      reconnectDelay = 1000;
      setState('live');
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (onEvent) onEvent(event.type || 'message', data);
      } catch {
        if (onEvent) onEvent(event.type || 'message', event.data);
      }
    };

    const eventTypes = ['state', 'agent_status', 'session', 'error', 'circuit', 'project', 'heartbeat', 'dispatch'];
    eventTypes.forEach(type => {
      es.addEventListener(type, (event) => {
        try {
          const data = JSON.parse(event.data);
          if (onEvent) onEvent(type, data);
        } catch {
          if (onEvent) onEvent(type, event.data);
        }
      });
    });

    es.onerror = () => {
      setState('error');
      es?.close();
      reconnectTimer = setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_DELAY);
        connect();
      }, reconnectDelay);
    };
  }

  connect();

  function cleanup() {
    es?.close();
    if (reconnectTimer) clearTimeout(reconnectTimer);
  }

  function reconnect() {
    cleanup();
    reconnectDelay = 1000;
    connect();
  }

  return { cleanup, reconnect };
}