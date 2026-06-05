import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3001;
const MODEL = process.env.LLM_MODEL || "openai/gpt-oss-120b:free";
const API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Запасные модели: если основная перегружена/недоступна — пробуем по очереди их.
// Можно переопределить через LLM_FALLBACKS (через запятую) в .env.
const FALLBACKS = (process.env.LLM_FALLBACKS ||
  "qwen/qwen3-next-80b-a3b-instruct:free,meta-llama/llama-3.3-70b-instruct:free,openai/gpt-oss-20b:free")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const MAX_RETRIES = 3; // попыток на каждую модель
const RETRY_STATUSES = new Set([429, 502, 503, 500]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!API_KEY) {
  console.warn(
    "\n⚠️  OPENROUTER_API_KEY не задан. Скопируй .env.example в .env и впиши ключ.\n"
  );
}

// Один запрос к конкретной модели с ретраями на временных ошибках провайдера.
async function callModel(model, chatMessages, max_tokens, temperature = 0.8) {
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let upstream;
    try {
      upstream = await fetch(OPENROUTER_URL, {
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

// Единая точка обращения к модели. Фронт шлёт {system, messages, max_tokens}.
// Бэкенд приводит к OpenAI-формату (system первым сообщением), пробует основную модель,
// затем фоллбэки, и только если всё легло — отдаёт ошибку.
app.post("/api/claude", async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({ error: "OPENROUTER_API_KEY не настроен на сервере" });
  }
  const { system, messages, max_tokens = 1000, model, temperature } = req.body || {};
  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: "messages обязателен и должен быть массивом" });
  }

  const chatMessages = system ? [{ role: "system", content: system }, ...messages] : messages;
  const chain = [model || MODEL, ...FALLBACKS.filter((m) => m !== (model || MODEL))];

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
  res.json({ ok: true, model: MODEL, fallbacks: FALLBACKS, keyConfigured: Boolean(API_KEY) });
});

app.listen(PORT, () => {
  console.log(`\n🥊  Debate Arena backend на http://localhost:${PORT}  (модель: ${MODEL})`);
  console.log(`   фоллбэки: ${FALLBACKS.join(", ") || "—"}\n`);
});
