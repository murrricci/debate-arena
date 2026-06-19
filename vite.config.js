import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Фронт ходит в бэкенд по /api — Vite проксирует это на локальный Express (порт 3001),
// чтобы ключ LLM не попадал в браузер и не было CORS-проблем.
// Дополнительно: прокси подставляет заголовок X-Arena-Key из серверного env (ARENA_API_KEY),
// чтобы киоск мог писать результаты/агентов в API, а секрет не утекал в браузерный бандл.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ""); // "" → читаем и не-VITE_ переменные (.env)
  const arenaKey = env.ARENA_API_KEY || process.env.ARENA_API_KEY || "";

  const proxy = {
    "/api": {
      target: "http://localhost:3001",
      changeOrigin: false,
      configure: (proxy) => {
        proxy.on("proxyReq", (proxyReq) => {
          if (arenaKey) proxyReq.setHeader("X-Arena-Key", arenaKey);
        });
      },
    },
  };

  return {
    plugins: [react()],
    server: { port: 5173, proxy },
    preview: {
      port: 5173,
      host: true, // слушать 0.0.0.0 — чтобы Caddy из соседнего контейнера достучался
      // За Caddy приходит чужой Host (arena.gpb-dev.ru); vite preview 5.4.x иначе отдаёт 403.
      // ALLOWED_HOSTS задаётся в проде (.env); пусто → разрешить все (локальный npm start).
      allowedHosts: (() => {
        const list = (process.env.ALLOWED_HOSTS || "")
          .split(",").map((s) => s.trim()).filter(Boolean);
        return list.length ? list : true;
      })(),
      proxy,
    },
  };
});
