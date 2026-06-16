// Юнит-тест механики деградации модели (без сети, детерминированный).
// Проверяем: пороги, монотонность и что "жадный" длинный промпт деградирует раньше.
import { pickTier, pickModel, MODEL_TIERS, TIER_THRESHOLDS } from "../src/lib/models.js";

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
}

console.log("\n=== TC-DEG: деградация модели ===");

// 1. Пороги переключают тиры правильно.
check("на старте (0 токенов) — сильный тир 0", pickTier(0) === 0);
check(`до 1-го порога (${TIER_THRESHOLDS[0]}) — всё ещё тир 0`, pickTier(TIER_THRESHOLDS[0] - 1) === 0);
check(`на 1-м пороге — тир 1`, pickTier(TIER_THRESHOLDS[0]) === 1);
check(`на 2-м пороге (${TIER_THRESHOLDS[1]}) — тир 2`, pickTier(TIER_THRESHOLDS[1]) === 2);
check("за пределами — не глубже последнего тира", pickTier(999999) === MODEL_TIERS.length - 1);

// 2. Монотонность: чем больше токенов, тем не выше (не сильнее) тир.
let monotone = true;
let prev = 0;
for (let t = 0; t <= 3000; t += 50) {
  const cur = pickTier(t);
  if (cur < prev) monotone = false;
  prev = cur;
}
check("монотонность: тир только растёт с расходом токенов", monotone);

// 3. pickModel возвращает корректную запись тира (сравниваем по идентичности объекта,
//    т.к. конкретные модели теперь живут на бэкенде, у записи тира нет .id).
check("pickModel(0) → самая сильная ступень", pickModel(0) === MODEL_TIERS[0]);
check("pickModel(big) → самая слабая ступень", pickModel(999999) === MODEL_TIERS.at(-1));

// 4. Ключевая механика: большой промпт → раньше деградация.
//    Симулируем расход: лёгкий боец тратит ~180 ток/раунд, тяжёлый ~520 ток/раунд.
function simulateRounds(perRound, rounds) {
  let tok = 0;
  const tiers = [];
  for (let r = 1; r <= rounds; r++) {
    tiers.push(pickTier(tok)); // тир выбирается ПЕРЕД репликой, по уже накопленному
    tok += perRound;
  }
  return tiers;
}
const light = simulateRounds(180, 5); // короткий промпт
const heavy = simulateRounds(520, 5); // длинный, "жадный" промпт

console.log(`    лёгкий промпт, тиры по раундам: [${light}]`);
console.log(`    тяжёлый промпт, тиры по раундам: [${heavy}]`);

check("тяжёлый промпт деградирует не медленнее лёгкого (по каждому раунду)",
  heavy.every((t, i) => t >= light[i]));
check("тяжёлый промпт достигает слабого тира раньше лёгкого",
  heavy.findIndex((t) => t === MODEL_TIERS.length - 1) <
  (light.findIndex((t) => t === MODEL_TIERS.length - 1) + 1 || Infinity));
check("тяжёлый промпт реально доходит до самого слабого тира за 5 раундов",
  heavy.includes(MODEL_TIERS.length - 1));

console.log(`\n  Итог: ${passed} прошло, ${failed} провалено`);
process.exit(failed ? 1 : 0);
