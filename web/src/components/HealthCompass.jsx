import { useMemo } from "react";
import { SEVERITY } from "../styles/theme.js";

// ── Agent segment definitions ────────────────────────────────────────────
const AGENT_SEGMENTS = [
  { id: "arete",       label: "ARETE"  },
  { id: "shu",         label: "SHU"   },
  { id: "claude-code", label: "CLAUDE" },
  { id: "scout",       label: "SCOUT" },
  { id: "scribe-reach-dev", label: "S+R+D" },
];

// ── Map agent status → segment fill color ────────────────────────────────
function statusColor(status) {
  switch (status) {
    case "healthy":  return "#34c759";   // green
    case "degraded": return "#ffcc00";   // yellow
    case "down":     return "#ff3b30";   // red
    default:         return "#8e8e93";   // gray (unknown)
  }
}

function statusBg(status) {
  switch (status) {
    case "healthy":  return "rgba(52,199,89,0.25)";
    case "degraded": return "rgba(255,204,0,0.25)";
    case "down":     return "rgba(255,59,48,0.25)";
    default:         return "rgba(142,142,147,0.18)";
  }
}

// ── Compute overall score 0-100 ──────────────────────────────────────────
function computeScore(agents) {
  if (!agents || agents.length === 0) return 0;
  const points = agents.reduce((sum, a) => {
    switch (a.status) {
      case "healthy":  return sum + 100;
      case "degraded": return sum + 50;
      case "down":     return sum + 0;
      default:         return sum + 25;
    }
  }, 0);
  return Math.round(points / agents.length);
}

// ── SVG arc path helper ──────────────────────────────────────────────────
function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end   = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = (endAngle - startAngle) > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

// ── Component ─────────────────────────────────────────────────────────────
export default function HealthCompass({ agents = [] }) {
  const SIZE = 180;
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const outerR = 78;
  const innerR = 52;
  const gap = 2; // degree gap between segments

  // Build segments from agents prop, fall back to AGENT_SEGMENTS
  const segments = useMemo(() => {
    if (agents.length === 0) {
      // Placeholder — all unknown
      return AGENT_SEGMENTS.map(s => ({ ...s, status: "unknown" }));
    }
    return agents.map((a, i) => {
      const preset = AGENT_SEGMENTS[i] || AGENT_SEGMENTS[AGENT_SEGMENTS.length - 1];
      return { id: a.id || preset.id, label: preset.label, status: a.status || "unknown", health: a.health };
    });
  }, [agents]);

  const score = useMemo(() => computeScore(agents), [agents]);

  // Score color from severity palette
  const scoreColor = useMemo(() => {
    if (score >= 80) return SEVERITY.LOW.color;     // green-ish
    if (score >= 60) return SEVERITY.MEDIUM.color;   // yellow
    if (score >= 30) return SEVERITY.HIGH.color;     // orange
    return SEVERITY.CRITICAL.color;                  // red
  }, [score]);

  // Angle math: equal slices with gap
  const totalGap = gap * segments.length;
  const sliceAngle = (360 - totalGap) / segments.length;

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={SIZE}
      height={SIZE}
      style={{ flexShrink: 0 }}
    >
      <defs>
        <filter id="compassGlow">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Background circle */}
      <circle cx={cx} cy={cy} r={outerR} fill="rgba(0,0,0,0.3)" />

      {/* Segments */}
      {segments.map((seg, i) => {
        const startDeg = i * (sliceAngle + gap);
        const endDeg = startDeg + sliceAngle;

        // Outer arc
        const outerArc = describeArc(cx, cy, outerR, startDeg, endDeg);
        // Inner arc (reversed)
        const innerArc = describeArc(cx, cy, innerR, startDeg, endDeg);
        const innerStart = polarToCartesian(cx, cy, innerR, startDeg);
        const outerEnd = polarToCartesian(cx, cy, outerR, endDeg);

        const fill = statusColor(seg.status);
        const bgFill = statusBg(seg.status);

        // Label position — midpoint of arc, just outside outerR
        const midDeg = startDeg + sliceAngle / 2;
        const labelPos = polarToCartesian(cx, cy, outerR + 10, midDeg);

        return (
          <g key={seg.id}>
            {/* Donut segment */}
            <path
              d={`${outerArc} L ${outerEnd.x} ${outerEnd.y} L ${innerStart.x} ${innerStart.y} ${innerArc} Z`}
              fill={bgFill}
              stroke={fill}
              strokeWidth={1.5}
              filter="url(#compassGlow)"
            />
            {/* Label */}
            <text
              x={labelPos.x}
              y={labelPos.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={fill}
              fontSize="7"
              fontFamily="'Space Mono', monospace"
              letterSpacing="0.06em"
              opacity={0.9}
            >
              {seg.label}
            </text>
          </g>
        );
      })}

      {/* Center circle background */}
      <circle cx={cx} cy={cy} r={innerR - 2} fill="rgba(10,10,15,0.9)" />

      {/* Score number */}
      <text
        x={cx}
        y={cy - 2}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={scoreColor}
        fontSize="32"
        fontWeight="700"
        fontFamily="'Inter Tight', 'Inter', sans-serif"
      >
        {score}
      </text>

      {/* "HEALTH" label under score */}
      <text
        x={cx}
        y={cy + 16}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="rgba(150,180,220,0.4)"
        fontSize="8"
        fontFamily="'Space Mono', monospace"
        letterSpacing="0.14em"
      >
        HEALTH
      </text>
    </svg>
  );
}