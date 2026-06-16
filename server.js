import express from "express";
import cors from "cors";
import dotenv from "dotenv";

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
// Можно переопределить через LLM_FALLBACKS (через запятую) в .env.
const FALLBACKS = parseList(
  process.env.LLM_FALLBACKS,
  ["qwen/qwen3-next-80b-a3b-instruct:free", "meta-llama/llama-3.3-70b-instruct:free", "openai/gpt-oss-20b:free"]
);

const MAX_RETRIES = 3; // попыток на каждую модель
const RETRY_STATUSES = new Set([429, 502, 503, 500]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!API_KEY) {
  console.warn(
    "\n⚠️  Ключ сервиса не задан (LLM_API_KEY / OPENROUTER_API_KEY). Скопируй .env.example в .env и впиши ключ.\n"
  );
}

// Один запрос к конкретной модели с ретраями на временных ошибках провайдера.
async function callModel(model, chatMessages, max_tokens, temperature = 0.8) {
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let upstream;
    try {
      upstream = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${API_KEY}`,
          "HTTP-Referer": "http://localhost:5173",
          "X-Title": "Debate Arena",
        },
        body: JSON.stringify({ model, messages: chatMessages, max_tokens, temperature }),
      });
    } catch (e) {
      lastErr = { status: 502, message: e.message };
      await sleep(attempt * 800);
      continue;
    }

    const data = await upstream.json();
    if (upstream.ok) {
      const text = (data.choices?.[0]?.message?.content || "").trim();
      if (text) return { ok: true, text, usage: data.usage };
      lastErr = { status: 502, message: "пустой ответ модели" };
    } else {
      lastErr = { status: upstream.status, message: data?.error?.message || "ошибка провайдера", raw: data };
      // Постоянные ошибки (нет смысла ретраить эту модель) — сразу к следующей.
      if (!RETRY_STATUSES.has(upstream.status)) return { ok: false, ...lastErr };
    }

    // подождём перед повтором (учитываем Retry-After если есть)
    const retryAfter = Number(data?.error?.metadata?.retry_after_seconds);
    const waitMs = retryAfter ? Math.min(retryAfter * 1000, 6000) : attempt * 1000;
    if (attempt < MAX_RETRIES) await sleep(waitMs);
  }
  return { ok: false, ...lastErr };
}

// Единая точка обращения к модели. Фронт шлёт {system, messages, max_tokens, tier}.
// Бэкенд приводит к OpenAI-формату (system первым сообщением), пробует модели списка
// выбранного тира по очереди, затем общие фоллбэки, и только если всё легло — отдаёт ошибку.
app.post("/api/claude", async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({ error: "Ключ сервиса (LLM_API_KEY / OPENROUTER_API_KEY) не настроен на сервере" });
  }
  const { system, messages, max_tokens = 1000, model, tier, temperature } = req.body || {};
  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: "messages обязателен и должен быть массивом" });
  }

  const chatMessages = system ? [{ role: "system", content: system }, ...messages] : messages;
  // Тир → список моделей; явный model (строка) имеет приоритет (back-compat).
  const t = Number.isInteger(tier) ? Math.min(Math.max(tier, 0), TIERS.length - 1) : 0;
  const base = typeof model === "string" && model.trim() ? [model.trim()] : TIERS[t];
  // Цепочка: модели тира по порядку, затем общий фоллбэк; дубли убираем.
  const chain = [...new Set([...base, ...FALLBACKS])];

  let last = null;
  for (const m of chain) {
    const result = await callModel(m, chatMessages, max_tokens, temperature);
    if (result.ok) {
      if (m !== chain[0]) console.warn(`↪️  Фоллбэк: ответила модель ${m}`);
      return res.json({ text: result.text, usage: result.usage, model: m });
    }
    last = result;
    console.error(`Модель ${m} не ответила (${result.status}): ${result.message}`);
  }

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
  console.log(`   фоллбэки: ${FALLBACKS.join(", ") || "—"}\n`);
});
