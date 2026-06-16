// Тонкий клиент к нашему бэкенду-прокси (/api/claude).
// Возвращает { text, parsed, usage, model }. parsed заполняется при json:true.
// `tier` — индекс ступени деградации; бэкенд по нему выбирает список моделей.
export async function callClaude(system, messages, { json = false, maxTokens = 1000, model, tier, temperature } = {}) {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, messages, max_tokens: maxTokens, model, tier, temperature }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Ошибка запроса к модели");

  let text = data.text || "";
  let parsed = null;
  if (json) {
    let raw = text.replace(/```json|```/g, "").trim();
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end !== -1) raw = raw.slice(start, end + 1);
    parsed = JSON.parse(raw);
  }
  return { text, parsed, usage: data.usage, model: data.model };
}

// Генерация звучного псевдонима бойца через ИИ.
export async function generateFighterName() {
  const { text } = await callClaude(
    "Ты придумываешь короткие звучные псевдонимы для бойцов арены ИИ-дебатов. Имя должно быть дерзким, запоминающимся и уместным для технической конференции.",
    [{ role: "user", content: "Придумай ОДИН псевдоним бойца. Ответь только самим именем, без кавычек и пояснений. 1–3 слова." }],
    { maxTokens: 40 }
  );
  return text.replace(/^["'«»]|["'«».]$/g, "").trim();
}

export async function checkHealth() {
  try {
    const res = await fetch("/api/health");
    return await res.json();
  } catch {
    return { ok: false };
  }
}
