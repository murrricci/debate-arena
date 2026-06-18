# План: интеграция debate-arena ↔ bot-conf-max (API управления агентами)

## Контекст

`debate-arena` — конференц-активность: два ИИ-агента спорят на «ринге», судья оценивает раунды,
табло показывает результаты. Сейчас все настройки агентов и очки живут **только в localStorage
браузера киоска** (`src/lib/store.js`), бэкенд (`server.js`) — stateless-прокси к LLM.

`bot-conf-max` — Python-проект (Flask-сайт + бот платформы MAX, PostgreSQL), через который
посетители конференции регистрируются и пользуются сервисами стенда.

Нужно дать посетителям возможность настраивать своего бойца **из привычной площадки бота**
(и с сайта, и из мессенджера), при этом боевая механика и табло остаются в `debate-arena`.
Для этого `debate-arena` обзаводится собственным хранилищем и REST API, а `bot-conf-max`
становится его клиентом. Лимит: пользователь может **отредактировать агента 3 раза**, затем блок.

### Зафиксированные с пользователем решения
1. **Источник правды — собственная БД внутри debate-arena.** Она владеет агентами и отдаёт их по REST API; бот — клиент.
2. **UI настройки переносится в bot-conf-max и на веб (Flask/Banka UI), и в MAX-бот** (пошаговый wizard).
3. **Register.jsx в debate-arena остаётся** как операторский инструмент на стенде (ручное добавление участника).
4. **Объём API — агенты + результаты боёв** (бот показывает пользователю счёт/историю/место).
5. **Лимит правок авторитетно на сервере debate-arena** (переиспользуем уже существующую семантику `MAX_UPGRADES`).

### Проверенные факты окружения
- debate-arena: **Node v26.2.0**, встроенный `node:sqlite` (`DatabaseSync`) доступен без флагов и без новых зависимостей. `store.js` — синхронные геттеры + `MAX_UPGRADES=3`, `write()` рассылает изменения через `publish()` (`bus.js`/BroadcastChannel). Прокси Vite: `/api/*` → `:3001`.
- bot-conf-max: в зависимостях есть `aiohttp` (нет `requests`); Flask синхронно вызывает async через `run_async()` (`src/web/main.py:233`) ⇒ **один async-клиент** годится и для бота, и для веба. `session["user_id"]` хранит внутренний `bot.users.id` (`main.py:290`). Миграции yoyo в `src/migrations/`, последняя — `20260424_z_indexes`.

---

## Архитектура и поток данных

```
 MAX-бот (wizard) ─┐
                   ├─► src/common/arena.py (aiohttp, X-Arena-Key) ──► debate-arena REST API ──► node:sqlite (data/arena.db)
 Flask /agent     ─┘                                                         ▲
                                                                             │ POST /api/results (через Vite-proxy с инжектом ключа)
 Киоск Arena.jsx ── store.js (кэш+API-клиент) ── polling GET /api/agents ────┘
 Табло Scoreboard.jsx ── (BroadcastChannel между окнами киоска, без изменений)
```

Источник правды по агентам и результатам — `data/arena.db` в debate-arena. bot-conf-max хранит
лишь лёгкий кэш-линк (`bot.arena_agents`) для graceful degradation, когда API недоступен.

---

## Канонический контракт REST API (согласован между обеими сторонами)

Базовый префикс `/api`. Аутентификация сервис-сервис: заголовок **`X-Arena-Key`** = env `ARENA_API_KEY`
(сравнение через `crypto.timingSafeEqual`). Идентификатор пользователя — строковый `externalId`
(= `bot.users.id`). Инвариант «один пользователь = один агент» обеспечивает `UNIQUE(external_id)`.

| Метод | Путь | Auth | Назначение |
|---|---|---|---|
| `GET` | `/api/meta/form` | открытый | Справочники для формы: `{skills:[{id,name,emoji,color,prompt}], config:{defaults, memory, temperature:{min,max,step,zones}, replyLen, focus, judge}, limits:{maxUpgrades:3}}`. Сервер импортирует `src/data/skills.js` и `src/data/agentConfig.js` напрямую (чистый JS, без браузерных API). |
| `GET` | `/api/agents/by-external/:externalId` | `X-Arena-Key` | `{agent, upgradesLeft, locked}` или `404`. |
| `POST` | `/api/agents` | `X-Arena-Key` | Создать. Body `{externalId, name, skills[], custom?, config?, source:"bot"}`. `201 {agent, upgradesLeft}`; `400` валидация; `409 {error:"agent_exists", agent}`. |
| `PATCH` | `/api/agents/by-external/:externalId` | `X-Arena-Key` | Обновить с проверкой лимита. `200 {agent, upgradesLeft}`; `403 {error:"upgrade_limit_reached", upgradesLeft:0}`; `404`. |
| `GET` | `/api/results/by-external/:externalId` | `X-Arena-Key` | `{agent:{id,name,stats}, rank, total, history:[{opponentName, result, scoreSelf, scoreOpp, topic, tournament, at}]}` (history с `?limit=`). |
| `GET` | `/api/agents` | открытый | Ростер для фронта/табло: `{agents:[...]}`. |
| `GET/PATCH/DELETE` | `/api/agents/:id` | local-trusted | Операторские операции по внутреннему uuid (Register.jsx). |
| `POST` | `/api/results` | `X-Arena-Key` | Приём результата боя от киоска. Body `{aId,bId,winner:"A|B|draw",scoreA,scoreB,topic?,tournament?}`. Сервер начисляет очки и пишет историю; `200 {a,b}`. |
| `GET` | `/api/results/leaderboard` | открытый | `{leaderboard:[{id,name,externalId,stats,rank}]}`. |

Существующие `POST /api/claude` и `GET /api/health` и глобальный `app.use(cors())` — **не трогаем**.

---

## Часть A. Изменения в debate-arena (`/home/claude/debate-arena`)

### A1. Персистентность — `node:sqlite`, новый модуль `db.js` (рядом с `server.js`)
- Файл БД `data/arena.db`, при старте: `PRAGMA journal_mode=WAL; foreign_keys=ON; busy_timeout=5000`. Добавить `data/` в `.gitignore`. **Новых npm-зависимостей нет.**
- Запросы `DatabaseSync` синхронны ⇒ каждый HTTP-хендлер выполняет read-modify-write атомарно (Node однопоточен, между sync-вызовами нет точки await) — это устраняет гонки текущего JSON-подхода.
- Схема:
  - `agents(id TEXT PK, external_id TEXT UNIQUE NULL, name, skills TEXT json, custom TEXT, config TEXT json, upgrades INT, created_at INT, wins, losses, draws, battles, points, source TEXT)` + partial unique index по `external_id WHERE NOT NULL` (операторские агенты Register.jsx имеют `external_id=NULL`).
  - `battles(id PK, a_id, b_id, winner, score_a, score_b, topic, tournament, created_at)` + индексы по `a_id`,`b_id`.
- Хелпер `rowToParticipant(row)` отдаёт **ровно текущую форму** participant (`{id,name,skills[],custom,config,upgrades,createdAt,stats:{...}}`), чтобы фронт не переписывать.
- Экспорт: `initDb, listAgents, getAgentById, getAgentByExternalId, createAgent, upgradeAgent (enforcement лимита в транзакции), applyResult (stats+battle в одной транзакции), leaderboard, userHistory, userRank, resetScoresFor`.
- Вынести формулу очков из `store.js` (`applyResult`, строки ~84–106: победа +3 и бонус `round(margin/20)`, ничья +1) в чистый `src/lib/scoring.js`, импортируемый и `db.js`, и тестами — **считает очки только сервер**.

### A2. `server.js` — добавить API
- При старте: `import { initDb } from "./db.js"; initDb();`.
- Middleware `requireArenaKey` (timingSafeEqual с `process.env.ARENA_API_KEY`; если ключ не задан — предупреждение в лог и `401` на мутации, как уже сделано для отсутствующего LLM-ключа).
- Роуты из таблицы контракта. Открытыми остаются `GET /api/meta/form`, `GET /api/agents`, `GET /api/results/leaderboard`.
- Валидация на сервере: `name` 1–40; `skills` ⊆ известных id из `SKILL_CARDS`, ≥1; `custom` ≤800; clamp `temperature`∈[0.1,1.5], `windowSize`∈[2,6]; enum-поля config.

### A3. Лимит правок (authoritative)
- Семантика **подтверждена по коду** (`store.js:35`, тест `test-tournament.mjs`): создание = `upgrades:0`, далее 3 правки (`upgrades` 1→2→3), 4-я → отказ. ⇒ **создание + 3 редактирования, затем блок.**
- Enforce в `db.js::upgradeAgent` внутри SQLite-транзакции: при `upgrades>=MAX_UPGRADES` → `{error:"upgrade_limit_reached"}` (HTTP `403`). В каждом GET агента отдаём `upgradesLeft` и `locked`.
- `MAX_UPGRADES` отдаём и в `/api/meta/form.limits.maxUpgrades`, чтобы клиент и сервер не разъехались.

### A4. Фронтенд без поломки дизайна (`store.js` → клиент+кэш)
- **JSX/стили Arena/Scoreboard/Register не меняем.** Меняем только `store.js` и точки вызова мутаций.
- `store.js` превращается в тонкий API-клиент с синхронным in-memory `cache` (зеркалится в localStorage как fallback):
  - Геттеры `getParticipants/getParticipant/leaderboard` **остаются синхронными** (читают `cache`) — компоненты вроде `useState(getParticipants())` не трогаем.
  - `addParticipant/upgradeParticipant/applyResult/removeParticipant/resetScores*` становятся `async`, шлют запрос на сервер, по ответу обновляют `cache` + `publish("participants")`.
  - `syncFromServer()` (`GET /api/agents`) при старте + **polling каждые ~5 c** (на стенде агенты меняются редко) — так фронт подхватывает изменения, сделанные ботом с другой машины. BroadcastChannel (`bus.js`) и `publish("live", ...)` из `Arena.jsx` — **без изменений**.
  - Локальный пересчёт очков из `store.js` убираем (его делает сервер в `POST /api/results`).
- Точечно добавить `await`: `Arena.jsx` (вызов `applyResult`, передать `topic`/`tournament`), `Register.jsx` (submit/upgrade/closeAndStart), `Scoreboard.jsx` (`resetScores`), `tournament.js` (`closeAndStart`/`resetScoresFor`). `MAX_UPGRADES` остаётся экспортом из `store.js` (его импортирует `Guide.jsx`).
- **Аутентификация `POST /api/results` без утечки ключа в браузер:** инжект заголовка `X-Arena-Key` в Vite-прокси (`vite.config.js`, `server.proxy` **и** `preview.proxy`, `configure(proxy)` → `proxyReq.setHeader` из `process.env.ARENA_API_KEY`). Покрывает и `npm run dev`, и стендовый `npm start` (proxy + `vite preview`). Секрет остаётся серверным.
- **Миграция localStorage → БД:** одноразово при первом запуске (флаг `debate-arena:migrated`): если сервер пуст, а в localStorage есть участники — заслать их как `source:"operator"`, `external_id=NULL`, UPSERT по существующему `id`.

### A5. Тесты debate-arena
- Новый `tests/test-store-server.mjs`: юнит против `db.js` с `new DatabaseSync(":memory:")` — лимит 3 правок, начисление очков, `rank`, история. Без сети и без моков localStorage.
- Доменную логику очков существующих `test-degradation/test-tournament` перевести на `src/lib/scoring.js`.
- (опц.) `tests/test-api.mjs` — живой e2e: `create → upgrade×3 → 403 → result → leaderboard → history`. Скрипт `test:api` в `package.json`.

---

## Часть B. Изменения в bot-conf-max (`/home/claude/bot-conf-max`)

### B1. Клиент API — новый `src/common/arena.py`
- Один **async-клиент `ArenaClient`** на `aiohttp` (уже в зависимостях). Бот зовёт напрямую, Flask — через существующий `run_async(...)`.
- Конфиг из env: `ARENA_API_URL`, `ARENA_API_KEY` (заголовок `X-Arena-Key`), таймаут ~8 c. Свойство `enabled` (оба env заданы).
- Методы по каноническому контракту: `get_form()` (справочники/скиллы), `get_agent(user_id)`, `create_agent(user_id, payload)`, `update_agent(user_id, payload)`, `get_results(user_id)`, `get_leaderboard(limit)`.
- Конвенция возврата как в `src/bot/api.py`: данные **или** `{"error": ...}` (`unauthorized`/`upgrade_limit_reached`/`not_found`/`arena_unavailable`/`validation`) — для единообразной graceful degradation. Остаток правок/блок берём **только из ответов API**, локально не считаем.
- Инстанс создаётся там же, где `db`: в `Bot.__init__` (`bot.py`) и рядом с `web_bot` в `src/web/main.py`.

### B2. Кэш-линк — миграция `src/migrations/20260618_arena_agents.sql` (`depends: 20260424_z_indexes`)
- Таблица `bot.arena_agents(id, user_id UNIQUE → bot.users.id, arena_agent_id TEXT, agent_name TEXT, edits_left INT DEFAULT 3, locked SMALLINT DEFAULT 0, draft TEXT DEFAULT '{}', last_synced, created_at, updated_at)`.
  - `draft` хранит частично заполненный bot-wizard между шагами (как `feedbacks.results`).
  - Остальное — кэш флагов лимита/имени для показа при недоступном API.
- Методы в `src/common/db_postgres.py`: `get_arena_link_by_db_id(user_id)`, `upsert_arena_link(user_id, **fields)` (UPSERT `ON CONFLICT(user_id)`), `set_arena_draft(user_id, draft)`. Кэш обновляем после каждого успешного `get_agent`/`update_agent`.

### B3. Веб-форма (Flask + Banka UI) — без поломки дизайна
- Роуты в `src/web/main.py` (тот же guard, что у `/quiz`: `session.get("user_id")` → `get_user_by_db_id` → `gdpr_accepted`):
  - `GET /agent` — рендер `agent.html`: справочник скиллов из `arena.get_form()`, текущий конфиг + `edits_left`/`locked` из `arena.get_agent`; при `arena_unavailable` — читаем кэш `bot.arena_agents`, форма read-only + баннер `.error`.
  - `POST /api/agent` — JSON-сабмит (по образцу `/api/quiz/.../answer`): серверная валидация (зеркало контракта) → `arena.create_agent`/`update_agent` → `upsert_arena_link`. Маппинг: `upgrade_limit_reached`→`409`, `validation`→`400`, `arena_unavailable`→`503`.
  - `GET /results` — экран результатов (B5).
- Новый шаблон `src/web/templates/agent.html` (`extends base.html`): переиспользуем классы `.content/.card/.btn/.btn-primary/.form-group/.error`; новые мелкие компоненты (сегмент-кнопки `.seg`, чипы скиллов `.skill`, слайдеры `input[type=range]`, счётчик символов) — в `{% block extra %}`, цвета только через CSS-переменные (`--primary #305EF2`, `--dark-surface`, `--dark-border`) — как `quiz_play.html` объявляет `.answer-btn`. Бейдж «Осталось правок: N» / «🔒 Правки исчерпаны», `disabled` при `locked`. Слайдер температуры 0.1–1.5; окно показывается только при `memory=window`.
- Пункты меню `🤖 Мой агент` и `🏆 Результаты` — в `base.html` (nav) и `main.html`.

### B4. MAX-бот wizard — новый `src/bot/bot_agent.py`
- Класс `BotAgent(api, db, cfg, arena)` по образцу `BotFeedback`/`BotQuiz`. Слайдеров в MAX нет ⇒ температура и окно — пресет-кнопки (`cold/fighter/chaos`), скиллы — тоггл-кнопки, имя и персона — текстовые сообщения.
- Новые состояния `bot.users.state`: `agent_name → agent_custom → agent_skills → agent_memory → (agent_window) → agent_temp → agent_replylen → agent_focus → agent_judge → save`. Промежуточные ответы — в `arena_agents.draft`.
- Проводка в `bot.py` (где quiz/feedback тоже проводятся вручную): `self.arena`, `self.agent` в `__init__`; ключи в словаре `handlers` (`AgentStart, AgentSkill, AgentSkillsDone, AgentMemory, AgentWindow, AgentTemp, AgentReplyLen, AgentFocus, AgentJudge, AgentResults`); ветки `agent_name`/`agent_custom` в `handle_stateful_message`; кнопка входа в `cmd_main`; `AgentSkill` исключить из авто-`answer_callback` (сами делаем `edit_message`, как `QuizSet`).
- `cmd_agent_start`: проверка регистрации (`gdpr_accepted`), показ остатка правок; при `locked` — отказ. Финал (`cmd_judge`): собрать payload, `create_agent`/`update_agent`, обработать `upgrade_limit_reached`, обновить кэш, вернуть state в `registered`.

### B5. Показ результатов (веб + бот)
- Источник — `arena.get_results(user_id)` (счёт/победы/поражения/история) и `arena.get_leaderboard()`.
- Веб: `results.html` (extends base) — крупный счёт блоком `.balance`, история карточками `.card`, лидерборд с подсветкой строки текущего пользователя. При `arena_unavailable` — `.error`.
- Бот: `cmd_results` — markdown-сообщение (счёт, место, последние бои) + `Keyboard.back()`.

### B6. Конфиг/секреты/тесты
- `.env.example`: `ARENA_API_URL`, `ARENA_API_KEY`; добавить `ARENA_API_KEY` в список маскируемых при логировании (`src/bot/main.py`, `src/web/main.py`).
- `.config.yaml`: блок `conference.agent` с текстами экранов/шагов/ошибок (+ `@property def agent` в `config.py`). Справочник скиллов в конфиг не кладём (берётся из API), опционально `agent.skillsFallback`.
- Тесты: `tests/test_arena.py` (мок `aiohttp`, маппинг статусов и таймаута); расширить `tests/test_bot.py` (полный wizard, лимит, create vs update) и `tests/test_web.py` (`/agent` GET/POST, `/results`), `conftest.py` (`MockConfig.agent`, методы `arena_agents` в `MockDatabase`, фикстура `mock_arena`). Держать покрытие ≥52% (`--cov-fail-under=52`).

---

## Edge cases (обе стороны)
- **API недоступен**: фронт debate-arena работает на localStorage-кэше; bot-conf-max показывает баннер, читает кэш `bot.arena_agents`, форма read-only, сохранение заблокировано с понятным текстом.
- **Лимит исчерпан**: авторитетно из API (`locked`/`403`), UI бота и веба отражают «🔒 3/3».
- **Пользователь не зарегистрирован**: те же редиректы/проверки `gdpr_accepted`, что у `/quiz` и других команд.
- **Имя профиль↔агент**: имя агента — отдельная сущность (источник правды — arena); если профильное `bot.users.name` пусто, опционально проставляем введённое имя. Обратную синхронизацию не навязываем.
- **Гонки/двойной сабмит**: счётчик правок ведёт только сервер; bot-conf-max лишь отображает значение из последнего ответа.

---

## Сводка файлов

**debate-arena — создать:** `db.js`, `src/lib/scoring.js`, `tests/test-store-server.mjs`, (опц.) `tests/test-api.mjs`.
**debate-arena — изменить:** `server.js` (API+auth), `src/lib/store.js` (клиент+кэш), `src/lib/tournament.js`, `src/pages/Arena.jsx`, `src/pages/Register.jsx`, `src/pages/Scoreboard.jsx`, `vite.config.js` (инжект ключа), `.env.example`, `.gitignore`, `package.json` (scripts).

**bot-conf-max — создать:** `src/common/arena.py`, `src/migrations/20260618_arena_agents.sql`, `src/bot/bot_agent.py`, `src/web/templates/agent.html`, `src/web/templates/results.html`, `tests/test_arena.py`.
**bot-conf-max — изменить:** `src/common/db_postgres.py`, `src/web/main.py`, `src/bot/bot.py`, `src/common/config.py`, `.config.yaml`, `.env.example`, `tests/conftest.py`, `tests/test_bot.py`, `tests/test_web.py`, `src/web/templates/base.html`, `src/web/templates/main.html`.

---

## Проверка (end-to-end)
1. **debate-arena юниты:** `npm run test:unit` + новый `test:store-server` — лимит 3, очки, ранк, история на `:memory:` БД.
2. **debate-arena API (живой):** поднять `node server.js`, прогнать `create → upgrade×3 → 403 → POST /api/results → GET leaderboard/by-external` (curl или `test:api`). Проверить `data/arena.db` создаётся, WAL включён.
3. **bot-conf-max:** `pytest tests/ -v --cov=src --cov-fail-under=52`; `test_arena.py` мокает API.
4. **Сквозной ручной прогон:** применить миграцию (`migration.sh`); из Flask `/agent` создать агента → увидеть его в `GET /api/agents` debate-arena; из MAX-бота отредактировать → проверить, что киоск (`npm run dev`) подхватил через polling и `upgradesLeft` уменьшился; провести бой на ринге → `POST /api/results` → результат виден в `/results` бота и на табло. Исчерпать 3 правки → убедиться, что и веб, и бот блокируют дальнейшее редактирование.
5. **Дизайн:** визуально сверить `/agent` и `/results` с существующими страницами Banka UI (Onest, тёмная тема, `#305EF2`); убедиться, что Arena/Scoreboard/Register debate-arena выглядят как прежде.
