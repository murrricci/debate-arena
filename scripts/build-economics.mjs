// Экономика Debate Arena: расчёт стоимости прогона на 2 конференциях.
// Цены OpenRouter взяты живьём из API (см. дату ниже), Claude — из публичного прайса.
// Расход токенов на бой выведен из механики (10 запросов/бой) и реальных замеров теста.
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "print");
mkdirSync(outDir, { recursive: true });

const PRICES_DATE = "4 июня 2026 (OpenRouter API, live)";

// ---- Расход токенов на ОДИН бой (3 раунда = 10 запросов к модели) ----
// 6 реплик бойцов + 3 оценки судьи + 1 финальный вердикт.
// Замер реального боя (лог тайминга): сумма total_tokens 10 вызовов ≈ 22 200 — это 3.1× от прежней
// оценки 7 200. Лог фиксирует только total_tokens, поэтому вход/выход разделены оценочно: выход
// ограничен max_tokens (судья/финал ≤300, реплики бойцов ~350) → ~3 000, всё остальное — вход.
const TOK_IN = 19200;  // входные токены (большие системки-персоны + растущая история ×10 вызовов)
const TOK_OUT = 3000;  // выходные токены (реплики + JSON судьи/финала, потолок max_tokens)
const CALLS_PER_FIGHT = 10;

// ---- Объём боёв ----
// Ограничен пропускной способностью одного ринга (~3–4 мин/бой), а не числом гостей.
// Конф.1: 3000 чел, 2 дня, оживлённо → ~120 боёв/день. Конф.2: 2000 чел, 2 дня → ~90/день.
const CONF = [
  { name: "Конференция 1", people: 3000, days: 2, fightsPerDay: 120 },
  { name: "Конференция 2", people: 2000, days: 2, fightsPerDay: 90 },
];
const baseFights = CONF.reduce((s, c) => s + c.days * c.fightsPerDay, 0); // ~420
const heavyFights = baseFights * 2; // пиковый сценарий (2 ринга / плотный поток)

// ---- Модели и цены ($/1M токенов) ----
// type: "token" — оплата по токенам; "flat" — фиксированная подписка.
const MODELS = [
  {
    group: "Бесплатные модели",
    name: "Free (gpt-oss, qwen:free и т.п.)",
    type: "token", in: 0, out: 0,
    note: "Жёсткие rate-limit (429), часто «No backends». На потоке 5000 гостей нестабильно — нужен платный фоллбэк.",
  },
  {
    group: "OpenRouter — быстрая дешёвая",
    name: "Qwen Flash (qwen3.5-flash)",
    type: "token", in: 0.065, out: 0.26,
    note: "Самая дешёвая из вменяемых. Быстрая, реплики бойцов тянет; для судьи слабовата.",
  },
  {
    group: "OpenRouter — DeepSeek",
    name: "DeepSeek V3.2",
    type: "token", in: 0.229, out: 0.343,
    note: "Отличный баланс цена/качество. Хорошо держит русский и JSON судьи.",
  },
  {
    group: "OpenRouter — большая Qwen",
    name: "Qwen3.5-397B-A17B",
    type: "token", in: 0.390, out: 2.340,
    note: "Флагман Qwen3.5 (397B, MoE A17B, контекст 262k). Топ-качество дебатов и судейства.",
  },
  {
    group: "Claude API (для сравнения)",
    name: "Claude Haiku 4.5 (API)",
    type: "token", in: 1.0, out: 5.0,
    note: "Pay-as-you-go. Дешёвый Claude, качество выше Qwen Flash.",
  },
  {
    group: "Claude API (для сравнения)",
    name: "Claude Sonnet 4.x (API)",
    type: "token", in: 3.0, out: 15.0,
    note: "Pay-as-you-go. Премиум-качество и стабильность.",
  },
  {
    group: "Claude подписка",
    name: "Claude Max (20×) — подписка",
    type: "flat", monthly: 200, months: 2,
    note: "⚠️ Подписка Max привязана к Claude.ai/Claude Code и НЕ доступна по API для внешнего приложения. Для арены технически не подходит; цена дана как «если бы». Плюс лимиты использования.",
  },
];

const perFight = (m) => (TOK_IN / 1e6) * m.in + (TOK_OUT / 1e6) * m.out;
const fmt = (n) => (n < 0.01 ? "$" + n.toFixed(4) : n < 1 ? "$" + n.toFixed(3) : "$" + n.toFixed(2));

function rowFor(m) {
  if (m.type === "flat") {
    const total = m.monthly * m.months;
    return { unit: `${fmt(m.monthly)}/мес`, base: fmt(total), heavy: fmt(total), flat: true };
  }
  const pf = perFight(m);
  return { unit: fmt(pf) + "/бой", base: fmt(pf * baseFights), heavy: fmt(pf * heavyFights) };
}

// ---- Консольный вывод (для проверки) ----
console.log(`\nБоёв: базовый ${baseFights}, пиковый ${heavyFights}. Токенов/бой: ${TOK_IN}+${TOK_OUT}.`);
for (const m of MODELS) {
  const r = rowFor(m);
  console.log(`  ${m.name.padEnd(34)} ${r.unit.padEnd(14)} база=${r.base.padEnd(9)} пик=${r.heavy}`);
}

// ---- HTML для PDF ----
const groupRows = MODELS.map((m) => {
  const r = rowFor(m);
  return `<tr>
    <td class="mname">${m.name}<div class="mnote">${m.note}</div></td>
    <td class="num">${m.type === "flat" ? `$${m.in ?? m.monthly}/мес` : `$${m.in}/$${m.out}`}</td>
    <td class="num">${r.unit}</td>
    <td class="num hi">${r.base}</td>
    <td class="num">${r.heavy}</td>
  </tr>`;
}).join("");

const totalTokensBase = ((TOK_IN + TOK_OUT) * baseFights / 1e6).toFixed(2);

const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Debate Arena — экономика</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Arial, sans-serif; color: #1a1a2e; margin: 0; }
  h1 { font-size: 24px; margin: 0 0 2mm; }
  h1 .a { color: #b01a86; } h1 .b { color: #0090c0; }
  .sub { color: #666; font-size: 12px; margin-bottom: 5mm; }
  h2 { font-size: 15px; margin: 6mm 0 2mm; color: #b01a86; border-bottom: 2px solid #eee; padding-bottom: 1mm; }
  .grid { display: flex; gap: 4mm; margin-bottom: 4mm; }
  .box { flex: 1; border: 1.5px solid #e3d6ee; border-radius: 8px; padding: 3mm 4mm; background: #faf6fe; }
  .box b { font-size: 20px; color: #7a1fb0; display: block; }
  .box span { font-size: 10.5px; color: #666; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { background: #2a1840; color: #fff; padding: 2.5mm; text-align: left; font-size: 10px; }
  th.num, td.num { text-align: right; }
  td { padding: 2.5mm; border-bottom: 1px solid #eee; vertical-align: top; }
  .mname { font-weight: 700; max-width: 70mm; }
  .mnote { font-weight: 400; color: #777; font-size: 9.5px; margin-top: 1mm; line-height: 1.35; }
  td.hi { font-weight: 800; color: #0a8f5b; background: #f0fbf5; }
  tr:nth-child(even) td:not(.hi) { background: #fbfafd; }
  .note { font-size: 10.5px; color: #555; line-height: 1.5; }
  .rec { border-left: 4px solid #0a8f5b; background: #f0fbf5; padding: 3mm 4mm; border-radius: 0 8px 8px 0; font-size: 11px; line-height: 1.55; }
  .warn { border-left: 4px solid #d9534f; background: #fdf3f2; padding: 3mm 4mm; border-radius: 0 8px 8px 0; font-size: 10.5px; line-height: 1.5; margin-top: 3mm; }
  ul { margin: 1mm 0; padding-left: 5mm; } li { margin-bottom: 1mm; font-size: 11px; }
  .foot { margin-top: 6mm; font-size: 9px; color: #999; }
</style></head><body>

<h1>🥊 <span class="a">DEBATE</span> <span class="b">ARENA</span> — экономика прогона</h1>
<div class="sub">2 конференции по 2 дня · ${CONF[0].people.toLocaleString("ru")} + ${CONF[1].people.toLocaleString("ru")} гостей · цены: ${PRICES_DATE}</div>

<h2>Исходные допущения</h2>
<div class="grid">
  <div class="box"><b>${CALLS_PER_FIGHT}</b><span>запросов к модели на 1 бой<br>(3 раунда + судья + финал)</span></div>
  <div class="box"><b>~${(TOK_IN + TOK_OUT).toLocaleString("ru")}</b><span>токенов на бой<br>(${TOK_IN.toLocaleString("ru")} вход + ${TOK_OUT.toLocaleString("ru")} выход)</span></div>
  <div class="box"><b>${baseFights}</b><span>боёв — базовый сценарий<br>(120 + 90 боёв/день × 2 дня)</span></div>
  <div class="box"><b>${heavyFights}</b><span>боёв — пиковый сценарий<br>(2 ринга / плотный поток)</span></div>
</div>
<div class="note">
  Число боёв ограничено пропускной способностью ринга (~3–4 мин/бой, ~80–120 боёв/день на один экран),
  а не числом гостей: 5000 человек физически не успеют сыграть больше. При базовом сценарии это
  ~${totalTokensBase} млн токенов за оба мероприятия — мизер для любой платной модели.
</div>

<h2>Стоимость по сценариям</h2>
<table>
  <thead><tr>
    <th>Модель / тариф</th>
    <th class="num">Цена $/1M (вх/вых)</th>
    <th class="num">За 1 бой</th>
    <th class="num">Базовый (${baseFights})</th>
    <th class="num">Пиковый (${heavyFights})</th>
  </tr></thead>
  <tbody>${groupRows}</tbody>
</table>

<h2>Вывод и рекомендация</h2>
<div class="rec">
  <b>Токены здесь почти ничего не стоят.</b> Даже флагманская Qwen3.5-397B обходится в единицы долларов
  за оба мероприятия, а Qwen Flash / DeepSeek — в районе <b>$0.85–2.3</b> суммарно. Узкое место — не деньги,
  а скорость и стабильность.
  <ul>
    <li><b>Оптимум:</b> бойцы на <b>Qwen Flash</b> или <b>DeepSeek V3.2</b>, судья и финал — на <b>DeepSeek/Qwen3.5-397B</b> (он арбитр, важно качество). Итог: <b>$2–5</b> за обе конференции.</li>
    <li><b>Премиум-вариант:</b> всё на Claude Sonnet API — стабильно и качественно, всё равно лишь <b>~$43–86</b> суммарно (pay-as-you-go).</li>
    <li><b>Закладывай платный фоллбэк</b> в любом случае: один прайм-тайм на 3000 гостей убьёт бесплатные лимиты.</li>
  </ul>
</div>
<div class="warn">
  <b>Про «Claude Max подписку»:</b> тариф Max (≈$200/мес) рассчитан на работу в Claude.ai и Claude Code и
  <b>не предоставляет API-ключ для внешнего веб-приложения</b> — для арены он технически непригоден. Вдобавок
  $200–400 — это в 10–100 раз дороже, чем pay-as-you-go под нашу нагрузку. Подписку брать не нужно.
</div>

<div class="foot">
  Допущения по токенам — из механики боя и замера реального боя (лог тайминга, ≈22 200 токенов/бой; вход/выход разделены оценочно, лог даёт только total_tokens). Цены OpenRouter — live из API на дату выше;
  Claude — публичный прайс (Haiku 4.5 $1/$5, Sonnet 4.x $3/$15, Max 20× ≈ $200/мес). Фактический расход ±20–30% в зависимости от длины персон и настроек памяти бойцов.
</div>

</body></html>`;

const htmlPath = join(outDir, "economics.html");
writeFileSync(htmlPath, html, "utf8");
console.log("\n✅ HTML:", htmlPath);

const chrome = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
].find((p) => existsSync(p));
const pdfPath = join(outDir, "economics.pdf");
if (chrome) {
  execFileSync(chrome, ["--headless", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${pdfPath}`, `file://${htmlPath}`], { stdio: "ignore" });
  console.log("✅ PDF:", pdfPath);
} else {
  console.warn("⚠️ Chrome не найден — открой economics.html и Cmd+P → PDF.");
}
