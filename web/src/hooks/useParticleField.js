import { useEffect } from "react";

// ── Constellation configuration ────────────────────────────────────
const STAR_COUNT = 160;
const SHOOTING_STAR_CHANCE = 0.002;
const CONSTELLATION_DIST = 160;       // max distance for constellation lines
const MAX_CONNECTIONS_PER_STAR = 3;   // max lines per star
const BRIGHT_STAR_THRESHOLD = 0.82;   // top 18% become bright stars
const MOUSE_REPEL_RADIUS = 200;
const MOUSE_REPEL_FORCE = 0.1;
const PARALLAX_STRENGTH = 0.015;

export default function useParticleField(canvasRef) {
 useEffect(() => {
 const canvas = canvasRef.current;
 if (!canvas) return;
 const ctx = canvas.getContext("2d");
 let animId;
 let hidden = false;
 let lastDrawTime = 0;
 let lastMouseMoveTime = 0;
 const IDLE_FPS = 30;
 const IDLE_FRAME_MS = 1000 / IDLE_FPS;
 const ACTIVE_FRAME_MS = 0; // no throttle when user is active

 const onVisibilityChange = () => {
 hidden = document.hidden;
 if (!hidden && !animId) draw(); // resume when tab becomes visible
 };
 document.addEventListener("visibilitychange", onVisibilityChange);

 const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2, active: false };
    const onMove = (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true; lastMouseMoveTime = performance.now(); };
    const onLeave = () => { mouse.active = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseleave", onLeave);

    // ── Star factory ───────────────────────────────────────────────
    let stars = [];
    let shootingStars = [];

    function makeStar(idx) {
      const brightness = Math.random();
      const isBright = brightness > BRIGHT_STAR_THRESHOLD;
      const isAnchor = isBright && Math.random() > 0.5; // ~9% are constellation anchors
      return {
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        r: isBright
          ? (Math.random() * 1.6 + 1.2)  // 1.2–2.8px
          : (Math.random() * 0.9 + 0.2),  // 0.2–1.1px
        spdX: (Math.random() - 0.5) * 0.15,
        spdY: (Math.random() - 0.5) * 0.1,
        tw: Math.random() * Math.PI * 2,
        twSpd: isBright
          ? Math.random() * 0.018 + 0.004  // slower twinkle for bright
          : Math.random() * 0.03 + 0.008,   // faster for dim
        hue: Math.random() > 0.7
          ? 195 + Math.random() * 20   // cyan-blue (70%)
          : 30 + Math.random() * 20,   // warm gold (30%)
        bright: isBright,
        anchor: isAnchor,
        driftPhase: Math.random() * Math.PI * 2,
        driftAmp: Math.random() * 0.25 + 0.05,
      };
    }

    for (let i = 0; i < STAR_COUNT; i++) stars.push(makeStar(i));

    // ── Shooting star factory ──────────────────────────────────────
    function makeShootingStar() {
      const angle = Math.random() * 0.8 + 0.3; // mostly downward-right
      const speed = Math.random() * 6 + 5;
      return {
        x: Math.random() * window.innerWidth * 0.8,
        y: Math.random() * window.innerHeight * 0.3,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        len: Math.random() * 40 + 20,
        life: 1.0,
        decay: Math.random() * 0.01 + 0.005,
        hue: Math.random() > 0.5 ? 200 : 40,
      };
    }

    // ── Nebulae (atmospheric depth) ────────────────────────────────
    const nebulae = [
      { x: 0.25, y: 0.35, rx: 0.28, ry: 0.16, hue: 265 },
      { x: 0.72, y: 0.55, rx: 0.22, ry: 0.14, hue: 210 },
    ];

    // ── Spatial index for fast neighbor lookup ─────────────────────
    function buildGrid(stars, cellSize) {
      const grid = {};
      stars.forEach((s, i) => {
        const cx = Math.floor(s.x / cellSize);
        const cy = Math.floor(s.y / cellSize);
        const key = `${cx},${cy}`;
        if (!grid[key]) grid[key] = [];
        grid[key].push(i);
      });
      return grid;
    }

    // ── Draw loop ──────────────────────────────────────────────────
    const draw = () => {
      const W = window.innerWidth;
      const H = window.innerHeight;

      ctx.clearRect(0, 0, W, H);

      // ── Nebulae ────────────────────────────────────────────────
      nebulae.forEach((n) => {
        const grd = ctx.createRadialGradient(
          n.x * W, n.y * H, 0,
          n.x * W, n.y * H, n.rx * W
        );
        grd.addColorStop(0, `hsla(${n.hue}, 55%, 30%, 0.035)`);
        grd.addColorStop(0.5, `hsla(${n.hue}, 50%, 25%, 0.012)`);
        grd.addColorStop(1, "transparent");
        ctx.beginPath();
        ctx.ellipse(n.x * W, n.y * H, n.rx * W, n.ry * H, 0, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();
      });

      // ── Mouse parallax offset ──────────────────────────────────
      const mxOff = mouse.active ? (mouse.x - W / 2) * PARALLAX_STRENGTH : 0;
      const myOff = mouse.active ? (mouse.y - H / 2) * PARALLAX_STRENGTH : 0;

      // ── Update stars ───────────────────────────────────────────
      stars.forEach((p) => {
        p.driftPhase += 0.005;
        const driftX = Math.sin(p.driftPhase) * p.driftAmp;
        const driftY = Math.cos(p.driftPhase * 0.7) * p.driftAmp * 0.5;
        p.x += p.spdX + driftX;
        p.y += p.spdY + driftY;

        // Mouse repulsion
        if (mouse.active) {
          const dx = p.x - mouse.x;
          const dy = p.y - mouse.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < MOUSE_REPEL_RADIUS && dist > 0) {
            const force = (MOUSE_REPEL_RADIUS - dist) / MOUSE_REPEL_RADIUS * MOUSE_REPEL_FORCE;
            p.x += (dx / dist) * force;
            p.y += (dy / dist) * force;
          }
        }

        // Wrap
        const buf = 30;
        if (p.x < -buf) p.x = W + buf;
        if (p.x > W + buf) p.x = -buf;
        if (p.y < -buf) p.y = H + buf;
        if (p.y > H + buf) p.y = -buf;

        p.tw += p.twSpd;
      });

      // ── Constellation lines ────────────────────────────────────
      // Build spatial grid for O(n) neighbor lookup
      const cellSize = CONSTELLATION_DIST;
      const grid = buildGrid(stars, cellSize);

      // Only draw lines between bright/anchor stars
      const brightIndices = [];
      stars.forEach((s, i) => {
        if (s.bright || s.anchor) brightIndices.push(i);
      });

      ctx.lineWidth = 0.5;
      ctx.lineCap = "round";

      // Track drawn connections to avoid duplicates
      const drawn = new Set();

      brightIndices.forEach((i) => {
        const p = stars[i];
        const px = p.x + mxOff * 0.5;
        const py = p.y + myOff * 0.5;
        const cx = Math.floor(p.x / cellSize);
        const cy = Math.floor(p.y / cellSize);

        let connections = 0;

        // Check 3x3 neighborhood
        for (let dx = -1; dx <= 1 && connections < MAX_CONNECTIONS_PER_STAR; dx++) {
          for (let dy = -1; dy <= 1 && connections < MAX_CONNECTIONS_PER_STAR; dy++) {
            const key = `${cx + dx},${cy + dy}`;
            const cell = grid[key];
            if (!cell) continue;

            for (let k = 0; k < cell.length && connections < MAX_CONNECTIONS_PER_STAR; k++) {
              const j = cell[k];
              if (j <= i) continue; // avoid duplicates
              const q = stars[j];
              if (!q.bright && !q.anchor) continue;

              const ddx = px - (q.x + mxOff * 0.5);
              const ddy = py - (q.y + myOff * 0.5);
              const dist = Math.sqrt(ddx * ddx + ddy * ddy);

              if (dist < CONSTELLATION_DIST) {
                const edgeKey = i < j ? `${i}-${j}` : `${j}-${i}`;
                if (drawn.has(edgeKey)) continue;
                drawn.add(edgeKey);

                const proximity = 1 - dist / CONSTELLATION_DIST;
                // Anchor-to-anchor lines are brightest
                const isAnchorLine = p.anchor && q.anchor;
                const baseAlpha = isAnchorLine ? 0.25 : 0.12;
                const alpha = proximity * baseAlpha;

                // Gradient line: fades from star to star
                const qx = q.x + mxOff * 0.5;
                const qy = q.y + myOff * 0.5;
                const grad = ctx.createLinearGradient(px, py, qx, qy);
                const lineHue = (p.hue + q.hue) / 2;

                grad.addColorStop(0, `hsla(${p.hue}, 60%, 80%, ${alpha})`);
                grad.addColorStop(0.5, `hsla(${lineHue}, 50%, 75%, ${alpha * 0.7})`);
                grad.addColorStop(1, `hsla(${q.hue}, 60%, 80%, ${alpha})`);

                ctx.strokeStyle = grad;
                ctx.beginPath();
                ctx.moveTo(px, py);
                ctx.lineTo(qx, qy);
                ctx.stroke();

                connections++;
              }
            }
          }
        }
      });

      // ── Draw stars ─────────────────────────────────────────────
      stars.forEach((p) => {
        const alpha = 0.4 + 0.6 * Math.abs(Math.sin(p.tw));
        const x = p.x + mxOff * 0.5;
        const y = p.y + myOff * 0.5;
        const finalAlpha = p.bright ? alpha : alpha * 0.6;

        // Outer glow for bright/anchor stars
        if (p.bright) {
          const glowR = p.r * (p.anchor ? 6 : 4);
          const glowGrad = ctx.createRadialGradient(x, y, 0, x, y, glowR);
          glowGrad.addColorStop(0, `hsla(${p.hue}, 80%, 90%, ${finalAlpha * 0.25})`);
          glowGrad.addColorStop(0.4, `hsla(${p.hue}, 70%, 85%, ${finalAlpha * 0.08})`);
          glowGrad.addColorStop(1, "transparent");
          ctx.beginPath();
          ctx.arc(x, y, glowR, 0, Math.PI * 2);
          ctx.fillStyle = glowGrad;
          ctx.fill();
        }

        // Star core
        ctx.beginPath();
        ctx.arc(x, y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue}, 65%, 92%, ${finalAlpha})`;
        ctx.fill();

        // Diffraction spikes for anchor stars (4-point cross)
        if (p.anchor) {
          const spikeLen = p.r * 4 * finalAlpha;
          const spikeWidth = 0.3;
          ctx.strokeStyle = `hsla(${p.hue}, 80%, 95%, ${finalAlpha * 0.35})`;
          ctx.lineWidth = spikeWidth;
          // Vertical spike
          ctx.beginPath();
          ctx.moveTo(x, y - spikeLen);
          ctx.lineTo(x, y + spikeLen);
          ctx.stroke();
          // Horizontal spike
          ctx.beginPath();
          ctx.moveTo(x - spikeLen, y);
          ctx.lineTo(x + spikeLen, y);
          ctx.stroke();
        }
      });

      // ── Shooting stars ─────────────────────────────────────────
      if (Math.random() < SHOOTING_STAR_CHANCE && shootingStars.length < 2) {
        shootingStars.push(makeShootingStar());
      }

      for (let i = shootingStars.length - 1; i >= 0; i--) {
        const s = shootingStars[i];
        s.x += s.vx;
        s.y += s.vy;
        s.life -= s.decay;

        if (s.life <= 0 || s.x < -100 || s.x > W + 100 || s.y > H + 100) {
          shootingStars.splice(i, 1);
          continue;
        }

        const grad = ctx.createLinearGradient(s.x, s.y, s.x - s.vx * 3, s.y - s.vy * 3);
        grad.addColorStop(0, `hsla(${s.hue}, 90%, 80%, ${s.life})`);
        grad.addColorStop(1, `hsla(${s.hue}, 90%, 80%, 0)`);

        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x - s.vx * (s.len / 10), s.y - s.vy * (s.len / 10));
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.2;
        ctx.lineCap = "round";
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(s.x, s.y, 1.2, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${s.hue}, 100%, 95%, ${s.life})`;
        ctx.shadowColor = `hsla(${s.hue}, 100%, 90%, ${s.life * 0.5})`;
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.shadowBlur = 0;
      }

 animId = requestAnimationFrame(scheduleFrame);
 };

 const scheduleFrame = () => {
 if (hidden) { animId = null; return; } // pause when tab hidden
 const now = performance.now();
 const idle = (now - lastMouseMoveTime) > 2000; // idle if no mouse for 2s
 const minInterval = idle ? IDLE_FRAME_MS : ACTIVE_FRAME_MS;
 const elapsed = now - lastDrawTime;
 if (elapsed >= minInterval) {
 lastDrawTime = now;
 draw();
 } else {
 // Schedule next draw at the right time
 animId = requestAnimationFrame(scheduleFrame);
 }
 };

 scheduleFrame();

 return () => {
 window.removeEventListener("resize", resize);
 window.removeEventListener("mousemove", onMove);
 window.removeEventListener("mouseleave", onLeave);
 document.removeEventListener("visibilitychange", onVisibilityChange);
 cancelAnimationFrame(animId);
 stars = [];
 shootingStars = [];
 };
 }, [canvasRef]);
}
