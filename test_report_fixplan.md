# Fix plan: backend warmup battle limit

## Дефект

Авторизованный `POST /api/results` принимает 4-й разминочный бой для агента, у которого уже `stats.battles = 3`.

Production reproduction:

1. Агенты `9928` и `9929` получили 3 разминочных боя.
2. 4-й `POST /api/results` вернул HTTP `200`.
3. В ответе оба агента получили `stats.battles = 4`.

## Root cause

Ограничение 3 боев реализовано только на frontend/domain-client слое:

- `src/lib/store.js`: `MAX_WARMUP_BATTLES = 3`, `canPlayWarmup(participant)` проверяет `stats.battles < 3`.
- `src/pages/Arena.jsx`: `startManualFight()` блокирует запуск боя, если один из выбранных агентов не проходит `canPlayWarmup`.

Backend не повторяет эту проверку:

- `server.js`: `POST /api/results` сразу вызывает `agents.applyResult(req.body)`.
- `db.js`: `applyResult()` пересчитывает статистику и пишет battle row без проверки текущего `battles`.

## План исправления

1. Вынести или продублировать лимит `MAX_WARMUP_BATTLES = 3` в чистую shared/domain область, доступную backend. Лучше создать экспорт в `src/lib/scoring.js` рядом с `MAX_UPGRADES`, чтобы UI и backend брали одно значение.

2. Добавить backend-проверку перед начислением обычного разминочного результата:
   - применять только для `tournament: false`;
   - проверить, что оба агента существуют;
   - если `a.stats.battles >= MAX_WARMUP_BATTLES` или `b.stats.battles >= MAX_WARMUP_BATTLES`, вернуть ошибку без записи battle row и без изменения статистики;
   - HTTP-код: `403`;
   - error: `warmup_limit_reached`;
   - в ответ добавить текущих агентов/лимит, чтобы UI мог показать понятное состояние.

3. Сохранить текущую семантику турнира:
   - `POST /api/battles` для tournament history не должен менять разминочную статистику;
   - `POST /api/tournament/matches/:id/result` не должен зависеть от warmup лимита;
   - `POST /api/results` с `tournament: true` сейчас используется как обычное начисление и должен быть либо запрещен, либо явно задокументирован. Безопаснее для текущей архитектуры: warmup endpoint считает только `tournament: false`, tournament history остается через `/api/battles`.

4. Добавить тесты:
   - `tests/test-store-server.mjs`: создать двух агентов, провести 3 обычных боя, проверить, что 4-й `applyResult` возвращает `warmup_limit_reached` и stats не меняются;
   - `tests/test-api.mjs`: live API сценарий `POST /api/results` x3 -> 4-й HTTP `403`;
   - регрессия, что `recordBattle({ tournament: true })` по-прежнему не меняет stats.

5. Проверить:
   - `npm run test:unit`
   - `npm run test:api`
   - ручной или scripted production smoke на тестовых агентах после деплоя.

## Риск

Низкий. Исправление локальное и должно затронуть только запись разминочных результатов через `/api/results`. Главный риск - разъезд поведения старых клиентов, которые используют `/api/results` как универсальную запись результата. Его нужно снять тестом и, при необходимости, явной ошибкой для `tournament: true`.
