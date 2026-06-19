# Docker + Caddy + GitHub Actions Deploy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Собрать Docker-образ Debate Arena в GitHub Actions, пушить в приватный `leidruid/debate-arena` и деплоить по SSH через `docker compose`, с Caddy на фронте для reverse-proxy и auto-TLS домена `arena.gpb-dev.ru`.

**Architecture:** Один контейнер `app` запускает `npm start` (express `:3001` + `vite preview` `:5173`, который проксирует `/api` на express и инжектит `X-Arena-Key`). Контейнер `caddy` терминирует TLS и проксирует `arena.gpb-dev.ru` → `app:5173`. Деплой: push git-тега `vX.Y.Z` → Actions собирает образ `X.Y.Z-<shorthash>` + `latest`, пушит в Docker Hub, по SSH делает `docker compose pull && up -d` в `/opt/debate-arena/`. Рантайм-секреты — в `.env` на сервере, деплой их не трогает.

**Tech Stack:** Node 24 (bookworm-slim, нужен `node:sqlite`), Docker + docker compose, Caddy 2, GitHub Actions (`docker/build-push-action`, `appleboy/ssh-action` + `scp-action`).

## Global Constraints

- **Node ≥ 22** в образе (нужен встроенный `node:sqlite`); план фиксирует `node:24-bookworm-slim`.
- **`npm ci` ставит devDependencies** (`vite` + `concurrently` нужны в рантайме для `npm start`) — `NODE_ENV=production` выставлять ТОЛЬКО после `npm ci`.
- **express-порт зафиксирован 3001** — на него захардкожены vite-прокси (`vite.config.js`) и healthcheck. В `.env` не менять.
- **Образ:** `leidruid/debate-arena`, теги `X.Y.Z-<short7sha>` + `latest`; `latest` всегда на последнем собранном теге.
- **Каталог на сервере:** `/opt/debate-arena/` (фиксирован, не параметризуется).
- **Комментарии и текст — на русском** (стиль кодовой базы).
- **Каждый коммит завершать трейлером:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Работаем в ветке `feature/docker-caddy-deploy` (уже создана; в ней лежит спек).

## File Structure

| Файл | Ответственность | Задача |
|---|---|---|
| `vite.config.js` (modify) | прод-настройки `preview`: bind `0.0.0.0` + `allowedHosts` | 1 |
| `tests/test-preview-config.mjs` (create) | юнит-тест разрешённых хостов preview | 1 |
| `package.json` (modify) | подключить новый тест в `test:unit`/`test` | 1 |
| `Dockerfile` (create) | сборка образа (build + run `npm start`) | 2 |
| `.dockerignore` (create) | чистый контекст сборки | 2 |
| `docker-compose.yml` (create) | сервисы `app` + `caddy`, volumes | 3 |
| `Caddyfile` (create) | reverse-proxy + auto-TLS | 3 |
| `.github/workflows/deploy.yml` (create) | build → push → SSH-deploy | 4 |
| `.env.deploy.example` (create) | шаблон серверного `.env` | 5 |
| `DEPLOY.md` (create) | разовая настройка сервера + список секретов | 5 |

**Примечание по spec:** `ACME_EMAIL` из спека намеренно НЕ используется — пустая подстановка `{$ACME_EMAIL}` в Caddyfile ломает парсинг. Caddy получает сертификат без явного email (анонимный ACME-флоу). В `DEPLOY.md` укажем, как добавить email вручную при желании.

---

### Task 1: vite.config.js — bind 0.0.0.0 + allowedHosts для прод-preview

**Files:**
- Modify: `vite.config.js` (блок `preview`, ~стр. 27)
- Create: `tests/test-preview-config.mjs`
- Modify: `package.json:13-14` (скрипты `test` и `test:unit`)

**Interfaces:**
- Produces: контракт env-переменной **`ALLOWED_HOSTS`** (список доменов через запятую; пусто → разрешены все). Её потом задаёт `.env` (Task 5) и пробрасывает `env_file` в compose (Task 3).
- Default-экспорт `vite.config.js` — функция `({ mode }) => config`; вызывается в тесте как `factory({ mode: "production", command: "serve" })`, возвращает объект с `.preview.host` и `.preview.allowedHosts`.

- [ ] **Step 1: Написать падающий тест**

Create `tests/test-preview-config.mjs`:

```js
// Юнит-тест прод-настроек vite preview (host + allowedHosts), без сети и без сборки.
// Дёргаем фабрику конфига напрямую и проверяем разрешённые хосты по ALLOWED_HOSTS.
import configFactory from "../vite.config.js";

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
}
const resolve = () => configFactory({ mode: "production", command: "serve" });

console.log("\n=== TC-PREVIEW: прод-настройки vite preview ===");

// 1. Без ALLOWED_HOSTS — слушаем 0.0.0.0 и разрешаем любые хосты (локальный npm start).
delete process.env.ALLOWED_HOSTS;
let cfg = resolve();
check("host=true (bind 0.0.0.0)", cfg.preview.host === true);
check("allowedHosts=true когда ALLOWED_HOSTS пуст", cfg.preview.allowedHosts === true);

// 2. С одним доменом — ровно он в списке.
process.env.ALLOWED_HOSTS = "arena.gpb-dev.ru";
cfg = resolve();
check("один домен → [arena.gpb-dev.ru]",
  Array.isArray(cfg.preview.allowedHosts) &&
  cfg.preview.allowedHosts.length === 1 &&
  cfg.preview.allowedHosts[0] === "arena.gpb-dev.ru");

// 3. Список через запятую с пробелами — триммится и бьётся по элементам.
process.env.ALLOWED_HOSTS = "arena.gpb-dev.ru, foo.local";
cfg = resolve();
check("список → [arena.gpb-dev.ru, foo.local]",
  JSON.stringify(cfg.preview.allowedHosts) === JSON.stringify(["arena.gpb-dev.ru", "foo.local"]));

delete process.env.ALLOWED_HOSTS;
console.log(`\n  Итого: ${passed} ✅ / ${failed} ❌`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `node tests/test-preview-config.mjs`
Expected: FAIL — `host=true` и список не сойдутся (сейчас `preview` без `host`/`allowedHosts`, `cfg.preview.host` === `undefined`). Ненулевой exit-код.

- [ ] **Step 3: Внести правку в `vite.config.js`**

Заменить блок:

```js
    preview: { port: 5173, proxy },
```

на:

```js
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
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `node tests/test-preview-config.mjs`
Expected: PASS — `Итого: 4 ✅ / 0 ❌`, exit 0.

- [ ] **Step 5: Подключить тест в npm-скрипты**

В `package.json` дописать запуск нового теста в `test` и `test:unit` (он офлайновый/детерминированный — место ему рядом с остальными unit). Заменить строки:

```json
    "test": "node tests/test-degradation.mjs && node tests/test-tournament.mjs && node tests/test-store-server.mjs && node tests/test-fight-integrity.mjs",
    "test:unit": "node tests/test-degradation.mjs && node tests/test-tournament.mjs && node tests/test-store-server.mjs",
```

на:

```json
    "test": "node tests/test-degradation.mjs && node tests/test-tournament.mjs && node tests/test-store-server.mjs && node tests/test-preview-config.mjs && node tests/test-fight-integrity.mjs",
    "test:unit": "node tests/test-degradation.mjs && node tests/test-tournament.mjs && node tests/test-store-server.mjs && node tests/test-preview-config.mjs",
```

- [ ] **Step 6: Прогнать unit-набор**

Run: `npm run test:unit`
Expected: все файлы зелёные, включая `TC-PREVIEW`, exit 0.

- [ ] **Step 7: Коммит**

```bash
git add vite.config.js tests/test-preview-config.mjs package.json
git commit -m "$(cat <<'EOF'
feat: прод-настройки vite preview (host 0.0.0.0 + allowedHosts)

vite preview за Caddy: слушать 0.0.0.0 и пускать чужой Host из
ALLOWED_HOSTS (иначе 403 Blocked request). Пусто → разрешить все,
локальный npm start не ломается. Юнит-тест на разрешённые хосты.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Dockerfile + .dockerignore

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

**Interfaces:**
- Produces: образ, слушающий `5173` (фронт+прокси) и `3001` (express); healthcheck на `http://localhost:3001/api/health`. Команда `npm start`. Это потребляет `docker-compose.yml` (Task 3) и workflow (Task 4) под именем `leidruid/debate-arena`.
- Consumes: правку `vite.config.js` из Task 1 (preview host/allowedHosts) — без неё контейнер за Caddy не отвечал бы.

- [ ] **Step 1: Создать `.dockerignore`**

```
node_modules
.git
.gitignore
.env
.env.*
dist
data
logs
*.log
.idea
.DS_Store
docs
.github
tests
print/*.pdf
img.png
```

- [ ] **Step 2: Создать `Dockerfile`**

```dockerfile
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
  CMD node -e "fetch('http://localhost:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# express :3001 + vite preview :5173 (concurrently)
CMD ["npm", "start"]
```

- [ ] **Step 3: Собрать образ (нужна сеть для npm-реестра)**

Run: `docker build -t debate-arena:plan-test .`
Expected: сборка доходит до конца, последняя строка вида `naming to docker.io/library/debate-arena:plan-test`. Если окружение без доступа в интернет к npm-реестру — этот шаг ставится на сервере/в CI; зафиксировать как известное ограничение и не блокировать остальные шаги.

- [ ] **Step 4: Smoke-тест контейнера (без реальных ключей)**

Run:

```bash
docker rm -f arena-smoke 2>/dev/null || true
docker run -d --name arena-smoke -p 8088:5173 debate-arena:plan-test
# дождаться старта express+preview
for i in $(seq 1 30); do
  curl -fsS http://localhost:8088/api/health >/dev/null 2>&1 && break || sleep 1
done
echo "--- health ---"; curl -fsS http://localhost:8088/api/health; echo
echo "--- index ---"; curl -fsS -o /dev/null -w "%{http_code}\n" http://localhost:8088/
docker rm -f arena-smoke
```

Expected:
- `--- health ---` печатает JSON с `"ok":true` (и `"keyConfigured":false` — ключа нет, это норма).
- `--- index ---` печатает `200` (vite preview отдаёт собранный `index.html`).

- [ ] **Step 5: Коммит**

```bash
git add Dockerfile .dockerignore
git commit -m "$(cat <<'EOF'
feat: Dockerfile + .dockerignore (Node 24, npm start, healthcheck)

Один контейнер: vite preview :5173 + express :3001 через npm start.
node:24-bookworm-slim ради node:sqlite и беспроблемного vite build.
Запуск из-под node, healthcheck на /api/health.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: docker-compose.yml + Caddyfile

**Files:**
- Create: `docker-compose.yml`
- Create: `Caddyfile`

**Interfaces:**
- Consumes: образ `leidruid/debate-arena:${IMAGE_TAG:-latest}` (Task 2), env-переменные из `.env` (Task 5): `DOMAIN`, `ALLOWED_HOSTS`, `LLM_*`, `ARENA_*` и т.д.
- Produces: разворачиваемый стек, который scp+ssh-деплоит workflow (Task 4) в `/opt/debate-arena/`. `app` наружу не публикуется (`expose`), наружу торчит только `caddy` (`80/443`).

- [ ] **Step 1: Создать `Caddyfile`**

```
# Reverse-proxy + auto-TLS для Debate Arena. Домен берётся из env DOMAIN
# (подставляет docker compose из .env). Сертификат Let's Encrypt — автоматически
# (нужны открытые порты 80 и 443 и A-запись DOMAIN → IP сервера).
{$DOMAIN} {
	encode zstd gzip
	reverse_proxy app:5173
}
```

- [ ] **Step 2: Создать `docker-compose.yml`**

```yaml
services:
  app:
    image: leidruid/debate-arena:${IMAGE_TAG:-latest}
    restart: unless-stopped
    env_file: .env            # LLM_*, ARENA_*, ALLOWED_HOSTS, PORT=3001 и т.д.
    volumes:
      - arena-data:/app/data  # sqlite-БД (ARENA_DB_FILE=data/arena.db)
      - arena-logs:/app/logs  # JSONL-лог обращений к моделям
    expose:
      - "5173"                # только во внутреннюю сеть compose; наружу — через caddy
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s

  caddy:
    image: caddy:2
    restart: unless-stopped
    depends_on:
      - app
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"         # HTTP/3
    environment:
      - DOMAIN=${DOMAIN}      # подставляется в Caddyfile ({$DOMAIN})
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data      # сертификаты — переживают рестарт
      - caddy-config:/config

volumes:
  arena-data:
  arena-logs:
  caddy-data:
  caddy-config:
```

- [ ] **Step 3: Провалидировать Caddyfile**

Run:

```bash
docker run --rm -e DOMAIN=arena.gpb-dev.ru \
  -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2 caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile
```

Expected: строка `Valid configuration` (предупреждения о глобальных опциях допустимы), exit 0.

- [ ] **Step 4: Провалидировать compose (не затирая возможный локальный `.env`)**

Run:

```bash
CREATED=0
if [ ! -f .env ]; then cp .env.example .env; CREATED=1; fi
DOMAIN=arena.gpb-dev.ru IMAGE_TAG=plan-test docker compose config -q && echo "compose OK"
[ "$CREATED" = 1 ] && rm -f .env
true
```

Expected: печатает `compose OK`, exit 0 (синтаксис и интерполяция `${IMAGE_TAG}`/`${DOMAIN}` валидны). Гард не трогает уже существующий `.env`.

- [ ] **Step 5: Коммит**

```bash
git add docker-compose.yml Caddyfile
git commit -m "$(cat <<'EOF'
feat: docker-compose + Caddyfile (app + caddy, auto-TLS)

app (vite preview + express) только во внутренней сети, наружу торчит
caddy на 80/443 с auto-TLS для DOMAIN. Named-volumes под sqlite-БД,
логи и сертификаты. Образ leidruid/debate-arena:${IMAGE_TAG:-latest}.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: GitHub Actions workflow

**Files:**
- Create: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: `Dockerfile` (Task 2), `docker-compose.yml` + `Caddyfile` (Task 3); GitHub-секреты `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`, `SSH_HOST`, `SSH_USER`, `SSH_KEY`, `SSH_PORT?` (Task 5/DEPLOY.md).
- Produces: на push тега `vX.Y.Z` — образы `leidruid/debate-arena:X.Y.Z-<short7sha>` и `:latest` + деплой в `/opt/debate-arena/`.

- [ ] **Step 1: Создать `.github/workflows/deploy.yml`**

```yaml
name: build-and-deploy

on:
  push:
    tags:
      - "v*.*.*"
  workflow_dispatch:

env:
  IMAGE: leidruid/debate-arena

jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      image_tag: ${{ steps.meta.outputs.image_tag }}
    steps:
      - uses: actions/checkout@v4

      - name: Вычислить тег образа (semver + short sha)
        id: meta
        run: |
          if [ "${GITHUB_REF_TYPE}" = "tag" ]; then
            VERSION="${GITHUB_REF_NAME#v}"
          else
            VERSION="$(node -p "require('./package.json').version")"
          fi
          SHORT_SHA="${GITHUB_SHA::7}"
          echo "image_tag=${VERSION}-${SHORT_SHA}" >> "$GITHUB_OUTPUT"
          echo "Тег образа: ${VERSION}-${SHORT_SHA}"

      - uses: docker/setup-buildx-action@v3

      - name: Логин в Docker Hub
        uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}

      - name: Сборка и пуш (тег + latest)
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            ${{ env.IMAGE }}:${{ steps.meta.outputs.image_tag }}
            ${{ env.IMAGE }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Копировать compose и Caddyfile на сервер
        uses: appleboy/scp-action@v0.1.7
        with:
          host: ${{ secrets.SSH_HOST }}
          username: ${{ secrets.SSH_USER }}
          key: ${{ secrets.SSH_KEY }}
          port: ${{ secrets.SSH_PORT || 22 }}
          source: "docker-compose.yml,Caddyfile"
          target: "/opt/debate-arena"

      - name: Деплой (pull + up) на сервере
        uses: appleboy/ssh-action@v1.2.0
        env:
          IMAGE_TAG: ${{ needs.build.outputs.image_tag }}
          DOCKERHUB_USERNAME: ${{ secrets.DOCKERHUB_USERNAME }}
          DOCKERHUB_TOKEN: ${{ secrets.DOCKERHUB_TOKEN }}
        with:
          host: ${{ secrets.SSH_HOST }}
          username: ${{ secrets.SSH_USER }}
          key: ${{ secrets.SSH_KEY }}
          port: ${{ secrets.SSH_PORT || 22 }}
          envs: IMAGE_TAG,DOCKERHUB_USERNAME,DOCKERHUB_TOKEN
          script: |
            set -e
            cd /opt/debate-arena
            echo "$DOCKERHUB_TOKEN" | docker login -u "$DOCKERHUB_USERNAME" --password-stdin
            export IMAGE_TAG="${IMAGE_TAG}"
            docker compose pull
            docker compose up -d
            docker image prune -f
            docker logout
```

- [ ] **Step 2: Провалидировать YAML**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('.github/workflows/deploy.yml','utf8');const yaml=require('./node_modules/vite/dist/node/chunks/*');" 2>/dev/null || python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml')); print('yaml OK')"`
Expected: `yaml OK` (python3 + PyYAML обычно есть на dev-машине/в CI). Если PyYAML нет — пропустить парс, выполнить Step 3.

- [ ] **Step 3: Проверить наличие ключевых блоков (грубая страховка)**

Run:

```bash
grep -q 'tags:' .github/workflows/deploy.yml \
 && grep -q 'v\*\.\*\.\*' .github/workflows/deploy.yml \
 && grep -q 'leidruid/debate-arena' .github/workflows/deploy.yml \
 && grep -q ':latest' .github/workflows/deploy.yml \
 && grep -q 'appleboy/scp-action' .github/workflows/deploy.yml \
 && grep -q 'appleboy/ssh-action' .github/workflows/deploy.yml \
 && grep -q '/opt/debate-arena' .github/workflows/deploy.yml \
 && echo "workflow OK"
```

Expected: печатает `workflow OK`.

Примечание: полноценный прогон workflow невозможен без push тега и настроенных секретов — это проверяется при первом релизе (см. `DEPLOY.md`).

- [ ] **Step 4: Коммит**

```bash
git add .github/workflows/deploy.yml
git commit -m "$(cat <<'EOF'
feat: GitHub Actions — build, push в Docker Hub и SSH-деплой

Триггер: push тега vX.Y.Z. Образ X.Y.Z-<short sha> + latest пушится
в приватный leidruid/debate-arena, затем по SSH docker compose pull/up
в /opt/debate-arena. Кэш слоёв через gha.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `.env.deploy.example` + `DEPLOY.md`

**Files:**
- Create: `.env.deploy.example`
- Create: `DEPLOY.md`

**Interfaces:**
- Consumes: имена env-переменных приложения из `.env.example`, плюс `DOMAIN`/`ALLOWED_HOSTS` (Task 1/3). Список секретов согласован с workflow (Task 4).
- Produces: эталон серверного `.env` и инструкцию по разовой настройке.

- [ ] **Step 1: Создать `.env.deploy.example`**

```bash
# Серверный .env для Debate Arena. Скопируй в /opt/debate-arena/.env и заполни.
# docker compose подхватывает его автоматически (env_file для app + интерполяция ${DOMAIN}).

# --- Деплой/инфраструктура ---
# Домен для Caddy (auto-TLS) и список разрешённых хостов для vite preview.
DOMAIN=arena.gpb-dev.ru
ALLOWED_HOSTS=arena.gpb-dev.ru

# --- Ключ LLM-сервиса ---
LLM_API_KEY=sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxxxxxx
LLM_BASE_URL=https://openrouter.ai/api/v1

# --- Модели по тирам деградации (первая основная, остальные фоллбэки тира) ---
LLM_TIER_1=openai/gpt-oss-120b:free
LLM_TIER_2=meta-llama/llama-3.3-70b-instruct:free
LLM_TIER_3=openai/gpt-oss-20b:free
LLM_TIER_JUDGE=
LLM_MAX_TOKENS_JUDGE=
LLM_TIER_RANDOM=0
LLM_FALLBACKS=qwen/qwen3-next-80b-a3b-instruct:free,meta-llama/llama-3.3-70b-instruct:free,openai/gpt-oss-20b:free

# --- Reasoning ---
LLM_REASONING_EFFORT=off
LLM_REASONING_EFFORT_JUDGE=

# --- Legacy / порт ---
# PORT НЕ менять: на 3001 захардкожены vite-прокси и healthcheck контейнера.
LLM_MODEL=openai/gpt-oss-120b:free
PORT=3001

# --- Логи (пути — внутри volume контейнера) ---
LLM_LOG=1
LLM_LOG_FILE=logs/llm-usage.jsonl

# --- Интеграция с ботом (API управления агентами) ---
# Сгенерируй длинную случайную строку (например: openssl rand -hex 32).
ARENA_API_KEY=
# Файл БД внутри volume arena-data.
ARENA_DB_FILE=data/arena.db
```

- [ ] **Step 2: Проверить, что не потеряли ни одной app-переменной**

Run:

```bash
comm -23 \
  <(grep -oE '^[A-Z_]+=' .env.example | sort -u) \
  <(grep -oE '^[A-Z_]+=' .env.deploy.example | sort -u)
```

Expected: ПУСТОЙ вывод (каждый ключ из `.env.example` присутствует в `.env.deploy.example`).

- [ ] **Step 3: Создать `DEPLOY.md`**

````markdown
# Деплой Debate Arena

CI/CD: push git-тега `vX.Y.Z` → GitHub Actions собирает Docker-образ
`leidruid/debate-arena:X.Y.Z-<short sha>` (+ `latest`), пушит в Docker Hub и
по SSH деплоит на сервер через `docker compose`. Перед приложением — Caddy
(reverse-proxy + auto-TLS) для `arena.gpb-dev.ru`.

## GitHub Secrets

Settings → Secrets and variables → Actions → **Secrets**:

| Secret | Значение |
|---|---|
| `DOCKERHUB_USERNAME` | `leidruid` |
| `DOCKERHUB_TOKEN` | Access Token из hub.docker.com (Account → Security) с правом записи в `leidruid/debate-arena` |
| `SSH_HOST` | IP/хост сервера |
| `SSH_USER` | пользователь деплоя (в группе `docker`, владелец `/opt/debate-arena`) |
| `SSH_KEY` | приватный SSH-ключ пользователя (весь PEM-блок) |
| `SSH_PORT` | порт SSH, если не 22 (иначе можно не заводить) |

GitHub-переменные (`Variables`) не нужны — путь `/opt/debate-arena/` зашит в workflow.

## Разовая настройка сервера

1. Установить Docker Engine + плагин `docker compose`.
2. DNS: `A`-запись `arena.gpb-dev.ru` → IP сервера.
3. Открыть порты **80** и **443** (ACME-челлендж + раздача; для HTTP/3 — `443/udp`).
4. Создать `/opt/debate-arena/`, владелец — пользователь деплоя.
5. Положить в `/opt/debate-arena/.env` заполненный файл по образцу
   [`.env.deploy.example`](.env.deploy.example) (ключи LLM, `ARENA_API_KEY`,
   `DOMAIN`, `ALLOWED_HOSTS`).
6. Добавить публичную часть `SSH_KEY` в `~/.ssh/authorized_keys` пользователя деплоя.

`docker-compose.yml` и `Caddyfile` копируются на сервер автоматически при каждом
деплое (scp), вручную класть их не нужно. `.env` деплой не трогает.

## Релиз

```bash
git tag v1.2.3
git push origin v1.2.3
```

Workflow соберёт `leidruid/debate-arena:1.2.3-<short sha>`, переедет `latest` на
него и развернёт на сервере. Ручной прогон — `workflow_dispatch` (версия берётся
из `package.json`).

## Проверка после деплоя

```bash
# на сервере
cd /opt/debate-arena && docker compose ps        # app healthy, caddy up
curl -fsS https://arena.gpb-dev.ru/api/health    # {"ok":true,...}
```

## Опционально: email для ACME

Caddy выпускает сертификат и без email. Если нужен email для уведомлений CA,
добавь в начало `Caddyfile` глобальный блок и впиши адрес явно:

```
{
	email you@example.com
}
```
````

- [ ] **Step 4: Коммит**

```bash
git add .env.deploy.example DEPLOY.md
git commit -m "$(cat <<'EOF'
docs: шаблон серверного .env и инструкция по деплою

.env.deploy.example — все app-переменные + DOMAIN/ALLOWED_HOSTS.
DEPLOY.md — список GitHub-секретов, разовая настройка сервера,
порядок релиза по git-тегу.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Финальная проверка (после всех задач)

- [ ] `npm run test:unit` — зелёный (включая `TC-PREVIEW`).
- [ ] `docker build -t debate-arena:plan-test .` — успешно (если есть сеть к npm).
- [ ] `git log --oneline` показывает 5 осмысленных коммитов в `feature/docker-caddy-deploy`.
- [ ] Готов список того, что пользователь заводит в GitHub (Task 5 / `DEPLOY.md`).
- [ ] Напомнить пользователю: завести секреты, подготовить сервер (`/opt/debate-arena/.env`, DNS, порты), затем `git tag vX.Y.Z && git push origin vX.Y.Z` для первого релиза.

## Self-Review

**Spec coverage:**
- SSH + docker compose деплой → Task 4. ✓
- Тег `X.Y.Z-<shorthash>` + `latest` на последнем теге → Task 4 (build.meta). ✓
- Приватный `leidruid/debate-arena` → Task 4 (login + push). ✓
- Caddy reverse-proxy + auto-TLS, только проксирование → Task 3 (Caddyfile). ✓
- `vite preview` за Caddy + правка `vite.config.js` → Task 1. ✓
- `node:sqlite` / Node ≥ 22 + персистентные volumes → Task 2 (Node 24) + Task 3 (arena-data/arena-logs). ✓
- `.env` на сервере, деплой не трогает → Task 4 (только scp compose+Caddyfile) + Task 5. ✓
- Список GitHub-секретов и переменных → Task 5 (`DEPLOY.md`). ✓
- Путь `/opt/debate-arena/` → Task 4 (scp target, ssh `cd`). ✓
- `ACME_EMAIL` сознательно опущен (пустая подстановка ломает Caddyfile) → отражено в File Structure note + Task 5 (опциональный блок). ✓

**Placeholder scan:** плейсхолдеров-заглушек нет; все файлы приведены целиком, команды и ожидаемый вывод указаны. ✓

**Type/naming consistency:** `ALLOWED_HOSTS`, `IMAGE_TAG`, `DOMAIN`, `leidruid/debate-arena`, `/opt/debate-arena`, порт `3001`/`5173` — единообразны во всех задачах. `image_tag` (output) → `IMAGE_TAG` (env) согласованы в Task 4. ✓
