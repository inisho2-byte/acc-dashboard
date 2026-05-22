import { useEffect } from "react";

export default function useStarfield(canvasRef) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let animId;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const stars = Array.from({ length: 280 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.4 + 0.2,
      spd: Math.random() * 0.2 + 0.05,
      tw: Math.random() * Math.PI * 2,
      twSpd: Math.random() * 0.02 + 0.008,
      hue: Math.random() > 0.85 ? 220 : 210,
    }));

    const nebulae = Array.from({ length: 3 }, () => ({
      x: Math.random(),
      y: Math.random(),
      rx: 0.25 + Math.random() * 0.15,
      ry: 0.15 + Math.random() * 0.12,
      hue: [200, 270, 240][Math.floor(Math.random() * 3)],
    }));

    const draw = () => {
      ctx.fillStyle = "rgba(0, 5, 16, 0.18)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      nebulae.forEach((n) => {
        const grd = ctx.createRadialGradient(
          n.x * canvas.width,
          n.y * canvas.height,
          0,
          n.x * canvas.width,
          n.y * canvas.height,
          n.rx * canvas.width
        );
        grd.addColorStop(0, `hsla(${n.hue}, 80%, 30%, 0.06)`);
        grd.addColorStop(1, "transparent");
        ctx.beginPath();
        ctx.ellipse(
          n.x * canvas.width,
          n.y * canvas.height,
          n.rx * canvas.width,
          n.ry * canvas.height,
          0,
          0,
          Math.PI * 2
        );
        ctx.fillStyle = grd;
        ctx.fill();
      });

      stars.forEach((s) => {
        s.tw += s.twSpd;
        const alpha = 0.3 + 0.7 * Math.abs(Math.sin(s.tw));
        ctx.beginPath();
        ctx.arc(s.x * canvas.width, s.y * canvas.height, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${s.hue}, 70%, 90%, ${alpha})`;
        ctx.fill();
        if (s.r > 1.1 && alpha > 0.8) {
          ctx.shadowColor = `hsla(${s.hue}, 100%, 90%, 0.6)`;
          ctx.shadowBlur = 4;
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      });

      animId = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animId);
    };
  }, [canvasRef]);
}
