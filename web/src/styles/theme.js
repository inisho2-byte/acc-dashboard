export const COLORS = {
  primary: "#00d4ff",
  success: "#00ff88",
  danger: "#ff4444",
  warning: "#f59e0b",
  shu: "#a78bfa",
  copper: "#c27a5a",
  peach: "#e8a87c",
  copperGlow: "rgba(194,122,90,0.15)",
  bg: "#000510",
  textMain: "#e8f4fd",
  textMuted: "rgba(150,180,220,0.5)",
  textDim: "rgba(150,180,220,0.4)",
  textFaint: "rgba(150,180,220,0.3)",
  borderSubtle: "rgba(0,212,255,0.1)",
  borderLight: "rgba(0,212,255,0.2)",
  panelBg: "rgba(8, 16, 36, 0.65)",
};

export const FONTS = {
  mono: "'Space Mono', monospace",
  sans: "'Space Grotesk', sans-serif",
};

export const STATUS_META = {
  online:  { color: "#00ff88", bg: "#00ff8815", border: "#00ff8830" },
  offline: { color: "#ff4444", bg: "#ff444415", border: "#ff444430" },
};

export const AGENT_COLORS = {
  arete: "#00d4ff",
  shu: "#a78bfa",
};

export const STATUS_COLORS = {
  active: "#00d4ff",
  building: "#00d4ff",
  growing: "#00d4ff",
  evergreen: "#00ff88",
  complete: "#00ff88",
  seed: "#f59e0b",
  planning: "#f59e0b",
};

export const SOURCE_COLORS = {
  session: "#00d4ff",
  discord: "#a78bfa",
  vault: "#f59e0b",
  error: "#ff4444",
  cron: "#facc15",
};

export const SEVERITY = {
  CRITICAL: { color: '#ff3b30', bg: 'rgba(255,59,48,0.12)', label: 'CRITICAL' },
  HIGH:     { color: '#ff9500', bg: 'rgba(255,149,0,0.12)', label: 'HIGH' },
  MEDIUM:   { color: '#ffcc00', bg: 'rgba(255,204,0,0.12)', label: 'MEDIUM' },
  LOW:      { color: '#34c759', bg: 'rgba(52,199,89,0.12)', label: 'LOW' },
  INFO:     { color: '#5ac8fa', bg: 'rgba(90,200,250,0.12)', label: 'INFO' },
  UNKNOWN:  { color: '#8e8e93', bg: 'rgba(142,142,147,0.12)', label: 'UNKNOWN' },
};

export function getSeverity(errorCount) {
  if (errorCount >= 10) return SEVERITY.CRITICAL;
  if (errorCount >= 5) return SEVERITY.HIGH;
  if (errorCount >= 2) return SEVERITY.MEDIUM;
  if (errorCount >= 1) return SEVERITY.LOW;
  return SEVERITY.INFO;
}
