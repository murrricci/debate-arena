import React, { useEffect, useRef } from "react";

// Пиксельная неоновая арена-фон на Canvas: дальняя сетка, неоновый горизонт,
// перспективный пол с уходящими линиями и две тумбы под бойцов.
// Рисуется один раз и при ресайзе; бойцы анимируются поверх отдельными канвасами.
export default function PixelArena({ p1 = "#d94dff", p2 = "#00d9ff" }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const draw = () => {
      const parent = canvas.parentElement;
      const W = (canvas.width = parent.clientWidth);
      const H = (canvas.height = parent.clientHeight);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, W, H);

      const PX = 4; // размер «пикселя»
      const horizon = Math.round(H * 0.42);

      // фон неба — тёмно-фиолетовый градиент
      const sky = ctx.createLinearGradient(0, 0, 0, horizon);
      sky.addColorStop(0, "#0a0613");
      sky.addColorStop(1, "#1a0f33");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, horizon);

      // дальняя пиксельная сетка над горизонтом
      ctx.fillStyle = "rgba(217,77,255,0.10)";
      for (let x = 0; x < W; x += PX * 4) ctx.fillRect(x, 0, 1, horizon);
      for (let y = 0; y < horizon; y += PX * 4) ctx.fillRect(0, y, W, 1);

      // неоновый горизонт-линия (свечение)
      const glow = ctx.createLinearGradient(0, horizon - 8, 0, horizon + 8);
      glow.addColorStop(0, "rgba(0,217,255,0)");
      glow.addColorStop(0.5, "rgba(255,60,165,0.9)");
      glow.addColorStop(1, "rgba(0,217,255,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, horizon - 8, W, 16);
      ctx.fillStyle = "#ff3ca5";
      ctx.fillRect(0, horizon - 1, W, 2);

      // пол — тёмный
      ctx.fillStyle = "#100a1f";
      ctx.fillRect(0, horizon, W, H - horizon);

      // перспективные линии пола, сходящиеся к центру горизонта
      const cx = W / 2;
      ctx.strokeStyle = "rgba(0,217,255,0.35)";
      ctx.lineWidth = 1;
      for (let i = -10; i <= 10; i++) {
        ctx.beginPath();
        ctx.moveTo(cx, horizon);
        ctx.lineTo(cx + i * (W / 8), H);
        ctx.stroke();
      }
      // горизонтальные полосы пола, сгущающиеся к горизонту
      ctx.strokeStyle = "rgba(255,60,165,0.22)";
      let y = horizon;
      let step = 3;
      while (y < H) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
        step *= 1.32;
        y += step;
      }

      // две неоновые тумбы под бойцов (слева P1, справа P2)
      const padY = H - 14;
      const drawPad = (px, color) => {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.25;
        ctx.fillRect(px - 46, padY, 92, 6);
        ctx.globalAlpha = 1;
        ctx.fillRect(px - 46, padY, 92, 2);
      };
      drawPad(W * 0.2, p1);
      drawPad(W * 0.8, p2);
    };

    draw();
    const ro = new ResizeObserver(draw);
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    return () => ro.disconnect();
  }, [p1, p2]);

  return (
    <canvas
      ref={ref}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", imageRendering: "pixelated", borderRadius: 8 }}
    />
  );
}
