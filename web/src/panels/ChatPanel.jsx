import { useState, useEffect } from 'react';
import { useChat } from '../hooks/useChat.js';
import ChatTerminal from '../components/chat/ChatTerminal.jsx';
import ChatSidebar from '../components/chat/ChatSidebar.jsx';
import PanelLayout from '../components/PanelLayout';
import EmptyState from '../components/EmptyState';

// ── Theme constants (local, no theme.js import) ──────────────────────────
const THEME = {
  primary: '#00d4ff',
  shu: '#a78bfa',
  danger: '#ff4444',
  success: '#00ff88',
  bg: '#000510',
  panelBg: 'rgba(8,16,36,0.65)',
  borderSubtle: 'rgba(0,212,255,0.1)',
  mono: "'Space Mono', monospace",
  textMain: '#e8f4fd',
  textMuted: 'rgba(150,180,220,0.5)',
};

// ── Agent metadata ───────────────────────────────────────────────────────
const AGENTS = [
  { id: 'arete', label: 'ARETE', color: '#00d4ff' },
  { id: 'claude', label: 'CLAUDE', color: '#d97706' },
  { id: 'shu', label: 'SHU', color: '#a78bfa' },
];

// ── Agent Tab Button ─────────────────────────────────────────────────────
function AgentTab({ agent, active, onClick }) {
  const [hovered, setHovered] = useState(false);
  const isActive = active === agent.id;

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        padding: '8px 20px',
        border: 'none',
        borderBottom: isActive ? `2px solid ${agent.color}` : '2px solid transparent',
        borderRadius: 0,
        background: isActive
          ? `rgba(${hexToRgb(agent.color)},0.08)`
          : hovered
            ? `rgba(${hexToRgb(agent.color)},0.04)`
            : 'transparent',
        color: isActive ? agent.color : THEME.textMuted,
        fontFamily: THEME.mono,
        fontSize: 11,
        fontWeight: isActive ? 700 : 400,
        letterSpacing: '0.12em',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        // Subtle glow on hover
        boxShadow: hovered && !isActive
          ? `0 2px 12px rgba(${hexToRgb(agent.color)},0.08)`
          : isActive
            ? `0 2px 16px rgba(${hexToRgb(agent.color)},0.12)`
            : 'none',
        outline: 'none',
      }}
    >
      {agent.label}
    </button>
  );
}

// ── Hex to RGB helper (for rgba() in inline styles) ──────────────────────
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `${r},${g},${b}`;
}

// ── Main Panel ───────────────────────────────────────────────────────────
export default function ChatPanel() {
  const [activeAgent, setActiveAgent] = useState('arete');
  const {
    chats,
    sendMessage,
    cancelChat,
    fetchModels,
    models,
    shuMessages,
    fetchShuMessages,
    setModel,
  } = useChat();

  // Fetch available models for arete and claude on mount
  useEffect(() => {
    fetchModels('arete');
    fetchModels('claude');
  }, [fetchModels]);

  // Derive the active agent's chat state
  const chat = chats[activeAgent] || { messages: [], loading: false, error: null, sessionId: null, model: '' };
  const agentColor = AGENTS.find(a => a.id === activeAgent)?.color || THEME.primary;

  // Determine loading state for PanelLayout — loading when models haven't loaded yet
  const isLoading = !models || (!models.arete && !models.claude && !models.shu);

  // Build stats for PanelLayout header strip
  const stats = chat.sessionId ? [
    { label: "Agent", value: activeAgent.toUpperCase() },
    { label: "Messages", value: chat.messages?.length ?? 0 },
  ] : [];

  return (
    <PanelLayout
      title="CHAT"
      icon="💬"
      accentColor="#34d399"
      loading={isLoading}
      stats={stats}
    >
      {isLoading ? null : (
        <div style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: THEME.bg,
          fontFamily: THEME.mono,
          color: THEME.textMain,
          overflow: 'hidden',
        }}>
          {/* ── Top row: agent channel tabs ──────────────────────────────── */}
          <div style={{
            display: 'flex',
            alignItems: 'stretch',
            borderBottom: `1px solid ${THEME.borderSubtle}`,
            background: THEME.panelBg,
            flexShrink: 0,
          }}>
            {AGENTS.map(agent => (
              <AgentTab
                key={agent.id}
                agent={agent}
                active={activeAgent}
                onClick={() => setActiveAgent(agent.id)}
              />
            ))}
            {/* Right-aligned session indicator */}
            <div style={{
              marginLeft: 'auto',
              display: 'flex',
              alignItems: 'center',
              paddingRight: 16,
              fontSize: 9,
              color: THEME.textMuted,
              letterSpacing: '0.08em',
            }}>
              {chat.sessionId && (
                <>
                  <span style={{
                    display: 'inline-block',
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    backgroundColor: chat.loading ? THEME.primary : THEME.success,
                    marginRight: 6,
                    boxShadow: chat.loading
                      ? `0 0 6px ${THEME.primary}`
                      : `0 0 4px ${THEME.success}`,
                  }} />
                  {chat.sessionId.slice(0, 8)}
                </>
              )}
            </div>
          </div>

          {/* ── 2-column grid: terminal (70%) + sidebar (30%) ────────────── */}
          <div style={{
            flex: 1,
            display: 'grid',
            gridTemplateColumns: '7fr 3fr',
            minHeight: 0, // allow grid children to shrink and scroll
            overflow: 'hidden',
          }}>
            {/* Left: Chat terminal */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              borderRight: `1px solid ${THEME.borderSubtle}`,
            }}>
                <ChatTerminal
                  agent={activeAgent}
                  messages={chat.messages}
                  loading={chat.loading}
                  error={chat.error}
                  model={chat.model}
                  onSend={(msg) => sendMessage(activeAgent, msg)}
                  onCancel={() => cancelChat(activeAgent)}
                />
            </div>

            {/* Right: Sidebar */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              background: THEME.panelBg,
            }}>
                <ChatSidebar
                  agent={activeAgent}
                  model={chat.model}
                  models={models[activeAgent] || []}
                  loading={chat.loading}
                  error={chat.error}
                  sessionId={chat.sessionId}
                  messages={chat.messages}
                  shuStatus={activeAgent === 'shu' ? chat.shuStatus : null}
                  onModelChange={(m) => setModel(activeAgent, m)}
                />
            </div>
          </div>
        </div>
      )}
      {!isLoading && !chat.sessionId && (!chat.messages || chat.messages.length === 0) && (
        <EmptyState icon="💬" title="No active chat" description="Select an agent tab above to start a conversation." />
      )}
    </PanelLayout>
  );
}