# Дизайн: сборка и деплой Debate Arena (Docker + Caddy + GitHub Actions)

**Дата:** 2026-06-19
**Статус:** утверждён, готов к плану реализации

## Цель

CI/CD для Debate Arena: GitHub Actions собирает Docker-образ, пушит его в приватный
репозиторий Docker Hub `leidruid/debate-arena` и деплоит на сервер, где контейнеры
крутятся через `docker compose`. Перед приложением — Caddy для reverse-proxy и
авто-TLS. Домен — `arena.gpb-dev.ru`.

## Решения (утверждены пользователем)

- **Доставка на сервер:** SSH + `docker compose pull && up -d`. Секреты приложения
  живут на сервере, не в GitHub.
- **Версия тега образа:** из git-тега `vX.Y.Z`. Триггер сборки/деплоя — push такого тега.
- **Рантайм-секреты:** файл `.env` на сервере рядом с `docker-compose.yml`.
- **Каталог на сервере:** `/opt/debate-arena/` (фиксированный, хардкодится в workflow и
  compose — отдельная GitHub-переменная не нужна). Пользователя с правами на этот каталог
  и запуск `docker compose` создаёт пользователь самостоятельно.

## Топология на сервере (один хост, docker compose)

```
Интернет :443/:80
   │  auto-TLS (Let's Encrypt через Caddy)
   ▼
┌─────────────┐   reverse_proxy    ┌──────────────────────────────┐
│   caddy     │ ─────────────────► │  app (один контейнер)         │
│ (контейнер) │   app:5173         │  npm start:                   │
└─────────────┘                    │   • express  :3001 (LLM + БД) │
  arena.gpb-dev.ru                 │   • vite preview :5173 (фронт │
                                   │     + проксирует /api→3001,    │
                                   │     инжектит X-Arena-Key)      │
                                   └──────────────────────────────┘
                                     volume arena-data → /app/data (sqlite)
                                     volume arena-logs → /app/logs
```

### Почему `vite preview` за Caddy, а не статика из Caddy

`vite preview` (через `vite.config.js`) уже проксирует `/api` на express **и подставляет
заголовок `X-Arena-Key`** из серверного env. Это краеугольный камень модели безопасности:
ключ не попадает в браузерный бандл. Если отдавать статику напрямую из Caddy, инжект ключа
пришлось бы переносить в Caddyfile и дублировать логику прокси. Поэтому контейнер
приложения запускает `npm start` (express + vite preview) без изменений в коде оркестрации,
а Caddy только терминирует TLS и проксирует на `:5173`.

Компромисс: в проде работает `vite preview` (dev-ориентированный статик-сервер). Для
киоска на одной машине это приемлемо. Альтернатива (статика из Caddy + инжект ключа в
Caddyfile) сознательно отклонена ради нулевых изменений в логике прокси.

## Изменение кода (обязательное)

Единственная правка приложения — блок `preview` в `vite.config.js`. Без неё:
1. `vite preview` по умолчанию слушает только localhost → Caddy из соседнего контейнера не
   достучится;
2. `vite preview` 5.4.x отдаёт `403 Blocked request` на `Host`, которого нет в `allowedHosts`.

```js
preview: {
  port: 5173,
  host: true,                                   // слушать 0.0.0.0 (для Caddy)
  allowedHosts: (() => {
    const list = (process.env.ALLOWED_HOSTS || "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    return list.length ? list : true;           // пусто → разрешить все (локальный npm start)
  })(),
  proxy,
},
```

`ALLOWED_HOSTS=arena.gpb-dev.ru` приходит из серверного `.env`. На локальной машине переменная
не задана → `allowedHosts: true` → `npm start` работает как раньше.

WebSocket не нужен: синхронизация окон идёт через `BroadcastChannel` + `localStorage` в
браузере, серверного WS нет.

## Создаваемые файлы

### `Dockerfile`

- База `node:24-bookworm-slim` (нужен встроенный `node:sqlite`, Node ≥ 22; slim/glibc, чтобы
  не ловить musl-проблемы у rollup/esbuild при `vite build`).
- `COPY package*.json` → `npm ci` (полный, **с** devDependencies — `vite`/`concurrently` нужны
  в рантайме; поэтому `NODE_ENV=production` выставляется ТОЛЬКО после `npm ci`).
- `COPY . .` → `npm run build` (даёт `dist/`).
- `ENV NODE_ENV=production`, `EXPOSE 5173 3001`.
- Создать `data/` и `logs/`, владелец `node`; запуск под пользователем `node` (не root).
- `HEALTHCHECK` на `http://localhost:3001/api/health` (через `node -e` с глобальным `fetch`,
  без зависимости от `curl`).
- `CMD ["npm","start"]`.

### `.dockerignore`

Исключить `node_modules`, `.git`, `.env*`, `data`, `logs`, `dist`, `.idea`, `*.md`-артефакты,
`print/`-выгрузки и прочий локальный мусор, чтобы контекст сборки был чистым.

### `docker-compose.yml`

- Сервис `app`:
  - `image: leidruid/debate-arena:${IMAGE_TAG:-latest}` (деплой подставляет точный тег;
    дефолт `latest` для ручного запуска);
  - `env_file: .env` (все рантайм-переменные приложения);
  - volumes: `arena-data:/app/data`, `arena-logs:/app/logs`;
  - `restart: unless-stopped`;
  - healthcheck дублирует/полагается на образ.
- Сервис `caddy`:
  - `image: caddy:2` (официальный);
  - порты `80:80`, `443:443`;
  - `./Caddyfile:/etc/caddy/Caddyfile:ro`;
  - volumes: `caddy-data:/data`, `caddy-config:/config` (сертификаты сохраняются между
    рестартами);
  - окружение `DOMAIN`, `ACME_EMAIL` (для подстановки в Caddyfile) из `.env`;
  - `depends_on: app`, `restart: unless-stopped`.
- Named volumes: `arena-data`, `arena-logs`, `caddy-data`, `caddy-config`.
- Named volumes (а не bind-mount) для БД/логов — чтобы не возиться с правами на хосте:
  docker создаёт volume с владельцем `node`, раз образ владеет `/app/data` юзером `node`.

### `Caddyfile`

```
{$DOMAIN} {
    encode zstd gzip
    reverse_proxy app:5173
}
```

Опционально глобальный блок с `email {$ACME_EMAIL}` для ACME. Auto-TLS работает, потому что
Caddy получает сертификат Let's Encrypt для `arena.gpb-dev.ru` на портах 80/443.

### `.github/workflows/deploy.yml`

- **Триггер:** `on: push: tags: ['v*.*.*']` + `workflow_dispatch` (ручной прогон; версия для
  dispatch берётся из `package.json`).
- **Вычисление тега образа:**
  - `VERSION = ${GITHUB_REF_NAME#v}` для тега (`v1.2.3` → `1.2.3`); для dispatch — из
    `package.json`.
  - `SHORT_SHA = ${GITHUB_SHA::7}`.
  - Тег образа: `${VERSION}-${SHORT_SHA}` (например `1.2.3-a1b2c3d`) **и** `latest`.
  - `latest` всегда переезжает на последний собранный тег.
- **Job `build`:**
  - `docker/login-action` → Docker Hub (`DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN`);
  - `docker/build-push-action` пушит оба тега, с gha-кэшем слоёв.
- **Job `deploy`** (needs: build):
  - `appleboy/scp-action`: копирует `docker-compose.yml` и `Caddyfile` в `/opt/debate-arena/`;
  - `appleboy/ssh-action`:
    `cd /opt/debate-arena` →
    `docker login` (приватный репо) →
    `IMAGE_TAG=<точный тег> docker compose pull` →
    `IMAGE_TAG=<точный тег> docker compose up -d` →
    `docker image prune -f`.
  - `.env` на сервере деплой не трогает.

### `.env.deploy.example`

Шаблон серверного `.env` (кладётся в `/opt/debate-arena/.env`). Содержит все рантайм-переменные
приложения из текущего `.env.example` (`LLM_API_KEY`, `ARENA_API_KEY`, `LLM_BASE_URL`,
`LLM_TIER_1/2/3`, `LLM_TIER_JUDGE`, `LLM_FALLBACKS`, reasoning-ручки, `ARENA_DB_FILE` и т.д.)
плюс деплой-специфичные: `DOMAIN=arena.gpb-dev.ru`, `ALLOWED_HOSTS=arena.gpb-dev.ru`,
`ACME_EMAIL=...`.

### `DEPLOY.md`

Документация: разовая подготовка сервера + список GitHub-секретов (см. ниже).

## GitHub Secrets (Settings → Secrets and variables → Actions)

| Имя | Значение |
|---|---|
| `DOCKERHUB_USERNAME` | `leidruid` |
| `DOCKERHUB_TOKEN` | access-token из hub.docker.com (Account → Security), право записи в `leidruid/debate-arena` |
| `SSH_HOST` | IP/хост сервера `arena.gpb-dev.ru` |
| `SSH_USER` | пользователь для деплоя (в группе `docker`, с правами на `/opt/debate-arena`) |
| `SSH_KEY` | приватный SSH-ключ этого пользователя (весь PEM) |
| `SSH_PORT` | порт SSH, если не 22 (иначе опустить, дефолт 22) |

GitHub-переменные (`Variables`) не требуются: путь `/opt/debate-arena/` фиксирован в коде.

## Разовая подготовка сервера (в `DEPLOY.md`)

1. Установить Docker Engine + плагин `docker compose`.
2. DNS: `A`-запись `arena.gpb-dev.ru` → IP сервера.
3. Открыть порты `80` и `443` (ACME-челлендж + раздача).
4. Создать `/opt/debate-arena/`, владелец — деплой-пользователь (делает пользователь сам).
5. Положить в `/opt/debate-arena/.env` заполненный файл по образцу `.env.deploy.example`.
6. Авторизовать `SSH_KEY` для деплой-пользователя (`~/.ssh/authorized_keys`).

После этого push git-тега `vX.Y.Z` запускает полный цикл: build → push → deploy.

## Вне области (YAGNI)

- Нет multi-arch образов (сервер один, x86_64).
- Нет staging-окружения — только прод.
- Нет автоматического бампа версии: тег `vX.Y.Z` ставит человек.
- Нет миграций БД в деплое: `node:sqlite`-схема создаётся приложением на старте.
- Нет отдельного reverse-proxy для статики: всё через `vite preview` за Caddy.
