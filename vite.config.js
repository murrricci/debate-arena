import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Фронт ходит в бэкенд по /api — Vite проксирует это на локальный Express (порт 3001),
// чтобы ключ Anthropic не попадал в браузер и не было CORS-проблем.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
