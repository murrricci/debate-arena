import React, { useEffect, useRef } from "react";

// Затемнение/осветление hex-цвета (для контура и блика из цвета команды).
function shade(hex, amt) {
  const n = parseInt(hex.replace("#", ""), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.max(0, Math.min(255, r + amt));
  g = Math.max(0, Math.min(255, g + amt));
  b = Math.max(0, Math.min(255, b + amt));
  return `rgb(${r},${g},${b})`;
}

// Пиксельный боец на Canvas. Кадр выбирается по state, idle — «дышит».
// color — цвет команды (заливка), glow — цвет свечения (тир модели).
export default function PixelFighter({ sprite, color = "#d94dff", glow = "#2bff9e", state = "idle", facing = 1, px = 7 }) {
  const ref = useRef(null);
  const raf = useRef(0);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;

    const palette = {
      o: shade(color, -120), // контур
      b: color, // тело
      h: shade(color, 70), // блик
      e: "#ffffff", // глаза
      x: "#ff2b6d", // «зажмуренные» глаза при ударе
    };

    const frame = sprite[state] || sprite.idle;
    const w = sprite.w;
    const h = frame.length;
    canvas.width = w * px;
    canvas.height = (h + 1) * px; // +1 на «дыхание»

    const start = performance.now();
    const draw = (t) => {
      const bob = state === "idle" ? (Math.floor((t - start) / 480) % 2) : 0; // 0/1 пиксель
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      if (facing === -1) {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const ch = frame[y][x];
          if (ch === "." || !palette[ch]) continue;
          // лёгкое свечение для тела
          if (ch === "b" || ch === "h") {
            ctx.shadowColor = glow;
            ctx.shadowBlur = px;
          } else {
            ctx.shadowBlur = 0;
          }
          ctx.fillStyle = palette[ch];
          ctx.fillRect(x * px, (y + bob) * px, px, px);
        }
      }
      ctx.restore();

      // вспышка при ударе
      if (state === "hit") {
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(255,43,109,0.28)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      raf.current = requestAnimationFrame(draw);
    };
    raf.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf.current);
  }, [sprite, color, glow, state, facing, px]);

  // KO — заваливаем спрайт набок; attack — лёгкий доворот вперёд.
  const transform =
    state === "ko" ? `rotate(${facing * 12}deg)` : state === "attack" ? `translateX(${facing * 4}px)` : "none";

  return <canvas ref={ref} style={{ imageRendering: "pixelated", transform, transition: "transform 0.2s", display: "block" }} />;
}
