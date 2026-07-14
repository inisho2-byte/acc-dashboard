import { useState, useCallback, useRef, useEffect } from 'react';

const API = '/api';

// ── Auth helpers (mirrors api.js pattern) ────────────────────────────────

function getAuthToken() {
  try {
    const settings = JSON.parse(localStorage.getItem('acc-settings-v1') || '{}');
    return settings.apiToken || '';
  } catch { return ''; }
}

function sanitizeHeaderValue(value) {
  return value.replace(/[^\x20-\x7E]/g, '');
}

function authHeaders() {
  const token = sanitizeHeaderValue(getAuthToken());
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ── Initial agent state factory ──────────────────────────────────────────

function createAgentState() {
  return {
    messages: [],
    loading: false,
    error: null,
    sessionId: null,
    model: '',
    shuStatus: null,
  };
}

const INITIAL_CHATS = {
  arete: createAgentState(),
  claude: createAgentState(),
  shu: createAgentState(),
};

// ── Arete polling interval (ms) ──────────────────────────────────────────
const ARETE_POLL_MS = 2000;
const ARETE_POLL_MAX = 60; // ~2 min cap

/**
 * useChat — manages chat state for 3 AI agent channels (arete, claude, shu).
 *
 * Each agent has independent messages[], loading, error, sessionId, model.
 * Claude uses SSE streaming; Arete uses POST-then-poll; Shu is fire-and-forget
 * with polled message retrieval.
 */
export function useChat() {
  const [chats, setChats] = useState({ ...INITIAL_CHATS });
  const [models, setModels] = useState({ arete: [], claude: [] });
  const [shuMessages, setShuMessages] = useState([]);

  // Ref to track active EventSource so we can tear it down on unmount or agent switch
  const eventSourceRef = useRef(null);
  // Ref for arete polling timer
  const aretePollRef = useRef(null);
  // Refs to always-current chat state for use inside closures without stale captures
  const chatsRef = useRef(chats);
  chatsRef.current = chats;

  // ── Cleanup on unmount ──────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (aretePollRef.current) {
        clearInterval(aretePollRef.current);
        aretePollRef.current = null;
      }
    };
  }, []);

  // ── Helper: update a single agent's chat state ─────────────────────────
  const updateAgent = useCallback((agent, patch) => {
    setChats(prev => ({
      ...prev,
      [agent]: { ...prev[agent], ...patch },
    }));
  }, []);

  // ── Helper: append messages to an agent ────────────────────────────────
  const appendMessages = useCallback((agent, newMsgs) => {
    setChats(prev => ({
      ...prev,
      [agent]: {
        ...prev[agent],
        messages: [...prev[agent].messages, ...newMsgs],
      },
    }));
  }, []);

  // ── Helper: replace or update the last assistant message for an agent ──
  // Used during SSE streaming to accumulate chunks into the same message
  const updateLastAssistant = useCallback((agent, patch) => {
    setChats(prev => {
      const msgs = [...prev[agent].messages];
      // Find last assistant message from the end
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'assistant') {
          msgs[i] = { ...msgs[i], ...patch };
          break;
        }
      }
      return {
        ...prev,
        [agent]: { ...prev[agent], messages: msgs },
      };
    });
  }, []);

  // ── Helper: add a tool_call to the last assistant message ──────────────
  const appendToolCall = useCallback((agent, toolCall) => {
    setChats(prev => {
      const msgs = [...prev[agent].messages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'assistant') {
          const existing = msgs[i].tool_calls || [];
          msgs[i] = { ...msgs[i], tool_calls: [...existing, toolCall] };
          break;
        }
      }
      return {
        ...prev,
        [agent]: { ...prev[agent], messages: msgs },
      };
    });
  }, []);

  // ── Close any active SSE stream ────────────────────────────────────────
  const closeEventSource = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  // ── Stop any active arete polling ──────────────────────────────────────
  const stopAretePoll = useCallback(() => {
    if (aretePollRef.current) {
      clearInterval(aretePollRef.current);
      aretePollRef.current = null;
    }
  }, []);

  // ═══════════════════════════════════════════════════════════════════════
  // sendMessage — dispatch to agent-specific handler
  // ═══════════════════════════════════════════════════════════════════════
  const sendMessage = useCallback(async (agent, message, model) => {
    if (!message?.trim()) return;

    const userMsg = {
      role: 'user',
      content: message.trim(),
      timestamp: new Date().toISOString(),
    };

    // Optimistically append user message, clear prior error
    setChats(prev => ({
      ...prev,
      [agent]: {
        ...prev[agent],
        messages: [...prev[agent].messages, userMsg],
        loading: true,
        error: null,
      },
    }));

    try {
      if (agent === 'arete') {
        await sendArete(message.trim(), model);
      } else if (agent === 'claude') {
        await sendClaude(message.trim(), model);
      } else if (agent === 'shu') {
        await sendShu(message.trim(), model);
      } else {
        updateAgent(agent, { loading: false, error: `Unknown agent: ${agent}` });
      }
    } catch (err) {
      updateAgent(agent, { loading: false, error: String(err) });
    }
  }, [updateAgent]);

  // ── Arete: POST then poll for progress ─────────────────────────────────
  const sendArete = useCallback(async (message, model) => {
    const agent = 'arete';
    const current = chatsRef.current.arete;

    const body = { message };
    if (model) body.model = model;
    if (current.sessionId) body.session_id = current.sessionId;

    const r = await fetch(`${API}/chat/arete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
    }

  const data = await r.json();

  // Persist session + model from response
  const sessionId = data.session_id || current.sessionId;
  const responseModel = data.model || model || '';
  updateAgent(agent, { sessionId, model: responseModel });

  // Handle error responses from the backend
  if (!data.success && data.error) {
    updateAgent(agent, { loading: false, error: data.error });
    return;
  }

  // Append assistant messages from the response
  const assistantMsgs = (data.messages || []).filter(m => m.role === 'assistant');
  if (assistantMsgs.length > 0) {
    appendMessages(agent, assistantMsgs);
  }

  // If the response indicates in-progress work, poll for updates
  if (data.status === 'in_progress' || data.in_progress) {
    startAretePolling(sessionId);
  } else {
    updateAgent(agent, { loading: false });
  }
  }, [updateAgent, appendMessages]);

  // ── Arete polling: GET /api/chat/arete?session_id=X ────────────────────
  const startAretePolling = useCallback((sessionId) => {
    stopAretePoll(); // clear any previous poll

    let tick = 0;
    aretePollRef.current = setInterval(async () => {
      tick++;
      if (tick > ARETE_POLL_MAX) {
        stopAretePoll();
        updateAgent('arete', { loading: false });
        return;
      }

      try {
        const url = `${API}/chat/arete?session_id=${encodeURIComponent(sessionId)}`;
        const r = await fetch(url, { headers: authHeaders() });
        if (!r.ok) {
          // Non-fatal — keep polling
          return;
        }
        const data = await r.json();

        // Append any new assistant messages we haven't seen yet
        const newAssistant = (data.messages || []).filter(m => m.role === 'assistant');
        if (newAssistant.length > 0) {
          // Replace all assistant messages to avoid duplicates
          setChats(prev => {
            const userMsgs = prev.arete.messages.filter(m => m.role !== 'assistant');
            return {
              ...prev,
              arete: {
                ...prev.arete,
                messages: [...userMsgs, ...newAssistant],
              },
            };
          });
        }

        // Stop polling when complete
        if (data.status !== 'in_progress' && !data.in_progress) {
          stopAretePoll();
          updateAgent('arete', { loading: false });
        }
      } catch {
        // Network blip — keep polling
      }
    }, ARETE_POLL_MS);
  }, [updateAgent, stopAretePoll]);

  // ── Claude: POST to get request_id, then SSE stream ────────────────────
  const sendClaude = useCallback(async (message, model) => {
    const agent = 'claude';
    const current = chatsRef.current.claude;

    const body = { message };
    if (model) body.model = model;
    if (current.sessionId) body.session_id = current.sessionId;

    const r = await fetch(`${API}/chat/claude`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
    }

    const data = await r.json();
    const requestId = data.request_id;
    if (!requestId) {
      throw new Error('No request_id returned from Claude chat endpoint');
    }

    // Persist session/model if returned
    if (data.session_id) updateAgent(agent, { sessionId: data.session_id });
    if (data.model) updateAgent(agent, { model: data.model });

    // Seed an empty assistant message for streaming chunks to accumulate into
    appendMessages(agent, [{
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      tool_calls: [],
    }]);

    // Open SSE stream — token as query param since EventSource can't send headers
    openClaudeStream(requestId);
  }, [updateAgent, appendMessages]);

  // ── Claude SSE stream handler ──────────────────────────────────────────
  const openClaudeStream = useCallback((requestId) => {
    // Close any existing stream first
    closeEventSource();

    const token = encodeURIComponent(getAuthToken());
    const url = `${API}/chat/stream/${encodeURIComponent(requestId)}?token=${token}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      // Connection established — nothing extra needed
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleClaudeEvent(data);
      } catch {
        // Malformed SSE payload — ignore
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects by default; we close on intentional end
      // If the stream is done, the server will have sent a 'complete' event first.
      // If we land here without a 'complete', it's an unexpected disconnect.
      const agent = 'claude';
      const current = chatsRef.current.claude;
      if (current.loading) {
        updateAgent(agent, { loading: false, error: 'Stream disconnected unexpectedly' });
      }
      closeEventSource();
    };
  }, [closeEventSource, updateAgent]);

  // ── Claude SSE event dispatcher ────────────────────────────────────────
  const handleClaudeEvent = useCallback((data) => {
    const agent = 'claude';

    switch (data.type) {
      case 'chunk': {
        // Append content to the last assistant message
        updateLastAssistant(agent, {
          content: undefined, // will merge below
        });
        // We need to *append* to content, not replace it — use a functional update
        setChats(prev => {
          const msgs = [...prev[agent].messages];
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === 'assistant') {
              msgs[i] = {
                ...msgs[i],
                content: (msgs[i].content || '') + (data.content || ''),
              };
              break;
            }
          }
          return { ...prev, [agent]: { ...prev[agent], messages: msgs } };
        });
        break;
      }

      case 'tool_call': {
        const tc = {
          name: data.tool_call?.name || 'unknown',
          args: data.tool_call?.args,
          result: data.tool_call?.result,
          status: data.tool_call?.status || 'running',
        };
        appendToolCall(agent, tc);
        break;
      }

      case 'complete': {
        updateAgent(agent, { loading: false });
        // Persist session_id if provided in completion event
        if (data.session_id) {
          updateAgent(agent, { sessionId: data.session_id });
        }
        closeEventSource();
        break;
      }

      case 'error': {
        updateAgent(agent, {
          loading: false,
          error: data.content || data.error || 'Stream error',
        });
        closeEventSource();
        break;
      }

      default:
        // Unknown event type — ignore gracefully
        break;
    }
  }, [updateAgent, updateLastAssistant, appendToolCall, closeEventSource]);

  // ── Shu: POST fire-and-forget, then poll for messages ──────────────────
  const sendShu = useCallback(async (message, model) => {
    const agent = 'shu';
    const current = chatsRef.current.shu;

    const body = { message };
    if (model) body.model = model;
    if (current.sessionId) body.session_id = current.sessionId;

    const r = await fetch(`${API}/chat/shu`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
    }

    const data = await r.json();

    // Persist session and model from response
    const sessionId = data.session_id || current.sessionId;
    const responseModel = data.model || model || '';
    updateAgent(agent, { sessionId, model: responseModel });

    // Append any assistant messages returned directly
    const assistantMsgs = (data.messages || []).filter(m => m.role === 'assistant');
    if (assistantMsgs.length > 0) {
      appendMessages(agent, assistantMsgs);
    }

 // If shu_status indicates the agent is working, poll for messages
 if (data.shu_status === 'working' || data.shu_status === 'in_progress') {
 updateAgent(agent, { loading: true, shuStatus: data.shu_status });
 // Fire-and-forget: start polling for shu messages
 pollShuUntilDone(sessionId);
 } else {
 updateAgent(agent, { loading: false, shuStatus: data.shu_status || 'sent' });
 }
  }, [updateAgent, appendMessages]);

  // ── Shu polling: fetch messages until status is no longer 'working' ────
  const pollShuUntilDone = useCallback((sessionId) => {
    let tick = 0;
    const maxTicks = 90; // ~3 min cap at 2s interval
    const interval = setInterval(async () => {
      tick++;
 if (tick > maxTicks) {
 clearInterval(interval);
 updateAgent('shu', { loading: false, shuStatus: 'timeout' });
 return;
 }

      try {
        const url = `${API}/chat/shu/messages?session_id=${encodeURIComponent(sessionId)}`;
        const r = await fetch(url, { headers: authHeaders() });
        if (!r.ok) return; // keep polling on transient errors

        const data = await r.json();

        // Replace assistant messages with latest from server to avoid dupes
        const serverAssistant = (data.messages || []).filter(m => m.role === 'assistant');
        if (serverAssistant.length > 0) {
          setChats(prev => {
            const userMsgs = prev.shu.messages.filter(m => m.role !== 'assistant');
            return {
              ...prev,
              shu: {
                ...prev.shu,
                messages: [...userMsgs, ...serverAssistant],
              },
            };
          });
        }

        // Update shuMessages (the flat polled list for external consumers)
        if (data.messages) {
          setShuMessages(data.messages);
        }

 // Stop polling when shu is done
 if (data.shu_status !== 'working' && data.shu_status !== 'in_progress') {
 clearInterval(interval);
 updateAgent('shu', { loading: false, shuStatus: data.shu_status || 'complete' });
 }
      } catch {
        // Network blip — keep polling
      }
    }, ARETE_POLL_MS);
  }, [updateAgent]);

  // ═══════════════════════════════════════════════════════════════════════
  // cancelChat — DELETE /api/chat/{agent}/cancel
  // ═══════════════════════════════════════════════════════════════════════
  const cancelChat = useCallback(async (agent) => {
    const sessionId = chatsRef.current[agent]?.sessionId;
    if (!sessionId) return;

    // Tear down any active stream or poll
    closeEventSource();
    stopAretePoll();

    try {
      await fetch(`${API}/chat/${encodeURIComponent(agent)}/cancel`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ session_id: sessionId }),
      });
    } catch (err) {
      console.warn(`cancelChat(${agent}):`, err);
    }

    // Always mark as not loading, even if the cancel call failed
    updateAgent(agent, { loading: false });
  }, [updateAgent, closeEventSource, stopAretePoll]);

  // ═══════════════════════════════════════════════════════════════════════
  // fetchModels — GET /api/chat/{agent}/models
  // ═══════════════════════════════════════════════════════════════════════
  const fetchModels = useCallback(async (agent) => {
    if (agent !== 'arete' && agent !== 'claude') return;

    try {
      const r = await fetch(`${API}/chat/${encodeURIComponent(agent)}/models`, {
        headers: authHeaders(),
      });
      if (!r.ok) return;

      const data = await r.json();
      // Expect { models: string[] } or string[] directly
      const list = Array.isArray(data) ? data : (data.models || []);
      setModels(prev => ({ ...prev, [agent]: list }));
    } catch (err) {
      console.warn(`fetchModels(${agent}):`, err);
    }
  }, []);

  // ═══════════════════════════════════════════════════════════════════════
  // fetchShuMessages — GET /api/chat/shu/messages?session_id=X
  // ═══════════════════════════════════════════════════════════════════════
  const fetchShuMessages = useCallback(async (sessionId) => {
    if (!sessionId) return;

    try {
      const url = `${API}/chat/shu/messages?session_id=${encodeURIComponent(sessionId)}`;
      const r = await fetch(url, { headers: authHeaders() });
      if (!r.ok) return;

      const data = await r.json();
      setShuMessages(data.messages || data || []);
    } catch (err) {
      console.warn('fetchShuMessages:', err);
    }
  }, []);

  return {
    chats,
    sendMessage,
  cancelChat,
  fetchModels,
  models,
  shuMessages,
  fetchShuMessages,
  setModel: (agent, model) => updateAgent(agent, { model }),
};
}
