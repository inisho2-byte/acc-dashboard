import React, { useState, useEffect, useCallback, useRef } from "react";
import { COLORS, FONTS } from "../styles/theme.js";

const LOAD_DURATION = 10000;

const BOOT_SEQUENCE = [
  { text: "Initializing kernel", at: 0 },
  { text: "Loading agent adapters", at: 1200 },
  { text: "Connecting SSE event bus", at: 2400 },
  { text: "Indexing search corpus", at: 3600 },
  { text: "Syncing vault analytics", at: 4800 },
  { text: "Polling agent health", at: 6000 },
  { text: "Restoring session state", at: 7200 },
  { text: "Compiling dashboard layout", at: 8400 },
  { text: "All systems nominal", at: 9500 },
];

/* ── Math helpers ────────────────────────────────────────────────────────── */

function rand(min, max) { return min + Math.random() * (max - min); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function hsla(h, s, l, a) { return `hsla(${h},${s}%,${l}%,${a})`; }

/* ── Golden-sphere distribution (evenly spaced points on sphere surface) ───── */

function spherePoints(count, radius) {
  const pts = [];
  const phi = Math.PI * (3 - Math.sqrt(5)); // golden angle
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const rAtY = Math.sqrt(1 - y * y);
    const theta = phi * i;
    const x = Math.cos(theta) * rAtY * radius;
    const z = Math.sin(theta) * rAtY * radius;
    const yy = y * radius;
    pts.push({
      x, y: yy, z,
      origX: x, origY: yy, origZ: z,
      brightness: rand(0.5, 1.0),
      hue: rand(185, 215),
      pulsePhase: rand(0, Math.PI * 2),
      pulseSpeed: rand(0.4, 2.0),
      size: rand(0.8, 2.8),
      type: Math.random() < 0.08 ? "core" : Math.random() < 0.18 ? "flare" : "normal",
    });
  }
  return pts;
}

/* ── 3D Rotation helpers ──────────────────────────────────────────────────── */

function rotateY(pt, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    x: pt.x * c - pt.z * s,
    y: pt.y,
    z: pt.x * s + pt.z * c,
  };
}

function rotateX(pt, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    x: pt.x,
    y: pt.y * c - pt.z * s,
    z: pt.y * s + pt.z * c,
  };
}

function rotateZ(pt, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    x: pt.x * c - pt.y * s,
    y: pt.x * s + pt.y * c,
    z: pt.z,
  };
}

/* ── Scene generation ─────────────────────────────────────────────────────── */

function generateScene(w, h) {
  const cx = w / 2;
  const cy = h * 0.42;
  const scale = Math.min(w, h);

  /* Deep background stars — dim so sphere dominates */
  const bgStars = [];
  for (let i = 0; i < 600; i++) {
    bgStars.push({
      x: Math.random() * w,
      y: Math.random() * h,
      r: rand(0.15, 1.8),
      brightness: rand(0.03, 0.22),
      twinkleSpeed: rand(0.3, 2.5),
      twinkleOffset: rand(0, Math.PI * 2),
      hue: Math.random() > 0.88 ? 270 : Math.random() > 0.65 ? 195 : Math.random() > 0.4 ? 170 : 220,
    });
  }

  /* Nebula wisps — SUBDUED background — very low opacity */
  const nebulae = [];
  const wispConfigs = [
    /* LEFT — muted cyan sweep */
    { cx: cx - scale * 0.28, cy: cy - scale * 0.12, color: [0, 200, 240], count: 8, rxBase: scale * 0.24, ryBase: scale * 0.16, alpha: 0.05, drift: 0.12 },
    { cx: cx - scale * 0.16, cy: cy + scale * 0.02, color: [0, 220, 255], count: 7, rxBase: scale * 0.20, ryBase: scale * 0.13, alpha: 0.06, drift: 0.18 },
    { cx: cx - scale * 0.22, cy: cy + scale * 0.16, color: [0, 170, 200], count: 6, rxBase: scale * 0.18, ryBase: scale * 0.11, alpha: 0.04, drift: 0.15 },
    { cx: cx - scale * 0.48, cy: cy + scale * 0.06, color: [10, 50, 160], count: 7, rxBase: scale * 0.26, ryBase: scale * 0.18, alpha: 0.03, drift: 0.08 },

    /* RIGHT — muted purple/violet sweep */
    { cx: cx + scale * 0.24, cy: cy - scale * 0.10, color: [120, 50, 220], count: 7, rxBase: scale * 0.20, ryBase: scale * 0.13, alpha: 0.05, drift: 0.14 },
    { cx: cx + scale * 0.14, cy: cy + scale * 0.08, color: [170, 60, 230], count: 6, rxBase: scale * 0.17, ryBase: scale * 0.11, alpha: 0.04, drift: 0.20 },
    { cx: cx + scale * 0.20, cy: cy + scale * 0.20, color: [90, 40, 170], count: 6, rxBase: scale * 0.18, ryBase: scale * 0.11, alpha: 0.04, drift: 0.10 },
    { cx: cx + scale * 0.46, cy: cy + scale * 0.04, color: [40, 50, 150], count: 7, rxBase: scale * 0.24, ryBase: scale * 0.16, alpha: 0.03, drift: 0.09 },

    /* CENTER — dim teal/cyan glow behind sphere */
    { cx: cx - scale * 0.04, cy: cy - scale * 0.18, color: [0, 180, 160], count: 6, rxBase: scale * 0.16, ryBase: scale * 0.10, alpha: 0.04, drift: 0.16 },
    { cx: cx + scale * 0.06, cy: cy - scale * 0.16, color: [0, 210, 190], count: 6, rxBase: scale * 0.15, ryBase: scale * 0.09, alpha: 0.05, drift: 0.22 },
    { cx: cx, cy: cy - scale * 0.08, color: [0, 200, 220], count: 5, rxBase: scale * 0.14, ryBase: scale * 0.09, alpha: 0.05, drift: 0.19 },

    /* BELOW — warm amber glow (barely visible) */
    { cx: cx - scale * 0.06, cy: cy + scale * 0.24, color: [200, 120, 60], count: 5, rxBase: scale * 0.18, ryBase: scale * 0.11, alpha: 0.025, drift: 0.10 },
    { cx: cx + scale * 0.10, cy: cy + scale * 0.26, color: [180, 100, 45], count: 5, rxBase: scale * 0.16, ryBase: scale * 0.10, alpha: 0.02, drift: 0.08 },

    /* CENTER CORE — barely there white-cyan */
    { cx, cy, color: [240, 250, 255], count: 5, rxBase: scale * 0.10, ryBase: scale * 0.07, alpha: 0.08, drift: 0.35 },
    { cx: cx, cy: cy, color: [0, 230, 255], count: 4, rxBase: scale * 0.06, ryBase: scale * 0.05, alpha: 0.06, drift: 0.28 },

    /* STAR-FORMING KNOTS — dimmed */
    { cx: cx - scale * 0.14, cy: cy - scale * 0.06, color: [255, 245, 220], count: 3, rxBase: scale * 0.03, ryBase: scale * 0.02, alpha: 0.12, drift: 0.40 },
    { cx: cx + scale * 0.12, cy: cy - scale * 0.04, color: [255, 220, 255], count: 3, rxBase: scale * 0.03, ryBase: scale * 0.02, alpha: 0.10, drift: 0.35 },
    { cx: cx + scale * 0.02, cy: cy + scale * 0.08, color: [255, 230, 100], count: 3, rxBase: scale * 0.03, ryBase: scale * 0.02, alpha: 0.11, drift: 0.38 },
    { cx: cx - scale * 0.06, cy: cy + scale * 0.04, color: [220, 255, 255], count: 2, rxBase: scale * 0.025, ryBase: scale * 0.015, alpha: 0.14, drift: 0.45 },

    /* OUTER HALO */
    { cx, cy: cy + scale * 0.05, color: [10, 25, 70], count: 6, rxBase: scale * 0.58, ryBase: scale * 0.38, alpha: 0.02, drift: 0.06 },
  ];

  wispConfigs.forEach((cfg) => {
    for (let i = 0; i < cfg.count; i++) {
      const angle = rand(0, Math.PI * 2);
      const spread = rand(0, cfg.rxBase * 0.4);
      nebulae.push({
        x: cfg.cx + Math.cos(angle) * spread,
        y: cfg.cy + Math.sin(angle) * spread * 0.6,
        rx: cfg.rxBase * rand(0.6, 1.4),
        ry: cfg.ryBase * rand(0.6, 1.4),
        rotation: rand(0, Math.PI * 2),
        r: cfg.color[0], g: cfg.color[1], b: cfg.color[2],
        alpha: cfg.alpha * rand(0.6, 1.2),
        drift: cfg.drift + rand(-0.05, 0.05),
      });
    }
  });

  /* 3D Sphere — the soul of ARETE — BIGGER, BOLDER, BRIGHTER */
  const sphereRadius = scale * 0.22; // was 0.17
  const sphere = {
    points: spherePoints(320, sphereRadius), // more points, denser
    rotationY: 0,
    rotationX: 0.18,
    rotationZ: 0,
    yawSpeed: 0.25,  // faster rotation
    pitchSpeed: 0.10,
    rollSpeed: 0.05,
    pulseRadius: sphereRadius,
    baseRadius: sphereRadius,
    cx, cy,
  };

  /* Connection lines between nearby sphere points */
  const connections = [];
  const pts = sphere.points;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i].origX - pts[j].origX;
      const dy = pts[i].origY - pts[j].origY;
      const dz = pts[i].origZ - pts[j].origZ;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < sphereRadius * 0.35) {
        connections.push({ i, j, strength: 1 - dist / (sphereRadius * 0.35) });
      }
    }
  }
  /* Energy particles — data packets traveling along sphere connections */
  const energyParticles = [];
  for (let i = 0; i < 45; i++) {
    const connIdx = Math.floor(Math.random() * connections.length);
    const conn = connections[connIdx];
    energyParticles.push({
      connIdx,
      t: Math.random(),
      speed: rand(0.3, 1.6),
      hue: Math.random() < 0.6 ? 190 : 270,
      size: rand(1.2, 2.8),
      trailLen: rand(4, 12),
      trailHistory: [], // persistent glowing trail
    });
  }
  sphere.connections = connections;
  sphere.energyParticles = energyParticles;

  /* Pulse rings — heartbeat waves emanating from sphere */
  sphere.pulseRings = [];
  for (let i = 0; i < 3; i++) {
    sphere.pulseRings.push({
      t: i * (Math.PI * 2 / 3), // staggered
      speed: 1.5,
      maxR: sphereRadius * 2.5,
      hue: 190,
    });
  }

  /* Scattered bright stars across the full frame — dimmed */
  const scatterStars = [];
  for (let i = 0; i < 35; i++) {
    scatterStars.push({
      x: rand(0, w),
      y: rand(0, h),
      coreR: rand(1.2, 3),
      flareLen: rand(5, 20),
      brightness: rand(0.12, 0.35),
      hue: Math.random() > 0.6 ? 270 : Math.random() > 0.3 ? 195 : 170,
      twinkleSpeed: rand(0.3, 1.2),
      twinkleOffset: rand(0, Math.PI * 2),
    });
  }

  /* Miniature distant galaxies (spiral smudges) */
  const distantGalaxies = [];
  const galaxyPositions = [
    { x: w * 0.12, y: h * 0.15 },
    { x: w * 0.88, y: h * 0.22 },
    { x: w * 0.08, y: h * 0.78 },
    { x: w * 0.85, y: h * 0.82 },
    { x: w * 0.25, y: h * 0.88 },
  ];
  galaxyPositions.forEach((pos) => {
    const size = rand(scale * 0.03, scale * 0.06);
    distantGalaxies.push({
      x: pos.x, y: pos.y,
      rx: size, ry: size * 0.4,
      angle: rand(0, Math.PI * 2),
      brightness: rand(0.08, 0.2),
    });
  });

  /* Dust particles — drifting slowly */
  const dustParticles = [];
  for (let i = 0; i < 100; i++) {
    dustParticles.push({
      x: rand(0, w), y: rand(0, h),
      vx: rand(-0.12, 0.12),
      vy: rand(-0.06, 0.06),
      r: rand(0.2, 0.7),
      brightness: rand(0.04, 0.18),
      hue: rand(170, 260),
    });
  }

  return { bgStars, nebulae, sphere, scatterStars, distantGalaxies, dustParticles, cx, cy, w, h, scale };
}

/* ── Canvas renderer ──────────────────────────────────────────────────────── */

function drawFrame(ctx, scene, time) {
  const { bgStars, nebulae, sphere, scatterStars, distantGalaxies, dustParticles, w, h, cx, cy, scale } = scene;

  /* Background — deeper, richer dark */
  ctx.fillStyle = "#080a1a";
  ctx.fillRect(0, 0, w, h);

  /* ── Nebula wisps — HUBBLE BOLD — drawn with additive compositing ─────────── */
  /* All nebula blobs share one additive pass for maximum saturation buildup */
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  nebulae.forEach((n) => {
    const breathe = 1 + Math.sin(time * n.drift) * 0.08;
    const rx = n.rx * breathe;
    const ry = n.ry * breathe;

    ctx.save();
    ctx.translate(n.x, n.y);
    ctx.rotate(n.rotation + time * n.drift * 0.03);
    ctx.scale(1, ry / rx);

    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    /* Inner core — very bright, sharp cutoff */
    const aCore = Math.min(1, n.alpha * 2.2);
    /* Body — medium */
    const aBody = Math.min(1, n.alpha * 0.9);
    /* Edge — fades fast */
    const aEdge = Math.min(1, n.alpha * 0.15);

    grad.addColorStop(0, `rgba(${n.r},${n.g},${n.b},${aCore})`);
    grad.addColorStop(0.25, `rgba(${n.r},${n.g},${n.b},${aBody})`);
    grad.addColorStop(0.60, `rgba(${n.r},${n.g},${n.b},${aEdge})`);
    grad.addColorStop(1, "transparent");

    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  });
  ctx.restore(); // back to source-over

  /* ── Second nebula pass: textured "veins" for organic detail ──────────────── */
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  nebulae.forEach((n) => {
    if (n.alpha < 0.05) return; // skip faint wisps
    const breathe = 1 + Math.sin(time * n.drift * 1.3 + 1) * 0.05;
    const rx = n.rx * breathe * 0.6;
    const ry = n.ry * breathe * 0.6;

    ctx.save();
    ctx.translate(n.x + Math.sin(time * 0.2 + n.drift) * rx * 0.15, n.y + Math.cos(time * 0.17 + n.drift) * ry * 0.1);
    ctx.rotate(n.rotation * 1.5 + time * n.drift * 0.05);
    ctx.scale(1, ry / rx);

    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    const aCore = Math.min(1, n.alpha * 1.5);
    grad.addColorStop(0, `rgba(${Math.min(255, n.r + 40)},${Math.min(255, n.g + 30)},${Math.min(255, n.b + 50)},${aCore})`);
    grad.addColorStop(0.4, `rgba(${n.r},${n.g},${n.b},${n.alpha * 0.4})`);
    grad.addColorStop(1, "transparent");

    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  });
  ctx.restore();

  /* ── Background stars ───────────────────────────────────────────────────── */
  bgStars.forEach((s) => {
    const twinkle = 0.5 + 0.5 * Math.sin(time * s.twinkleSpeed + s.twinkleOffset);
    const alpha = s.brightness * twinkle;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fillStyle = hsla(s.hue, 60, 80, alpha);
    ctx.fill();
  });

  /* ── Distant galaxies (soft smudges) ─────────────────────────────────────── */
  distantGalaxies.forEach((g) => {
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.rotate(g.angle);

    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, g.rx);
    grad.addColorStop(0, `rgba(200,210,240,${g.brightness * 0.5})`);
    grad.addColorStop(0.5, `rgba(160,180,220,${g.brightness * 0.2})`);
    grad.addColorStop(1, "transparent");

    ctx.scale(1, g.ry / g.rx);
    ctx.beginPath();
    ctx.arc(0, 0, g.rx, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  });

  /* ── THE SOUL OF ARETE — 3D Rotating Sphere ─────────────────────────────── */
  const sp = sphere;
  sp.rotationY += sp.yawSpeed * 0.016;
  sp.rotationX += sp.pitchSpeed * 0.016;
  sp.rotationZ += sp.rollSpeed * 0.016;

  /* Breathing pulse */
  const breath = 1 + Math.sin(time * 0.8) * 0.04 + Math.sin(time * 1.3) * 0.02;
  sp.pulseRadius = sp.baseRadius * breath;

  /* Project all points */
  const projected = sp.points.map((pt) => {
    /* Apply breathing to radius */
    const br = sp.pulseRadius / sp.baseRadius;
    let p = { x: pt.origX * br, y: pt.origY * br, z: pt.origZ * br };

    /* Apply rotations */
    p = rotateY(p, sp.rotationY);
    p = rotateX(p, sp.rotationX);
    p = rotateZ(p, sp.rotationZ);

    /* Perspective projection */
    const focalLength = scale * 0.8;
    const zOffset = sp.baseRadius * 2;
    const perspective = focalLength / (p.z + zOffset);
    const sx = cx + p.x * perspective;
    const sy = cy + p.y * perspective;

    return {
      x: sx, y: sy, z: p.z,
      depth: (p.z + sp.baseRadius) / (sp.baseRadius * 2), // 0 (back) to 1 (front)
      orig: pt,
    };
  });

  /* Draw connections (constellation lines) — only for front-facing points */
  ctx.lineWidth = 0.6;
  sp.connections.forEach((conn) => {
    const a = projected[conn.i];
    const b = projected[conn.j];
    if (a.depth < 0.15 || b.depth < 0.15) return; // skip back-facing

    const avgDepth = (a.depth + b.depth) / 2;
    const alpha = conn.strength * avgDepth * 0.35;
    if (alpha < 0.02) return;

    /* Energy pulse along the line — bright, visible */
    const pulseT = (time * 1.5 + conn.i * 0.7) % 1;
    const pulseAlpha = Math.max(alpha, alpha * (1 + Math.sin(pulseT * Math.PI * 2) * 2.5));

    ctx.strokeStyle = `rgba(0,230,255,${pulseAlpha * 1.0})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  });

  /* Draw sphere particles */
  projected.forEach((p) => {
    const pt = p.orig;
    const depthFade = clamp(p.depth, 0.1, 1);
    const pulse = 0.7 + 0.3 * Math.sin(time * pt.pulseSpeed + pt.pulsePhase);
    const b = pt.brightness * depthFade * pulse;
    const size = pt.size * depthFade * (0.8 + pulse * 0.4);

    if (pt.type === "core") {
      /* Core nodes — larger, with strong glow */
      const glowR = size * 10;
      const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
      glow.addColorStop(0, hsla(pt.hue, 95, 75, b * 0.7));
      glow.addColorStop(0.25, hsla(pt.hue, 85, 65, b * 0.25));
      glow.addColorStop(1, "transparent");
      ctx.beginPath();
      ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(p.x, p.y, size * 2, 0, Math.PI * 2);
      ctx.fillStyle = hsla(pt.hue, 85, 90, b);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y, size * 0.7, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${b * 0.95})`;
      ctx.fill();
    } else if (pt.type === "flare") {
      /* Flare stars with cross spikes */
      const flareLen = size * 6 * pulse;
      ctx.strokeStyle = hsla(pt.hue, 70, 80, b * 0.25);
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(p.x - flareLen, p.y);
      ctx.lineTo(p.x + flareLen, p.y);
      ctx.moveTo(p.x, p.y - flareLen);
      ctx.lineTo(p.x, p.y + flareLen);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fillStyle = hsla(pt.hue, 70, 85, b);
      ctx.fill();
    } else {
      /* Normal particles — brighter */
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fillStyle = hsla(pt.hue, 65, 85, b);
      ctx.fill();
    }
  });

  /* Energy particles — traveling along connections with persistent trails */
  if (sp.energyParticles) {
    sp.energyParticles.forEach((ep) => {
      ep.t += ep.speed * 0.016;
      if (ep.t > 1) {
        ep.t = 0;
        ep.connIdx = Math.floor(Math.random() * sp.connections.length);
        ep.trailHistory = []; // clear on respawn
      }
      const conn = sp.connections[ep.connIdx];
      if (!conn) return;
      const a = projected[conn.i];
      const b = projected[conn.j];
      if (!a || !b) return;
      if (a.depth < 0.1 || b.depth < 0.1) return;

      const x = a.x + (b.x - a.x) * ep.t;
      const y = a.y + (b.y - a.y) * ep.t;
      const depth = a.depth + (b.depth - a.depth) * ep.t;
      const alpha = depth * 0.9;

      /* Record trail history */
      ep.trailHistory.push({ x, y, depth, alpha });
      if (ep.trailHistory.length > ep.trailLen * 2) ep.trailHistory.shift();

      /* Draw persistent trail with fade */
      if (ep.trailHistory.length > 1) {
        for (let k = 0; k < ep.trailHistory.length - 1; k++) {
          const t1 = ep.trailHistory[k];
          const t2 = ep.trailHistory[k + 1];
          const trailAlpha = (k / ep.trailHistory.length) * t1.alpha * 0.7;
          ctx.beginPath();
          ctx.moveTo(t1.x, t1.y);
          ctx.lineTo(t2.x, t2.y);
          ctx.strokeStyle = hsla(ep.hue, 90, 75, trailAlpha);
          ctx.lineWidth = ep.size * t1.depth * 0.6;
          ctx.stroke();
        }
      }

      /* Head glow */
      const glowR = ep.size * depth * 4;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, glowR);
      glow.addColorStop(0, hsla(ep.hue, 95, 90, alpha * 0.8));
      glow.addColorStop(0.5, hsla(ep.hue, 85, 75, alpha * 0.3));
      glow.addColorStop(1, "transparent");
      ctx.beginPath();
      ctx.arc(x, y, glowR, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();

      /* Head core */
      ctx.beginPath();
      ctx.arc(x, y, ep.size * depth * 1.2, 0, Math.PI * 2);
      ctx.fillStyle = hsla(ep.hue, 95, 90, alpha);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, ep.size * depth * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.fill();
    });
  }

  /* Central sphere glow — bright halo behind the sphere */
  const sphereGlowR = sp.baseRadius * 2.0;
  const sphereGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, sphereGlowR);
  sphereGlow.addColorStop(0, `rgba(0,200,240,${0.12 * breath})`);
  sphereGlow.addColorStop(0.35, `rgba(20,100,200,${0.06 * breath})`);
  sphereGlow.addColorStop(1, "transparent");
  ctx.beginPath();
  ctx.arc(cx, cy, sphereGlowR, 0, Math.PI * 2);
  ctx.fillStyle = sphereGlow;
  ctx.globalCompositeOperation = "lighter";
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";

  /* ── Pulse rings — heartbeat waves emanating from sphere ─────────────────── */
  if (sp.pulseRings) {
    sp.pulseRings.forEach((pr) => {
      pr.t += pr.speed * 0.016;
      const cycle = (pr.t % (Math.PI * 2)) / (Math.PI * 2);
      const ringR = pr.maxR * cycle;
      const ringAlpha = Math.sin(cycle * Math.PI) * 0.4 * breath;
      if (ringAlpha < 0.01) return;

      ctx.beginPath();
      ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
      ctx.strokeStyle = hsla(pr.hue, 90, 70, ringAlpha);
      ctx.lineWidth = 2.5;
      ctx.stroke();

      /* Inner echo ring */
      ctx.beginPath();
      ctx.arc(cx, cy, ringR * 0.85, 0, Math.PI * 2);
      ctx.strokeStyle = hsla(pr.hue, 80, 60, ringAlpha * 0.4);
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }

  /* ── Scattered bright stars (cross-flare style) ─────────────────────────── */
  scatterStars.forEach((s) => {
    const pulse = 0.7 + 0.3 * Math.sin(time * s.twinkleSpeed + s.twinkleOffset);
    const b = s.brightness * pulse;
    const flare = s.flareLen * pulse;

    /* Glow halo */
    const glowR = s.coreR * 5;
    const glow = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, glowR);
    glow.addColorStop(0, hsla(s.hue, 90, 75, b * 0.35));
    glow.addColorStop(0.3, hsla(s.hue, 80, 65, b * 0.12));
    glow.addColorStop(1, "transparent");
    ctx.beginPath();
    ctx.arc(s.x, s.y, glowR, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();

    /* Cross-flare */
    ctx.strokeStyle = hsla(s.hue, 75, 82, b * 0.22);
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(s.x - flare, s.y);
    ctx.lineTo(s.x + flare, s.y);
    ctx.moveTo(s.x, s.y - flare);
    ctx.lineTo(s.x, s.y + flare);
    ctx.stroke();

    /* Diagonal cross */
    const dFlare = flare * 0.45;
    ctx.strokeStyle = hsla(s.hue, 65, 78, b * 0.12);
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    ctx.moveTo(s.x - dFlare, s.y - dFlare);
    ctx.lineTo(s.x + dFlare, s.y + dFlare);
    ctx.moveTo(s.x + dFlare, s.y - dFlare);
    ctx.lineTo(s.x - dFlare, s.y + dFlare);
    ctx.stroke();

    /* Core + white center */
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.coreR, 0, Math.PI * 2);
    ctx.fillStyle = hsla(s.hue, 75, 88, b);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.coreR * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${b * 0.85})`;
    ctx.fill();
  });

  /* ── Dust particles ──────────────────────────────────────────────────────── */
  dustParticles.forEach((p) => {
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < -10) p.x = w + 10;
    if (p.x > w + 10) p.x = -10;
    if (p.y < -10) p.y = h + 10;
    if (p.y > h + 10) p.y = -10;

    const twinkle = 0.5 + 0.5 * Math.sin(time * 1.5 + p.x * 0.02);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = hsla(p.hue, 55, 75, p.brightness * twinkle);
    ctx.fill();
  });
}

/* ── Component ─────────────────────────────────────────────────────────────── */

export default function LoadingScreen({ onComplete }) {
  const canvasRef = useRef(null);
  const [progress, setProgress] = useState(0);
  const [lines, setLines] = useState([]);
  const [done, setDone] = useState(false);
  const animRef = useRef(null);
  const sceneRef = useRef(null);
  const startRef = useRef(Date.now());

  /* Initialize canvas + scene */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    sceneRef.current = generateScene(w, h);
    startRef.current = Date.now();
  }, []);

  /* Animation loop */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sceneRef.current) return;
    const ctx = canvas.getContext("2d");
    const scene = sceneRef.current;

    let running = true;
    const draw = () => {
      if (!running) return;
      const t = (Date.now() - startRef.current) / 1000;
      drawFrame(ctx, scene, t);
      animRef.current = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      running = false;
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, []);

  /* Progress timer */
  useEffect(() => {
    const start = Date.now();
    const tick = () => {
      const p = Math.min((Date.now() - start) / LOAD_DURATION, 1);
      setProgress(p);
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    const lineTimers = BOOT_SEQUENCE.map(({ text, at }) =>
      setTimeout(() => setLines((prev) => [...prev, text]), at)
    );
    const doneTimer = setTimeout(() => setDone(true), LOAD_DURATION);

    return () => {
      lineTimers.forEach(clearTimeout);
      clearTimeout(doneTimer);
    };
  }, []);

  const handleSkip = useCallback(() => {
    setProgress(1);
    setLines(BOOT_SEQUENCE.map((s) => s.text));
    setDone(true);
  }, []);

  const triggerComplete = useCallback(() => {
    const el = document.getElementById("acc-loading-root");
    if (el) {
      el.style.transition = "opacity 0.8s ease";
      el.style.opacity = "0";
      setTimeout(() => onComplete(), 800);
    } else {
      onComplete();
    }
  }, [onComplete]);

  const pct = Math.round(progress * 100);
  const barColor = progress >= 1 ? COLORS.success : COLORS.primary;

  return (
    <div
      id="acc-loading-root"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        fontFamily: FONTS.mono,
        color: COLORS.textMain,
        overflow: "hidden",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />

      {/* UI overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-end",
          paddingBottom: "5vh",
          pointerEvents: "none",
        }}
      >
        {/* ARETE label */}
        <div style={{ textAlign: "center", marginBottom: 22, pointerEvents: "auto" }}>
          <div
            style={{
              fontFamily: FONTS.sans,
              fontSize: 28,
              fontWeight: 800,
              letterSpacing: "0.35em",
              color: "rgba(230,245,255,0.92)",
              textTransform: "uppercase",
              WebkitTextStroke: "0.4px rgba(0,200,240,0.22)",
              textShadow: `
                0 1px 0 rgba(255,255,255,0.35),
                0 -1px 0 rgba(0,0,0,0.55),
                0 2px 4px rgba(0,0,0,0.45),
                0 0 10px rgba(0,200,255,0.10),
                0 0 25px rgba(0,200,255,0.04)
              `,
            }}
          >
            ARETE
          </div>
          <div
            style={{
              fontFamily: FONTS.sans,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.5em",
              color: "rgba(170,200,235,0.65)",
              textTransform: "uppercase",
              marginTop: 6,
              textShadow: `
                0 1px 0 rgba(255,255,255,0.15),
                0 -1px 0 rgba(0,0,0,0.30),
                0 0 6px rgba(0,200,255,0.06)
              `,
            }}
          >
            Command Center
          </div>
        </div>

        {/* Progress bar */}
        <div
          style={{
            width: 300,
            height: 2,
            background: "rgba(255,255,255,0.04)",
            borderRadius: 1,
            overflow: "hidden",
            marginBottom: 20,
            pointerEvents: "auto",
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              borderRadius: 1,
              background: `linear-gradient(90deg, ${barColor}66, ${barColor})`,
              boxShadow: `0 0 12px ${barColor}40`,
              transition: "width 0.1s linear",
            }}
          />
        </div>

        {/* Boot log */}
        <div
          style={{
            width: 360,
            minHeight: 120,
            marginBottom: 24,
            pointerEvents: "auto",
          }}
        >
          {lines.map((line, i) => {
            const isLast = i === lines.length - 1;
            const isFinal = line === "All systems nominal";
            return (
              <div
                key={i}
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 11,
                  letterSpacing: "0.08em",
                  color: isFinal
                    ? COLORS.success
                    : isLast
                    ? "rgba(232,244,253,0.70)"
                    : "rgba(150,180,220,0.30)",
                  marginBottom: 3,
                  lineHeight: 1.7,
                  animation: "fade-up 0.4s ease forwards",
                }}
              >
                <span style={{ color: isFinal ? COLORS.success : COLORS.primary, marginRight: 10 }}>
                  {isFinal ? "✓" : "›"}
                </span>
                {line}
              </div>
            );
          })}
        </div>

        {/* Skip / Start button */}
        {!done ? (
          <button
            onClick={handleSkip}
            style={{
              fontFamily: FONTS.mono,
              fontSize: 9,
              letterSpacing: "0.18em",
              color: "rgba(150,180,220,0.30)",
              background: "transparent",
              border: "1px solid rgba(0,212,255,0.06)",
              borderRadius: 4,
              padding: "7px 22px",
              cursor: "pointer",
              transition: "color 0.3s, border-color 0.3s, background 0.3s, box-shadow 0.3s",
              pointerEvents: "auto",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "rgba(0,212,255,0.6)";
              e.currentTarget.style.borderColor = "rgba(0,212,255,0.25)";
              e.currentTarget.style.background = "rgba(0,212,255,0.03)";
              e.currentTarget.style.boxShadow = "0 0 20px rgba(0,212,255,0.06)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "rgba(150,180,220,0.30)";
              e.currentTarget.style.borderColor = "rgba(0,212,255,0.06)";
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            SKIP LOADING
          </button>
        ) : (
          <button
            onClick={triggerComplete}
            style={{
              fontFamily: FONTS.mono,
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.22em",
              color: "#080a1a",
              background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primary}cc)`,
              border: "none",
              borderRadius: 5,
              padding: "14px 48px",
              cursor: "pointer",
              boxShadow: `0 0 30px ${COLORS.primary}35, 0 0 60px ${COLORS.primary}12`,
              animation: "fade-up 0.4s ease forwards",
              pointerEvents: "auto",
            }}
          >
            START DASHBOARD
          </button>
        )}
      </div>
    </div>
  );
}
