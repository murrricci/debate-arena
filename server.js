import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { mkdirSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

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

// Общий «последний рубеж»: пробуется, когда весь список выбранного тира недоступен.
// Список берётся ТОЛЬКО из LLM_FALLBACKS (через запятую). Пусто или не задано → без фоллбэков:
// никаких зашитых дефолтов, что в конфиге — то и есть (пустой конфиг = ничего лишнего не пробуем).
const FALLBACKS = parseList(process.env.LLM_FALLBACKS, []);

// Уровень «рассуждения» reasoning-моделей. У них max_tokens делится между скрытым reasoning и
// ответом: при низком лимите reasoning съедает весь бюджет, и content приходит ПУСТЫМ. Поэтому
// по умолчанию reasoning выключен (весь лимит идёт на ответ). LLM_REASONING_EFFORT: low|medium|high
// (доля бюджета на reasoning), none/off (выключить вовсе), пусто (не слать параметр — для хостов без поддержки).
const REASONING = (() => {
  const v = (process.env.LLM_REASONING_EFFORT ?? "off").trim().toLowerCase();
  if (v === "" || v === "default") return null; // не добавлять поле reasoning в запрос
  if (v === "none" || v === "off" || v === "false") return { enabled: false };
  if (["low", "medium", "high"].includes(v)) return { effort: v };
  console.warn(`⚠️  LLM_REASONING_EFFORT="${v}" не распознан — выключаю reasoning ("off")`);
  return { enabled: false };
})();

const MAX_RETRIES = 3; // попыток на каждую модель
const RETRY_STATUSES = new Set([429, 502, 503, 500]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Логирование тайминга обращений к провайдеру. По умолчанию включено; LLM_LOG=0 — выключить.
// Цель — увидеть, на что уходит время: ретраи и бэкофф, перебор фоллбэков или сама генерация.
const LOG = process.env.LLM_LOG !== "0";
const since = (t0) => Date.now() - t0; // мс с момента t0
const tlog = (...a) => { if (LOG) console.log(...a); };

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
async function callModel(model, chatMessages, max_tokens, temperature = 0.8) {
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
        body: JSON.stringify({ model, messages: chatMessages, max_tokens, temperature, ...(REASONING ? { reasoning: REASONING } : {}) }),
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
        return { ok: true, text, usage: data.usage, attempts: attempt, slept };
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
  const { system, messages, max_tokens = 1000, model, tier, temperature, label } = req.body || {};
  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: "messages обязателен и должен быть массивом" });
  }

  const chatMessages = system ? [{ role: "system", content: system }, ...messages] : messages;
  // Тир → список моделей; явный model (строка) имеет приоритет (back-compat).
  const t = Number.isInteger(tier) ? Math.min(Math.max(tier, 0), TIERS.length - 1) : 0;
  const base = typeof model === "string" && model.trim() ? [model.trim()] : TIERS[t];
  // Цепочка: модели тира по порядку, затем общий фоллбэк; дубли убираем.
  const chain = [...new Set([...base, ...FALLBACKS])];

  const reqStart = Date.now();
  const tag = label || "—";
  tlog(`\n🛰️  [${tag}] тир ${t + 1}, max_tokens=${max_tokens}, цепочка: ${chain.join(" → ")}`);

  let last = null;
  let triedModels = 0; // сколько моделей цепочки перебрали
  let totalAttempts = 0; // суммарно попыток (с ретраями) по всем моделям
  let totalSlept = 0; // суммарно мс, проведённых в бэкоффе
  for (const m of chain) {
    triedModels++;
    const result = await callModel(m, chatMessages, max_tokens, temperature);
    totalAttempts += result.attempts || 0;
    totalSlept += result.slept || 0;
    if (result.ok) {
      const total = since(reqStart);
      if (m !== chain[0]) console.warn(`↪️  Фоллбэк: ответила модель ${m}`);
      // Ключевая строка диагностики: total = работа провайдера + ожидание (totalSlept).
      tlog(`✅  [${tag}] ${m} за ${total}мс · моделей ${triedModels}, попыток ${totalAttempts}, в ожидании ${totalSlept}мс, токенов ${result.usage?.total_tokens ?? "?"}`);
      logToFile({
        ts: new Date().toISOString(), label: label || null, tier: t, ok: true, model: m,
        ms: total, sleptMs: totalSlept, attempts: totalAttempts, modelsTried: triedModels, max_tokens,
        prompt_tokens: result.usage?.prompt_tokens ?? null,
        completion_tokens: result.usage?.completion_tokens ?? null,
        total_tokens: result.usage?.total_tokens ?? null,
      });
      return res.json({ text: result.text, usage: result.usage, model: m });
    }
    last = result;
    console.error(`Модель ${m} не ответила (${result.status}): ${result.message}`);
  }

  const failMs = since(reqStart);
  tlog(`❌  [${tag}] все модели легли за ${failMs}мс · моделей ${triedModels}, попыток ${totalAttempts}, в ожидании ${totalSlept}мс`);
  logToFile({
    ts: new Date().toISOString(), label: label || null, tier: t, ok: false, model: null,
    ms: failMs, sleptMs: totalSlept, attempts: totalAttempts, modelsTried: triedModels, max_tokens,
    status: last?.status || 502, error: last?.message || "неизвестно",
  });
  res.status(last?.status || 502).json({
    error: `Все модели недоступны. Последняя ошибка: ${last?.message || "неизвестно"}`,
  });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, baseUrl: BASE_URL, tiers: TIERS, fallbacks: FALLBACKS, keyConfigured: Boolean(API_KEY) });
});

app.listen(PORT, () => {
  console.log(`\n🥊  Debate Arena backend на http://localhost:${PORT}`);
  console.log(`   сервис: ${BASE_URL}`);
  TIERS.forEach((list, i) => console.log(`   тир ${i + 1}: ${list.join(", ")}`));
  console.log(`   фоллбэки: ${FALLBACKS.join(", ") || "—"}`);
  console.log(`   reasoning: ${REASONING ? JSON.stringify(REASONING) : "по умолчанию модели"}`);
  console.log(`   тайминг-логи: ${LOG ? "вкл (LLM_LOG=0 чтобы выключить)" : "выкл"}`);
  console.log(`   лог-файл: ${LOG_FILE || "выкл (LLM_LOG_FILE=0)"}\n`);
});
