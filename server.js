import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { mkdirSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";
import { timingSafeEqual } from "node:crypto";

import * as agents from "./db.js";
import {
  createTournamentFromLeaderboard,
  markTournamentMatchesRunning,
  recordTournamentMatchError,
  recordTournamentMatchResult,
  startTournament,
} from "./src/lib/tournamentCore.js";
import { SKILL_CARDS } from "./src/data/skills.js";
import {
  DEFAULT_CONFIG,
  MEMORY_OPTIONS,
  REPLY_LEN_OPTIONS,
  FOCUS_OPTIONS,
  JUDGE_OPTIONS,
  TEMPERATURE_MIN,
  TEMPERATURE_MAX,
  TEMPERATURE_STEP,
  TEMPERATURE_ZONES,
} from "./src/data/agentConfig.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "4mb" }));

// Хранилище агентов и результатов (node:sqlite). Источник правды для всей арены.
agents.initDb();

// --- Авторизация сервис-сервис для управления агентами (бот → арена) ---
// Заголовок X-Arena-Key сверяется с ARENA_API_KEY. Фронт-киоск ходит через Vite-proxy,
// который сам подставляет ключ (он не попадает в браузерный бандл). /api/claude и
// открытые GET ключа НЕ требуют.
const ARENA_KEY = process.env.ARENA_API_KEY || "";
if (!ARENA_KEY) {
  console.warn(
    "\n⚠️  ARENA_API_KEY не задан — управление агентами по API отключено (мутации вернут 401). Впиши ключ в .env.\n"
  );
}
function requireArenaKey(req, res, next) {
  if (!ARENA_KEY) return res.status(401).json({ error: "ARENA_API_KEY не настроен на сервере" });
  const got = Buffer.from(req.get("X-Arena-Key") || "");
  const want = Buffer.from(ARENA_KEY);
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    return res.status(401).json({ error: "неверный ключ доступа" });
  }
  next();
}

const PORT = process.env.PORT || 3001;
const API_KEY = process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY;
// База OpenAI-совместимого сервиса (до /v1). По умолчанию — OpenRouter; можно
// указать любой хост через LLM_BASE_URL. Эндпоинт /chat/completions добавляем сами.
const BASE_URL = (process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
const CHAT_URL = `${BASE_URL}/chat/completions`;

// Список моделей из переменной окружения: "a, b, c" → ["a","b","c"]. Пусто → defaults.
const parseList = (envStr, defaults) => {
  const list = (envStr || "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : defaults;
};

// Модели по тирам деградации (LLM_TIER_1 — сильнейший, PRIME). В каждом тире первая
// модель — основная, остальные — фоллбэки этого тира. Фронт шлёт индекс тира, а какие
// модели за ним стоят — знает только бэкенд. Дефолты повторяют прежнее поведение;
// LLM_MODEL оставлен как legacy-имя основной модели тира 1.
const TIERS = [
  parseList(process.env.LLM_TIER_1, [process.env.LLM_MODEL || "openai/gpt-oss-120b:free"]),
  parseList(process.env.LLM_TIER_2, ["meta-llama/llama-3.3-70b-instruct:free"]),
  parseList(process.env.LLM_TIER_3, ["openai/gpt-oss-20b:free"]),
];

// Отдельный тир судьи — НЕ часть лестницы деградации бойцов: судья всегда арбитр, его модель
// задаётся независимо через LLM_TIER_JUDGE (список через запятую: первая основная, остальные —
// его фоллбэки этого тира). Не задано → как раньше: модели тира 1 (PRIME).
const JUDGE_TIER = parseList(process.env.LLM_TIER_JUDGE, TIERS[0]);

// Общий «последний рубеж»: пробуется, когда весь список выбранного тира недоступен.
// Список берётся ТОЛЬКО из LLM_FALLBACKS (через запятую). Пусто или не задано → без фоллбэков:
// никаких зашитых дефолтов, что в конфиге — то и есть (пустой конфиг = ничего лишнего не пробуем).
const FALLBACKS = parseList(process.env.LLM_FALLBACKS, []);

// Уровень «рассуждения» reasoning-моделей. У них max_tokens делится между скрытым reasoning и
// ответом: при низком лимите reasoning съедает весь бюджет, и content приходит ПУСТЫМ. Поэтому
// по умолчанию reasoning выключен (весь лимит идёт на ответ). Значения: low|medium|high (доля
// бюджета на reasoning), none/off (выключить вовсе), пусто (не слать параметр — для хостов без поддержки).
const parseEffort = (raw, who) => {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "" || v === "default") return null; // не добавлять поле reasoning в запрос
  if (v === "none" || v === "off" || v === "false") return { enabled: false };
  if (["low", "medium", "high"].includes(v)) return { effort: v };
  console.warn(`⚠️  reasoning "${v}" (${who}) не распознан — выключаю reasoning ("off")`);
  return { enabled: false };
};
// Глобальный reasoning (бойцы и всё, что не судья). По умолчанию off.
const REASONING = parseEffort(process.env.LLM_REASONING_EFFORT ?? "off", "LLM_REASONING_EFFORT");
// Reasoning судьи. Своя ручка LLM_REASONING_EFFORT_JUDGE; если не задана — наследует глобальный.
const REASONING_JUDGE = process.env.LLM_REASONING_EFFORT_JUDGE == null
  ? REASONING
  : parseEffort(process.env.LLM_REASONING_EFFORT_JUDGE, "LLM_REASONING_EFFORT_JUDGE");

// Лимит токенов ответа судьи. Не задано → берётся max_tokens из запроса (фронт шлёт 300).
// Полезно поднять, если у судьи включён reasoning (иначе рассуждение съест лимит → пустой вердикт).
const JUDGE_MAX_TOKENS = (() => {
  const n = Number(process.env.LLM_MAX_TOKENS_JUDGE);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
})();

// Случайный выбор модели внутри тира. По умолчанию выкл — модели тира пробуются по порядку
// (первая основная, остальные фоллбэки). LLM_TIER_RANDOM=1 → порядок моделей тира тасуется на
// каждый запрос: «основной» становится случайная модель тира, остальные остаются его фоллбэками.
// Глобальный LLM_FALLBACKS не тасуется; явно переданный model (back-compat) тоже не трогаем.
const RANDOM_TIER = /^(1|true|on|yes)$/i.test((process.env.LLM_TIER_RANDOM ?? "").trim());
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const MAX_RETRIES = 3; // попыток на каждую модель
const RETRY_STATUSES = new Set([400, 429, 502, 503, 500]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Логирование тайминга обращений к провайдеру. По умолчанию включено; LLM_LOG=0 — выключить.
// Цель — увидеть, на что уходит время: ретраи и бэкофф, перебор фоллбэков или сама генерация.
const LOG = process.env.LLM_LOG !== "0";
const since = (t0) => Date.now() - t0; // мс с момента t0
const tlog = (...a) => { if (LOG) console.log(...a); };

let liveSnapshot = null;
const liveClients = new Set();

function liveEnvelope() {
  return { live: liveSnapshot };
}

function writeSse(res, event, payload) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function setLiveSnapshot(payload) {
  liveSnapshot = payload && typeof payload === "object"
    ? { ...payload, updatedAt: Date.now() }
    : null;
  for (const res of liveClients) writeSse(res, "live", liveEnvelope());
  return liveEnvelope();
}

// Файл с логом обращений в формате JSONL (одна JSON-строка на запрос) — по нему потом можно
// посчитать реальный бюджет: модель, что ответила, и точные токены вход/выход на каждый вызов.
// Путь: LLM_LOG_FILE (относительный — от папки server.js); "0" или пустая строка — не писать файл.
const __dirname = dirname(fileURLToPath(import.meta.url));
const rawLogFile = process.env.LLM_LOG_FILE ?? "logs/llm-usage.jsonl";
const LOG_FILE = (rawLogFile === "0" || rawLogFile === "")
  ? null
  : isAbsolute(rawLogFile) ? rawLogFile : join(__dirname, rawLogFile);
if (LOG_FILE) {
  try { mkdirSync(dirname(LOG_FILE), { recursive: true }); }
  catch (e) { console.warn(`⚠️  не удалось создать папку для лога: ${e.message}`); }
}
// Дозапись одной записи; ошибки файла не должны ронять запрос к модели.
function logToFile(record) {
  if (!LOG_FILE) return;
  appendFile(LOG_FILE, JSON.stringify(record) + "\n").catch((e) =>
    console.warn(`⚠️  не удалось записать лог в ${LOG_FILE}: ${e.message}`)
  );
}

if (!API_KEY) {
  console.warn(
    "\n⚠️  Ключ сервиса не задан (LLM_API_KEY / OPENROUTER_API_KEY). Скопируй .env.example в .env и впиши ключ.\n"
  );
}

// Один запрос к конкретной модели с ретраями на временных ошибках провайдера.
// Возвращает, помимо результата, attempts (сколько попыток сделали) и slept (мс в бэкоффе) —
// чтобы вышестоящий обработчик мог отделить ожидание от реальной работы провайдера.
async function callModel(model, chatMessages, max_tokens, temperature = 0.8, reasoning = null) {
  let lastErr = null;
  let slept = 0; // суммарное время ожидания между попытками по этой модели
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let upstream;
    const t0 = Date.now();
    try {
      upstream = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${API_KEY}`,
          "HTTP-Referer": "http://localhost:5173",
          "X-Title": "Debate Arena",
        },
        body: JSON.stringify({ model, messages: chatMessages, max_tokens, temperature, ...(reasoning ? { reasoning } : {}) }),
      });
    } catch (e) {
      tlog(`   ↳ ${model} #${attempt}: сеть упала за ${since(t0)}мс — ${e.message}`);
      lastErr = { status: 502, message: e.message };
      const w = attempt * 800;
      slept += w;
      await sleep(w);
      continue;
    }

    const data = await upstream.json();
    const dt = since(t0); // длительность самого обращения к провайдеру
    if (upstream.ok) {
      const text = (data.choices?.[0]?.message?.content || "").trim();
      if (text) {
        tlog(`   ↳ ${model} #${attempt}: 200 за ${dt}мс, токенов ${data.usage?.total_tokens ?? "?"}`);
        // respModel — имя модели из ответа провайдера (что реально отработало и было оплачено).
        return { ok: true, text, usage: data.usage, respModel: data.model, attempts: attempt, slept };
      }
      tlog(`   ↳ ${model} #${attempt}: 200 за ${dt}мс, но ответ пустой`);
      lastErr = { status: 502, message: "пустой ответ модели" };
    } else {
      tlog(`   ↳ ${model} #${attempt}: ${upstream.status} за ${dt}мс — ${data?.error?.message || "ошибка провайдера"}`);
      lastErr = { status: upstream.status, message: data?.error?.message || "ошибка провайдера", raw: data };
      // Постоянные ошибки (нет смысла ретраить эту модель) — сразу к следующей.
      if (!RETRY_STATUSES.has(upstream.status)) return { ok: false, ...lastErr, attempts: attempt, slept };
    }

    // подождём перед повтором (учитываем Retry-After если есть)
    const retryAfter = Number(data?.error?.metadata?.retry_after_seconds);
    const waitMs = retryAfter ? Math.min(retryAfter * 1000, 6000) : attempt * 1000;
    if (attempt < MAX_RETRIES) {
      tlog(`   ↳ ${model}: жду ${waitMs}мс перед повтором`);
      slept += waitMs;
      await sleep(waitMs);
    }
  }
  return { ok: false, ...lastErr, attempts: MAX_RETRIES, slept };
}

// Единая точка обращения к модели. Фронт шлёт {system, messages, max_tokens, tier}.
// Бэкенд приводит к OpenAI-формату (system первым сообщением), пробует модели списка
// выбранного тира по очереди, затем общие фоллбэки, и только если всё легло — отдаёт ошибку.
app.post("/api/claude", async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({ error: "Ключ сервиса (LLM_API_KEY / OPENROUTER_API_KEY) не настроен на сервере" });
  }
  // label — необязательная метка вызова (напр. «R2·A»), приходит с фронта только для логов.
  // judge:true — это судья: идёт на отдельный тир (JUDGE_TIER) и со своим reasoning.
  const { system, messages, max_tokens = 1000, model, tier, temperature, label, judge } = req.body || {};
  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: "messages обязателен и должен быть массивом" });
  }

  const chatMessages = system ? [{ role: "system", content: system }, ...messages] : messages;
  // Судья → свой тир и свой reasoning; остальные — тир по индексу и глобальный reasoning.
  const t = Number.isInteger(tier) ? Math.min(Math.max(tier, 0), TIERS.length - 1) : 0;
  const list = judge ? JUDGE_TIER : TIERS[t];
  const reasoning = judge ? REASONING_JUDGE : REASONING;
  // Лимит токенов: у судьи можно задать свой (LLM_MAX_TOKENS_JUDGE), иначе берётся из запроса.
  const effMax = judge && JUDGE_MAX_TOKENS ? JUDGE_MAX_TOKENS : max_tokens;
  // Тир → список моделей; явный model (строка) имеет приоритет (back-compat).
  const base = typeof model === "string" && model.trim() ? [model.trim()] : (RANDOM_TIER ? shuffle(list) : list);
  // Цепочка: модели тира по порядку, затем общий фоллбэк; дубли убираем.
  const chain = [...new Set([...base, ...FALLBACKS])];

  const reqStart = Date.now();
  const tag = label || "—";
  const where = judge ? "судья" : `тир ${t + 1}`;
  tlog(`\n🛰️  [${tag}] ${where}, reasoning=${reasoning ? JSON.stringify(reasoning) : "—"}, max_tokens=${effMax}, цепочка: ${chain.join(" → ")}`);

  let last = null;
  let triedModels = 0; // сколько моделей цепочки перебрали
  let totalAttempts = 0; // суммарно попыток (с ретраями) по всем моделям
  let totalSlept = 0; // суммарно мс, проведённых в бэкоффе
  for (const m of chain) {
    triedModels++;
    const result = await callModel(m, chatMessages, effMax, temperature, reasoning);
    totalAttempts += result.attempts || 0;
    totalSlept += result.slept || 0;
    if (result.ok) {
      const total = since(reqStart);
      const answered = result.respModel || m; // имя модели из ответа (для точного учёта по модели)
      if (m !== chain[0]) console.warn(`↪️  Фоллбэк: ответила модель ${answered}`);
      // Ключевая строка диагностики: total = работа провайдера + ожидание (totalSlept).
      tlog(`✅  [${tag}] ${answered} за ${total}мс · моделей ${triedModels}, попыток ${totalAttempts}, в ожидании ${totalSlept}мс, токенов ${result.usage?.total_tokens ?? "?"} (reasoning ${result.usage?.completion_tokens_details?.reasoning_tokens ?? "?"}), ₽${result.usage?.cost_rub ?? "?"}, остаток ₽${result.usage?.balance ?? "?"}`);
      logToFile({
        ts: new Date().toISOString(), label: label || null, tier: t, judge: !!judge, ok: true, model: answered,
        ms: total, sleptMs: totalSlept, attempts: totalAttempts, modelsTried: triedModels, max_tokens: effMax,
        prompt_tokens: result.usage?.prompt_tokens ?? null,
        completion_tokens: result.usage?.completion_tokens ?? null,
        reasoning_tokens: result.usage?.completion_tokens_details?.reasoning_tokens ?? null, // часть выхода на reasoning
        total_tokens: result.usage?.total_tokens ?? null,
        cost_rub: result.usage?.cost_rub ?? null, // AITunnel: сумма запроса в рублях (из usage ответа)
        balance: result.usage?.balance ?? null,   // остаток на счёте после запроса (₽)
      });
      return res.json({ text: result.text, usage: result.usage, model: answered });
    }
    last = result;
    console.error(`Модель ${m} не ответила (${result.status}): ${result.message}`);
  }

  const failMs = since(reqStart);
  tlog(`❌  [${tag}] все модели легли за ${failMs}мс · моделей ${triedModels}, попыток ${totalAttempts}, в ожидании ${totalSlept}мс`);
  logToFile({
    ts: new Date().toISOString(), label: label || null, tier: t, judge: !!judge, ok: false, model: null,
    ms: failMs, sleptMs: totalSlept, attempts: totalAttempts, modelsTried: triedModels, max_tokens: effMax,
    status: last?.status || 502, error: last?.message || "неизвестно",
  });
  res.status(last?.status || 502).json({
    error: `Все модели недоступны. Последняя ошибка: ${last?.message || "неизвестно"}`,
  });
});

// ======================= API УПРАВЛЕНИЯ АГЕНТАМИ =======================
// Контракт согласован с bot-conf-max (см. PLAN_API.md). Форма участника в ответах
// совпадает с прежним participant — фронт переписывать не нужно.

// Справочники для построения формы на стороне бота (открытый — нет секретов).
function formMeta() {
  return {
    skills: SKILL_CARDS,
    config: {
      defaults: DEFAULT_CONFIG,
      memory: MEMORY_OPTIONS,
      temperature: { min: TEMPERATURE_MIN, max: TEMPERATURE_MAX, step: TEMPERATURE_STEP, zones: TEMPERATURE_ZONES },
      replyLen: REPLY_LEN_OPTIONS,
      focus: FOCUS_OPTIONS,
      judge: JUDGE_OPTIONS,
    },
    limits: { maxUpgrades: agents.MAX_UPGRADES },
  };
}
app.get("/api/meta/form", (_req, res) => res.json(formMeta()));

// Ростер целиком — для фронта-киоска и табло (открытый, как и текущее чтение участников).
app.get("/api/agents", (_req, res) => res.json({ agents: agents.listAgents() }));

// Лидерборд (открытый — его и так показывает табло).
app.get("/api/results/leaderboard", (_req, res) => res.json({ leaderboard: agents.leaderboard() }));

// --- маршруты по внешнему пользователю (bot-conf-max ключует агента по своему users.id) ---
app.get("/api/agents/by-external/:externalId", requireArenaKey, (req, res) => {
  const agent = agents.getAgentByExternalId(req.params.externalId);
  if (!agent) return res.status(404).json({ error: "not_found" });
  res.json(agents.withLimit(agent));
});

app.patch("/api/agents/by-external/:externalId", requireArenaKey, (req, res) => {
  const r = agents.upgradeAgent({ externalId: req.params.externalId }, req.body || {});
  if (r.error === "not_found") return res.status(404).json({ error: "not_found" });
  if (r.error === "validation") return res.status(400).json({ error: "validation", detail: r.detail });
  if (r.error === "upgrade_limit_reached") {
    return res.status(403).json({ error: "upgrade_limit_reached", ...agents.withLimit(r.agent) });
  }
  res.json(agents.withLimit(r.agent));
});

app.get("/api/results/by-external/:externalId", requireArenaKey, (req, res) => {
  const limit = Number(req.query.limit) || 50;
  const r = agents.userResults({ externalId: req.params.externalId }, { limit });
  if (r.error === "not_found") return res.status(404).json({ error: "not_found" });
  res.json(r);
});

// --- создание (и бот с externalId, и оператор/фронт без него) ---
app.post("/api/agents", requireArenaKey, (req, res) => {
  const r = agents.createAgent(req.body || {});
  if (r.error === "validation") return res.status(400).json({ error: "validation", detail: r.detail });
  if (r.error === "agent_exists") return res.status(409).json({ error: "agent_exists", agent: agents.withLimit(r.agent) });
  res.status(201).json(agents.withLimit(r.agent));
});

// --- операторские операции по внутреннему id (фронт-киоск, Register.jsx) ---
app.patch("/api/agents/:id", requireArenaKey, (req, res) => {
  const r = agents.upgradeAgent({ id: req.params.id }, req.body || {});
  if (r.error === "not_found") return res.status(404).json({ error: "not_found" });
  if (r.error === "validation") return res.status(400).json({ error: "validation", detail: r.detail });
  if (r.error === "upgrade_limit_reached") {
    return res.status(403).json({ error: "upgrade_limit_reached", ...agents.withLimit(r.agent) });
  }
  res.json(agents.withLimit(r.agent));
});

app.delete("/api/agents/:id", requireArenaKey, (req, res) => {
  res.json(agents.removeAgent(req.params.id));
});

// --- результат боя (от киоска) ---
app.post("/api/results", requireArenaKey, (req, res) => {
  const r = agents.applyResult(req.body || {});
  if (r.error === "validation") return res.status(400).json({ error: "validation", detail: r.detail });
  res.json({ a: r.a, b: r.b, battleId: r.battleId });
});

// --- история боёв ---
app.get("/api/battles", (req, res) => {
  const limit = Number(req.query.limit) || 50;
  const query = typeof req.query.query === "string" ? req.query.query : "";
  const tournament =
    req.query.tournament === "1" || req.query.tournament === "true"
      ? true
      : req.query.tournament === "0" || req.query.tournament === "false"
        ? false
        : null;
  res.json({ battles: agents.listBattles({ query, limit, tournament }) });
});

app.get("/api/battles/:id", (req, res) => {
  const battle = agents.getBattle(req.params.id);
  if (!battle) return res.status(404).json({ error: "not_found" });
  res.json(battle);
});

// Турнирные матчи сохраняются отдельно от разминки: очки агентов здесь не пересчитываются.
app.post("/api/battles", requireArenaKey, (req, res) => {
  const r = agents.recordBattle(req.body || {});
  if (r.error === "validation") return res.status(400).json({ error: "validation", detail: r.detail });
  res.status(201).json({ battleId: r.battleId });
});

// --- сброс очков (перед стартом турнира / ручной сброс на табло) ---
app.post("/api/results/reset", requireArenaKey, (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
  res.json(agents.resetScores(ids));
});

// --- состояние турнира ---
app.get("/api/tournament", (_req, res) => {
  res.json(agents.getTournamentState());
});

app.post("/api/tournament/close", requireArenaKey, (req, res) => {
  const next = createTournamentFromLeaderboard(agents.leaderboard(), req.body || {});
  if (next.error) return res.status(400).json(next);
  res.json(agents.saveTournamentState(next));
});

app.post("/api/tournament/start", requireArenaKey, (_req, res) => {
  res.json(agents.saveTournamentState(startTournament(agents.getTournamentState())));
});

app.post("/api/tournament/matches/running", requireArenaKey, (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : Array.isArray(req.body?.matchIds) ? req.body.matchIds : [];
  res.json(agents.saveTournamentState(markTournamentMatchesRunning(agents.getTournamentState(), ids)));
});

app.post("/api/tournament/matches/:id/result", requireArenaKey, (req, res) => {
  const next = recordTournamentMatchResult(agents.getTournamentState(), {
    matchId: req.params.id,
    winner: req.body?.winner,
    scoreA: req.body?.scoreA,
    scoreB: req.body?.scoreB,
    battleId: req.body?.battleId ?? null,
  });
  res.json(agents.saveTournamentState(next));
});

app.post("/api/tournament/matches/:id/error", requireArenaKey, (req, res) => {
  const next = recordTournamentMatchError(agents.getTournamentState(), {
    matchId: req.params.id,
    error: req.body?.error,
  });
  res.json(agents.saveTournamentState(next));
});

app.post("/api/tournament/reset", requireArenaKey, (_req, res) => {
  res.json(agents.resetTournamentState());
});

app.post("/api/tournament/import", requireArenaKey, (req, res) => {
  const current = agents.getTournamentState();
  if (current.status !== "idle" || current.closed || current.roster.length || current.matches.length) {
    return res.status(409).json({ error: "tournament_exists", tournament: current });
  }
  const incoming = req.body?.tournament && typeof req.body.tournament === "object" ? req.body.tournament : req.body;
  res.json(agents.saveTournamentState(incoming || {}));
});

// --- live snapshot текущего боя для табло ---
app.get("/api/live", (_req, res) => {
  res.json(liveEnvelope());
});

app.get("/api/live/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  writeSse(res, "live", liveEnvelope());
  liveClients.add(res);
  req.on("close", () => liveClients.delete(res));
});

app.post("/api/live", requireArenaKey, (req, res) => {
  res.json(setLiveSnapshot(req.body || null));
});

app.delete("/api/live", requireArenaKey, (_req, res) => {
  res.json(setLiveSnapshot(null));
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, baseUrl: BASE_URL, tiers: TIERS, fallbacks: FALLBACKS, keyConfigured: Boolean(API_KEY), arenaApi: Boolean(ARENA_KEY) });
});

app.listen(PORT, () => {
  console.log(`\n🥊  Debate Arena backend на http://localhost:${PORT}`);
  console.log(`   сервис: ${BASE_URL}`);
  TIERS.forEach((list, i) => console.log(`   тир ${i + 1}: ${list.join(", ")}`));
  console.log(`   тир судьи: ${JUDGE_TIER.join(", ")}`);
  console.log(`   фоллбэки: ${FALLBACKS.join(", ") || "—"}`);
  console.log(`   reasoning: ${REASONING ? JSON.stringify(REASONING) : "по умолчанию модели"}`);
  console.log(`   reasoning судьи: ${REASONING_JUDGE ? JSON.stringify(REASONING_JUDGE) : "по умолчанию модели"}`);
  console.log(`   лимит токенов судьи: ${JUDGE_MAX_TOKENS ?? "из запроса (фронт: 300)"}`);
  console.log(`   выбор в тире: ${RANDOM_TIER ? "случайный (LLM_TIER_RANDOM)" : "по порядку"}`);
  console.log(`   тайминг-логи: ${LOG ? "вкл (LLM_LOG=0 чтобы выключить)" : "выкл"}`);
  console.log(`   лог-файл: ${LOG_FILE || "выкл (LLM_LOG_FILE=0)"}`);
  console.log(`   API агентов: ${ARENA_KEY ? "вкл (X-Arena-Key)" : "выкл (нет ARENA_API_KEY)"}\n`);
});
