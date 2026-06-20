// Юнит-тест общего runner боя: без сети, с fake LLM-call.
import { runDebateFight } from "../src/lib/fightRunner.js";

let passed = 0, failed = 0;
const check = (name, cond) => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
};

console.log("\n=== TC-FIGHT-RUNNER: общий runner боя ===");

const calls = [];
const scripted = [
  { text: "Аргумент A1", usage: { total_tokens: 100, cost_rub: 1 }, model: "m-a1" },
  { text: "Ответ B1", usage: { total_tokens: 120, cost_rub: 1 }, model: "m-b1" },
  { parsed: { a: { persuasion: 8, evidence: 8, rebuttal: 8, style: 8 }, b: { persuasion: 7, evidence: 7, rebuttal: 7, style: 7 }, note: "A сильнее" }, usage: { total_tokens: 30 } },
  { text: "Аргумент A2", usage: { total_tokens: 100, cost_rub: 1 }, model: "m-a2" },
  { text: "Ответ B2", usage: { total_tokens: 120, cost_rub: 1 }, model: "m-b2" },
  { parsed: { a: { persuasion: 6, evidence: 6, rebuttal: 6, style: 6 }, b: { persuasion: 9, evidence: 9, rebuttal: 9, style: 9 }, note: "B вернул" }, usage: { total_tokens: 30 } },
  { parsed: { winner: "A", score_a: 82, score_b: 75, rationale: "A убедительнее" }, usage: { total_tokens: 40 } },
];

async function fakeCall(system, messages, options) {
  calls.push({ system, messages, options });
  const next = scripted.shift();
  if (!next) throw new Error("unexpected call");
  return { text: next.text || "", parsed: next.parsed || null, usage: next.usage || {}, model: next.model || "", ms: 1 };
}

const events = [];
const fighterA = { id: "a", name: "Альфа", skills: ["aggressor"], custom: "", config: {} };
const fighterB = { id: "b", name: "Бета", skills: ["factualist"], custom: "", config: {} };
const topic = { id: "t", title: "Тестовая тема", sideA: "За A", sideB: "За B" };

const result = await runDebateFight({
  aF: fighterA,
  bF: fighterB,
  topic,
  swap: false,
  rounds: 2,
  call: fakeCall,
  waitFor: async () => {},
  onEvent: (event) => events.push(event),
});

check("runner делает 2 раунда и финал = 7 model calls", calls.length === 7);
check("судья вызывается как judge=true", calls.filter((c) => c.options?.judge).length === 3);
check("runner возвращает итоговый winner/score", result.winner === "A" && result.scoreA === 82 && result.scoreB === 75);
check("runner возвращает стенограмму по двум репликам на раунд", result.transcript.length === 4);
check("runner возвращает полный протокол по раундам", result.history?.rounds?.length === 2);
check(
  "протокол сохраняет реплики и реакцию судьи",
  result.history?.rounds?.[0]?.replies?.A?.text === "Аргумент A1" &&
    result.history?.rounds?.[0]?.replies?.B?.text === "Ответ B1" &&
    result.history?.rounds?.[0]?.judge?.note === "A сильнее"
);
check(
  "протокол содержит тему, стороны и финальный вердикт",
  result.history?.topic?.title === "Тестовая тема" &&
    result.history?.stances?.A === "За A" &&
    result.history?.final?.winner === "A"
);
check("runner публикует события reply и verdict", events.some((e) => e.type === "reply" && e.side === "A") && events.some((e) => e.type === "verdict"));
check("runner считает расход токенов бойцов отдельно", result.tokensA === 200 && result.tokensB === 240);

console.log(`\n  Итог: ${passed} прошло, ${failed} провалено`);
process.exit(failed ? 1 : 0);
