# Debate Arena: фронт (vite preview) + бэкенд (express) в одном контейнере.
# Node 24 — нужен встроенный node:sqlite (Node ≥ 22); bookworm-slim (glibc), чтобы
# vite build на rollup/esbuild не ловил musl-проблемы.
FROM node:24-bookworm-slim

WORKDIR /app

# Сначала зависимости — для кэша слоёв. npm ci СТАВИТ и devDependencies
# (vite + concurrently нужны в рантайме для `npm start`), поэтому NODE_ENV
# выставляем production только ПОСЛЕ установки.
COPY package*.json ./
RUN npm ci

# Исходники + сборка фронта (даёт dist/, который раздаёт vite preview).
COPY . .
RUN npm run build

# Каталоги под sqlite-БД и логи во владении node (контейнер бежит не из-под root).
RUN mkdir -p data logs && chown -R node:node /app

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001 5173
USER node

# Healthcheck через express /api/health (глобальный fetch в Node 24, без curl).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://localhost:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# express :3001 + vite preview :5173 (concurrently)
CMD ["npm", "start"]
