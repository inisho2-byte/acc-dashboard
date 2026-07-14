import { useEffect, useRef } from "react";

// ── Inject keyframes once ────────────────────────────────────────────────
const STYLE_ID = "acc-skeleton-keyframes";
function injectStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const sheet = document.createElement("style");
  sheet.id = STYLE_ID;
  sheet.textContent = `
@keyframes accSkelPulse {
  0%, 100% { opacity: 0.15; }
  50%      { opacity: 0.30; }
}
.acc-skel {
  animation: accSkelPulse 1.5s ease-in-out infinite;
  background: rgba(0,212,255,0.08);
}
.acc-skel-shimmer {
  background: linear-gradient(
    90deg,
    rgba(0,212,255,0.08) 0%,
    rgba(0,212,255,0.15) 40%,
    rgba(0,212,255,0.08) 80%
  );
  background-size: 200% 100%;
  animation: accSkelPulse 1.5s ease-in-out infinite, accSkelShimmer 2s linear infinite;
}
@keyframes accSkelShimmer {
  from { background-position: 200% 0; }
  to   { background-position: -200% 0; }
}`;
  document.head.appendChild(sheet);
}

// ── Primitive variants ───────────────────────────────────────────────────
const BASE = {
  display: "block",
  borderRadius: 6,
};

export function SkeletonRow({ width = "80%", height = 16, style, ...rest }) {
  useEffect(() => { injectStyles(); }, []);
  return (
    <div
      className="acc-skel-shimmer"
      style={{ ...BASE, width, height, borderRadius: 3, ...style }}
      {...rest}
    />
  );
}

export function SkeletonCard({ width = "100%", height = 120, style, ...rest }) {
  useEffect(() => { injectStyles(); }, []);
  return (
    <div
      className="acc-skel-shimmer"
      style={{ ...BASE, width, height, borderRadius: 10, ...style }}
      {...rest}
    />
  );
}

export function SkeletonCircle({ size = 48, style, ...rest }) {
  useEffect(() => { injectStyles(); }, []);
  return (
    <div
      className="acc-skel-shimmer"
      style={{
        ...BASE,
        width: size,
        height: size,
        borderRadius: "50%",
        ...style,
      }}
      {...rest}
    />
  );
}

export function SkeletonPanel({ style, ...rest }) {
  useEffect(() => { injectStyles(); }, []);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, ...style }} {...rest}>
      {/* Title bar */}
      <SkeletonRow width="45%" height={14} />
      {/* 3 cards */}
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
      {/* 2 rows */}
      <SkeletonRow />
      <SkeletonRow width="60%" />
    </div>
  );
}

// ── Main dispatch component ─────────────────────────────────────────────
const VARIANTS = { row: SkeletonRow, card: SkeletonCard, circle: SkeletonCircle, panel: SkeletonPanel };

export default function Skeleton({ variant = "row", ...rest }) {
  const Comp = VARIANTS[variant];
  if (!Comp) {
    console.warn(`[Skeleton] Unknown variant "${variant}". Falling back to "row".`);
    return <SkeletonRow {...rest} />;
  }
  return <Comp {...rest} />;
}