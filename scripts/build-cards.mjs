// Генератор печатных карточек с правилами игры.
// Берёт данные прямо из src/ (чтобы карточки всегда совпадали с игрой),
// собирает самодостаточный HTML и, если найден Chrome, рендерит PDF.
import { writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { MODEL_TIERS, TIER_THRESHOLDS } from "../src/lib/models.js";
import { CRITERIA } from "../src/data/judging.js";
import { MEMORY_OPTIONS, TEMPERAMENT_OPTIONS, REPLY_LEN_OPTIONS, FOCUS_OPTIONS, JUDGE_OPTIONS } from "../src/data/agentConfig.js";
import { SKILL_CARDS } from "../src/data/skills.js";

const MAX_UPGRADES = 3;
const TOP_N = 10;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "print");
mkdirSync(outDir, { recursive: true });

const li = (arr) => arr.map((x) => `<li>${x}</li>`).join("");

// ---- Карточки ----
const cards = [];

cards.push(`
<div class="card cover">
  <div class="bolt">⚡</div>
  <h1><span class="m">DEBATE</span> <span class="c">ARENA</span></h1>
  <div class="sub">ИИ против ИИ · конференц-ринг</div>
  <p class="lead">Собери своего бойца, выпусти его на ринг и захвати вершину табло. Два ИИ-агента
  спорят вживую, ИИ-судья считает удары. Победа зависит от того, как ты настроишь агента.</p>
  <div class="steps">
    <div><b>1.</b> Зарегистрируй бойца: имя, скиллы, настройки</div>
    <div><b>2.</b> Разминка: своди бойцов и апгрейди (до ${MAX_UPGRADES} раз)</div>
    <div><b>3.</b> Организатор закрывает приём → турнир топ-${TOP_N}</div>
    <div><b>4.</b> Круговая система → турнирная таблица 🥇🥈🥉</div>
  </div>
</div>`);

cards.push(`
<div class="card">
  <h2>⚡ Главный закон: токены = жизнь</h2>
  <p>Каждая реплика стоит <b>токенов</b>. Чем «жаднее» настроен боец, тем больше он их жжёт — и тем
  быстрее его модель <b>деградирует</b> от мощной к слабой:</p>
  <div class="tiers">
    ${MODEL_TIERS.map((t, i) => `
      <div class="tier" style="border-color:${t.color}">
        <div class="tlabel" style="color:${t.color}">🧠 ${t.label} · ${t.tag}</div>
        <div class="tnote">${i === 0 ? "старт боя" : `после ${TIER_THRESHOLDS[i - 1]} токенов`}</div>
      </div>`).join("")}
  </div>
  <p class="hot">Скромный и точный боец дольше остаётся «в уме». Жадный — мощнее на старте,
  но к финалу тупеет. Ищи баланс!</p>
</div>`);

cards.push(`
<div class="card">
  <h2>⚙️ Параметры агента</h2>
  <div class="param"><h3>🧠 Память</h3><ul>${li(MEMORY_OPTIONS.map((o) => `<b>${o.name}</b> — ${o.hint}`))}</ul></div>
  <div class="param"><h3>🌡️ Температура (ползунок 0.1–1.5)</h3><ul>${li(TEMPERAMENT_OPTIONS.map((o) => `<b>${o.name}</b> — ${o.hint}`))}</ul></div>
  <div class="param"><h3>✍️ Длина реплики</h3><ul>${li(REPLY_LEN_OPTIONS.map((o) => `<b>${o.name} (~${o.words} сл.)</b> — ${o.hint}`))}</ul></div>
  <div class="param"><h3>🎯 Тактика</h3><ul>${li(FOCUS_OPTIONS.map((o) => `<b>${o.name}</b> — ${o.hint}`))}</ul></div>
  <div class="param"><h3>🧑‍⚖️ Мнение судьи</h3><ul>${li(JUDGE_OPTIONS.map((o) => `<b>${o.name}</b> — ${o.hint}`))}</ul></div>
</div>`);

cards.push(`
<div class="card">
  <h2>⚖️ Судейство и очки</h2>
  <p>Каждый раунд ИИ-судья ставит обоим 0–10 баллов по критериям:</p>
  <ul class="crit">${li(CRITERIA.map((c) => `<b>${c.name}</b> — ${c.hint}`))}</ul>
  <p>Кто выступил слабее — теряет больше HP. В конце главный судья выставляет счёт 0–100.</p>
  <h3 class="tips">🏆 Очки за бой</h3>
  <div class="points">
    <div><b class="win">Победа</b> +3 и бонус за отрыв</div>
    <div><b class="draw">Ничья</b> +1 каждому</div>
    <div><b class="lose">Поражение</b> 0</div>
  </div>
</div>`);

cards.push(`
<div class="card">
  <h2>🥇 Турнир и места</h2>
  <p><b>Разминка.</b> Свободно своди бойцов и прокачивай их — параметры можно менять
  <b>до ${MAX_UPGRADES} раз</b> за всё время.</p>
  <p><b>Закрытие приёма.</b> Организатор жмёт «Закрыть приём» — новые заявки и апгрейд
  замораживаются.</p>
  <p><b>Турнир.</b> Берётся <b>топ-${TOP_N}</b> по очкам разминки, очки обнуляются и стартует
  <b>круговая система</b> — каждый играет с каждым.</p>
  <p><b>Итог.</b> По сумме очков — турнирная таблица. Места <b>1–2–3</b> отмечаются медалями
  <b>🥇 🥈 🥉</b>.</p>
  <div class="screens">
    <div class="scr">📺 Экран 1<br><span>бой на ринге</span></div>
    <div class="scr">📺 Экран 2<br><span>турнирная таблица</span></div>
  </div>
</div>`);

cards.push(`
<div class="card">
  <h2>🧬 Скиллы — характер бойца</h2>
  <p>Выбери один или несколько — они задают манеру спора:</p>
  <div class="skills">
    ${SKILL_CARDS.map((s) => `
      <div class="skill" style="border-color:${s.color}">
        <div class="semoji">${s.emoji}</div>
        <div class="sname" style="color:${s.color}">${s.name}</div>
        <div class="sdesc">${s.prompt}</div>
      </div>`).join("")}
  </div>
</div>`);

// Разложим карточки по 4 на A4-лист.
const perPage = 4;
let pages = "";
for (let i = 0; i < cards.length; i += perPage) {
  pages += `<div class="page">${cards.slice(i, i + perPage).join("")}</div>`;
}

const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<title>Debate Arena — карточки правил</title>
<style>
  @page { size: A4; margin: 8mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "Segoe UI", Arial, sans-serif; background: #0a0613; color: #ece8f5; }
  .page { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 6mm; width: 194mm; height: 281mm; page-break-after: always; }
  .card { border: 2px solid #33204f; border-radius: 10px; padding: 7mm; background: radial-gradient(ellipse at top, #1a0f33 0%, #110a20 80%); overflow: hidden; position: relative; }
  .card h1 { font-size: 30px; margin: 0 0 2mm; letter-spacing: 2px; }
  .card h2 { font-size: 17px; margin: 0 0 3mm; color: #00d9ff; letter-spacing: .5px; }
  .card h3 { font-size: 13px; margin: 3mm 0 1mm; color: #ff3ca5; }
  .m { color: #d94dff; } .c { color: #00d9ff; }
  p { font-size: 11.5px; line-height: 1.5; margin: 0 0 2.5mm; color: #d7cdec; }
  ul { margin: 0 0 2mm; padding-left: 5mm; }
  li { font-size: 10.5px; line-height: 1.45; margin-bottom: 1mm; color: #d7cdec; }
  b { color: #fff; }
  /* cover */
  .cover { text-align: center; display: flex; flex-direction: column; justify-content: center; align-items: center; border-color: #d94dff; }
  .bolt { font-size: 42px; }
  .sub { color: #ff3ca5; letter-spacing: 3px; font-size: 12px; margin-bottom: 4mm; }
  .lead { font-size: 12px; }
  .steps { margin-top: 3mm; text-align: left; }
  .steps div { font-size: 11px; margin-bottom: 1.5mm; color: #d7cdec; }
  /* tiers */
  .tiers { display: flex; gap: 3mm; margin: 3mm 0; }
  .tier { flex: 1; border: 2px solid; border-radius: 8px; padding: 3mm; background: #1b1033; text-align: center; }
  .tlabel { font-weight: 800; font-size: 12px; }
  .tnote { font-size: 9px; color: #8a7da8; margin-top: 1mm; }
  .hot { color: #ffd6ef; background: rgba(255,60,165,.1); border: 1px solid #33204f; border-radius: 8px; padding: 3mm; font-size: 11px; }
  .param { margin-bottom: 1.5mm; }
  /* points */
  .points { display: flex; gap: 3mm; margin: 3mm 0; }
  .points div { flex: 1; text-align: center; border: 1px solid #33204f; border-radius: 8px; padding: 2.5mm; font-size: 10px; background: #1b1033; }
  .win { color: #2bff9e; display: block; } .draw { color: #ff3ca5; display: block; } .lose { color: #ff2b6d; display: block; }
  .tips { margin-top: 3mm; }
  /* screens */
  .screens { display: flex; gap: 3mm; margin-top: 4mm; }
  .scr { flex: 1; text-align: center; border: 2px solid #00d9ff; border-radius: 8px; padding: 3mm; background: #1b1033; font-weight: 800; color: #00d9ff; font-size: 12px; }
  .scr span { display: block; font-weight: 400; color: #b9acd6; font-size: 9.5px; margin-top: 1mm; }
  /* skills */
  .skills { display: grid; grid-template-columns: 1fr 1fr; gap: 2.5mm; }
  .skill { border: 1.5px solid; border-radius: 8px; padding: 2.5mm; background: #1b1033; }
  .semoji { font-size: 18px; } .sname { font-weight: 800; font-size: 11px; margin: 1mm 0; }
  .sdesc { font-size: 8.5px; color: #b9acd6; line-height: 1.35; }
  .crit li { margin-bottom: 1.2mm; }
</style></head><body>${pages}</body></html>`;

const htmlPath = join(outDir, "rules-cards.html");
writeFileSync(htmlPath, html, "utf8");
console.log("✅ HTML:", htmlPath);

// ---- Рендер в PDF через Chrome (если есть) ----
const chromePaths = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];
const chrome = chromePaths.find((p) => existsSync(p));
const pdfPath = join(outDir, "rules-cards.pdf");

if (chrome) {
  try {
    execFileSync(chrome, [
      "--headless",
      "--disable-gpu",
      "--no-pdf-header-footer",
      `--print-to-pdf=${pdfPath}`,
      "--no-margins",
      `file://${htmlPath}`,
    ], { stdio: "ignore" });
    console.log("✅ PDF:", pdfPath);
  } catch (e) {
    console.warn("⚠️  Не удалось отрендерить PDF автоматически:", e.message);
    console.warn("   Открой rules-cards.html в браузере и Cmd+P → Сохранить как PDF.");
  }
} else {
  console.warn("⚠️  Chrome не найден. Открой rules-cards.html и Cmd+P → Сохранить как PDF.");
}
