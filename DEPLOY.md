# Деплой Debate Arena

CI/CD: push git-тага `vX.Y.Z` → GitHub Actions собирает Docker-образ
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
