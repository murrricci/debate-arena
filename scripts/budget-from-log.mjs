// Реальный бюджет по логу обращений (logs/llm-usage.jsonl — пишет server.js).
// Стоимость берётся НАПРЯМУЮ из ответов провайдера: AITunnel кладёт сумму запроса в рублях
// в usage.cost_rub, а server.js сохраняет её в лог (поле cost_rub) вместе с именем модели из
// ответа. Здесь просто суммируем по фактам — никаких прайс-листов и оценок.
//
// Запуск:
//   node scripts/budget-from-log.mjs [путь-к-логу] [--fights N]
//   npm run budget

import { readFileSync, existsSync } from "node:fs";

// ---- Аргументы ----
const argv = process.argv.slice(2);
let logPath = null, fightsOverride = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--fights") fightsOverride = Number(argv[++i]);
  else if (!a.startsWith("--")) logPath = a;
}
logPath = logPath || "logs/llm-usage.jsonl";

// ---- Чтение лога ----
if (!existsSync(logPath)) {
  console.error(`Лог не найден: ${logPath}\nПроведи хотя бы один бой — server.js пишет лог сам (LLM_LOG_FILE).`);
  process.exit(1);
}
const rows = readFileSync(logPath, "utf8").split("\n").map((s) => s.trim()).filter(Boolean)
  .map((s, i) => { try { return JSON.parse(s); } catch { console.warn(`⚠️ строка ${i + 1}: не JSON, пропускаю`); return null; } })
  .filter(Boolean);
if (!rows.length) { console.error("Лог пуст."); process.exit(1); }

// ---- Агрегация ----
const roleOf = (label) => (!label ? "(без метки)" : label.replace(/^R\d+·/, "")); // «R2·судья» → «судья»
const byModel = new Map(), byRole = new Map();
let calls = 0, fails = 0, fights = 0, grand = 0, noCost = 0;

const bump = (map, key, r, cost) => {
  const e = map.get(key) || { calls: 0, in: 0, out: 0, reas: 0, total: 0, cost: 0, noCost: 0 };
  e.calls++;
  e.in += r.prompt_tokens || 0;
  e.out += r.completion_tokens || 0;
  e.reas += r.reasoning_tokens || 0; // часть выхода, ушедшая на reasoning
  e.total += r.total_tokens || ((r.prompt_tokens || 0) + (r.completion_tokens || 0));
  if (cost == null) e.noCost++; else e.cost += cost;
  map.set(key, e);
};

for (const r of rows) {
  if (r.ok === false) { fails++; continue; }
  calls++;
  if (r.label === "финал") fights++;
  const cost = typeof r.cost_rub === "number" ? r.cost_rub : null;
  if (cost == null) noCost++; else grand += cost;
  bump(byModel, r.model || "(неизвестно)", r, cost);
  bump(byRole, roleOf(r.label), r, cost);
}
const fightCount = fightsOverride ?? (fights || (calls ? Math.round(calls / 10) : 0));

// ---- Вывод ----
const num = (n) => n.toLocaleString("ru-RU");
const rub = (n) => (n === 0 ? "0 ₽" : n < 0.01 ? n.toFixed(5) + " ₽" : n < 1 ? n.toFixed(4) + " ₽" : n.toFixed(2) + " ₽");

function table(title, map) {
  console.log(`\n${title}`);
  const list = [...map.entries()].sort((a, b) => (b[1].cost - a[1].cost) || (b[1].total - a[1].total));
  const w = Math.min(40, Math.max(10, ...list.map(([k]) => k.length)));
  console.log(`  ${"".padEnd(w)}  ${"выз".padStart(4)}  ${"вход".padStart(9)}  ${"выход".padStart(8)}  ${"рассужд".padStart(8)}  ${"стоимость".padStart(12)}`);
  for (const [k, e] of list) {
    const warn = e.noCost ? `  ⚠ без cost_rub: ${e.noCost}` : "";
    console.log(`  ${k.padEnd(w)}  ${String(e.calls).padStart(4)}  ${num(e.in).padStart(9)}  ${num(e.out).padStart(8)}  ${num(e.reas).padStart(8)}  ${rub(e.cost).padStart(12)}${warn}`);
  }
}

const totIn = [...byModel.values()].reduce((s, e) => s + e.in, 0);
const totOut = [...byModel.values()].reduce((s, e) => s + e.out, 0);

console.log(`\n=== Бюджет по логу: ${logPath} ===`);
console.log(`Записей: ${rows.length} · успешных: ${calls} · ошибок: ${fails} · боёв (по «финал»): ${fights}${fightsOverride != null ? ` (override → ${fightCount})` : ""}`);
console.log(`Токенов: вход ${num(totIn)} · выход ${num(totOut)} · всего ${num(totIn + totOut)}`);
console.log(`Стоимость — фактическая, из usage.cost_rub ответов провайдера (₽).`);

table("По моделям (на что больше потратили):", byModel);
table("По типам вызовов:", byRole);

console.log(`\nИТОГО: ${rub(grand)}${noCost ? `  ⚠️ без cost_rub: ${noCost} вызовов (не учтены в сумме)` : ""}`);
if (fightCount) {
  const perFight = grand / fightCount;
  console.log(`Стоимость/бой: ${rub(perFight)} (по ${fightCount} ${fightCount === 1 ? "бою" : "боям"})`);
  console.log(`Экстраполяция: 420 боёв ≈ ${rub(perFight * 420)} · 840 (пик) ≈ ${rub(perFight * 840)}`);
}
if (noCost === calls) console.log(`\nНи в одной записи нет cost_rub — лог писался до этой доработки. Проведи новый бой.`);
