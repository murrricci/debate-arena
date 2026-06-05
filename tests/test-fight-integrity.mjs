// Живой smoke-тест боя через бэкенд (нужен запущенный server.js на :3001).
// Проверяет целостность процесса: краткость реплик, отсутствие зацикливания,
// русский язык (без английских фраз), валидный JSON у судьи и финала, рост расхода
// токенов и деградацию "жадного" бойца.
import { buildFighterSystem } from "../src/lib/agent.js";
import { pickModel, MODEL_TIERS } from "../src/lib/models.js";
import { roundJudgeSystem, finalJudgeSystem, roundDamage } from "../src/data/judging.js";

const BASE = process.env.BASE_URL || "http://localhost:3001";
const ROUNDS = 2; // меньше раундов, чтобы беречь лимиты free-моделей
const MAX_WORDS = 45;

let passed = 0, failed = 0, warned = 0;
const check = (name, cond) => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
};
const warn = (name, cond) => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { warned++; console.log(`  ⚠️  ${name} (не критично)`); }
};

async function call(system, messages, { json = false, maxTokens = 220, model } = {}) {
  const res = await fetch(`${BASE}/api/claude`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, messages, max_tokens: maxTokens, model }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  let parsed = null;
  if (json) {
    let raw = (data.text || "").replace(/```json|```/g, "").trim();
    const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
    if (s !== -1 && e !== -1) raw = raw.slice(s, e + 1);
    parsed = JSON.parse(raw);
  }
  return { text: (data.text || "").trim(), parsed, usage: data.usage, model: data.model };
}

const wordCount = (s) => s.replace(/\s+/g, " ").trim().split(" ").filter(Boolean).length;
// Доля латинских букв среди всех букв (для нейтральной темы должна быть низкой).
function latinRatio(s) {
  const lat = (s.match(/[a-zA-Z]/g) || []).length;
  const cyr = (s.match(/[а-яёА-ЯЁ]/g) || []).length;
  const total = lat + cyr;
  return total === 0 ? 0 : lat / total;
}
// Сходство множеств слов (анти-цикл): 1.0 = реплики идентичны.
function jaccard(a, b) {
  const sa = new Set(a.toLowerCase().match(/[а-яёa-z]+/gi) || []);
  const sb = new Set(b.toLowerCase().match(/[а-яёa-z]+/gi) || []);
  if (!sa.size || !sb.size) return 0;
  const inter = [...sa].filter((w) => sb.has(w)).length;
  return inter / new Set([...sa, ...sb]).size;
}

// Нейтральная тема без англицизмов — чтобы корректно проверить "без английских слов".
const TOPIC = "Коты против собак";
const STANCE_A = "Коты — лучшие питомцы.";
const STANCE_B = "Собаки — лучшие питомцы.";

// Боец A — короткий промпт (должен дольше держать сильную модель).
const fighterA = { name: "Мурзик", skills: ["aggressor"], custom: "" };
// Боец B — намеренно "жадный" длинный промпт (быстрее перегрев → деградация).
const fighterB = {
  name: "Бобик",
  skills: ["aggressor", "factualist", "rhetorician", "comedian", "philosopher", "pragmatist"],
  custom: "Очень подробная установка от создателя. ".repeat(25),
};

async function run() {
  console.log("\n=== TC-FIGHT: целостность живого боя ===");
  console.log(`  тема: ${TOPIC}\n`);

  const sysA = buildFighterSystem(fighterA, STANCE_A, TOPIC);
  const sysB = buildFighterSystem(fighterB, STANCE_B, TOPIC);

  const transcript = [];
  const repliesA = [], repliesB = [];
  let tokA = 0, tokB = 0;
  const tiersA = [], tiersB = [];
  let curHpA = 100, curHpB = 100;

  for (let r = 1; r <= ROUNDS; r++) {
    // A
    const mA = pickModel(tokA); tiersA.push(mA.label);
    const histA = transcript.map((t) => ({ role: t.side === "A" ? "assistant" : "user", content: t.text }));
    const resA = await call(sysA, [...histA, { role: "user", content: r === 1 ? "Открой дебаты сильнейшим аргументом." : "Парируй оппонента и ударь снова." }], { model: mA.id });
    tokA += resA.usage?.total_tokens || 0;
    transcript.push({ side: "A", text: resA.text }); repliesA.push(resA.text);

    // B
    const mB = pickModel(tokB); tiersB.push(mB.label);
    const histB = transcript.map((t) => ({ role: t.side === "B" ? "assistant" : "user", content: t.text }));
    const resB = await call(sysB, [...histB, { role: "user", content: "Разбей это и ударь в ответ." }], { model: mB.id });
    tokB += resB.usage?.total_tokens || 0;
    transcript.push({ side: "B", text: resB.text }); repliesB.push(resB.text);

    // судья раунда
    const jr = await call(roundJudgeSystem(), [{ role: "user", content: `Тема: ${TOPIC}\nA (${fighterA.name}): «${STANCE_A}» сказал: "${resA.text}"\nB (${fighterB.name}): «${STANCE_B}» сказал: "${resB.text}"` }], { json: true, maxTokens: 300, model: MODEL_TIERS[0].id });
    const { damageToA, damageToB } = roundDamage(jr.parsed);
    curHpA = Math.max(0, curHpA - damageToA); curHpB = Math.max(0, curHpB - damageToB);

    console.log(`  Раунд ${r} [A:${mA.label} B:${mB.label}]`);
    console.log(`    A(${wordCount(resA.text)}сл): ${resA.text}`);
    console.log(`    B(${wordCount(resB.text)}сл): ${resB.text}`);
    console.log(`    судья: ${jr.parsed.note}  (HP ${curHpA}/${curHpB})\n`);

    // --- проверки раунда ---
    check(`R${r}: реплика A непустая`, resA.text.length > 0);
    check(`R${r}: реплика B непустая`, resB.text.length > 0);
    warn(`R${r}: A краткая (≤${MAX_WORDS} слов)`, wordCount(resA.text) <= MAX_WORDS);
    warn(`R${r}: B краткая (≤${MAX_WORDS} слов)`, wordCount(resB.text) <= MAX_WORDS);
    warn(`R${r}: A без английских фраз (латиница <15%)`, latinRatio(resA.text) < 0.15);
    warn(`R${r}: B без английских фраз (латиница <15%)`, latinRatio(resB.text) < 0.15);

    // судья: структура и диапазоны
    const okJudge = jr.parsed && jr.parsed.a && jr.parsed.b &&
      ["persuasion", "evidence", "rebuttal", "style"].every((k) =>
        Number.isFinite(+jr.parsed.a[k]) && +jr.parsed.a[k] >= 0 && +jr.parsed.a[k] <= 10 &&
        Number.isFinite(+jr.parsed.b[k]) && +jr.parsed.b[k] >= 0 && +jr.parsed.b[k] <= 10);
    check(`R${r}: судья вернул валидный JSON с баллами 0–10`, okJudge);
  }

  // --- анти-цикл: реплики бойца не повторяются ---
  if (repliesA.length > 1) {
    check("A не зациклился (реплики не дублируются)", new Set(repliesA).size === repliesA.length);
    warn("A: соседние реплики достаточно разные (Jaccard < 0.8)", jaccard(repliesA[0], repliesA[1]) < 0.8);
  }
  if (repliesB.length > 1) {
    check("B не зациклился (реплики не дублируются)", new Set(repliesB).size === repliesB.length);
    warn("B: соседние реплики достаточно разные (Jaccard < 0.8)", jaccard(repliesB[0], repliesB[1]) < 0.8);
  }

  // --- финальный вердикт ---
  const full = transcript.map((t) => `${t.side === "A" ? fighterA.name : fighterB.name}: ${t.text}`).join("\n\n");
  const fin = await call(finalJudgeSystem(), [{ role: "user", content: `Тема: ${TOPIC}\nA: «${STANCE_A}»\nB: «${STANCE_B}»\n\n${full}` }], { json: true, maxTokens: 300, model: MODEL_TIERS[0].id });
  console.log(`  Финал: ${JSON.stringify(fin.parsed)}\n`);
  check("финал: winner ∈ {A,B,draw}", ["A", "B", "draw"].includes(fin.parsed.winner));
  check("финал: счёт A в 0–100", +fin.parsed.score_a >= 0 && +fin.parsed.score_a <= 100);
  check("финал: счёт B в 0–100", +fin.parsed.score_b >= 0 && +fin.parsed.score_b <= 100);
  check("финал: есть текстовый вердикт", typeof fin.parsed.rationale === "string" && fin.parsed.rationale.length > 0);

  // --- деградация на реальных токенах ---
  console.log(`  токены: A=${tokA} тиры[${tiersA}] | B=${tokB} тиры[${tiersB}]`);
  check("расход токенов считается (A>0, B>0)", tokA > 0 && tokB > 0);
  check("жадный боец B тратит больше токенов, чем короткий A", tokB > tokA);
  warn("жадный боец B деградирует не медленнее A (по тирам раундов)",
    tiersB.every((t, i) => MODEL_TIERS.findIndex((m) => m.label === t) >= MODEL_TIERS.findIndex((m) => m.label === tiersA[i])));

  console.log(`\n  Итог: ${passed} прошло, ${failed} провалено, ${warned} предупреждений`);
  process.exit(failed ? 1 : 0);
}

run().catch((e) => { console.error("\n  💥 Тест упал:", e.message); process.exit(1); });
