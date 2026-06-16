// Лестница ступеней деградации (тиров). Боец стартует на сильной ступени, но по мере
// расхода токенов "перегревается" и спускается на более слабые. Чем длиннее промпт
// игрока (скиллы + своя фишка), тем больше токенов на запрос — и тем быстрее деградация.
// Это только метаданные ступени (для UI и индекса тира). Конкретные модели за каждым
// тиром задаются в .env на бэкенде (LLM_TIER_1/2/3); фронт шлёт лишь индекс `tier`.
export const MODEL_TIERS = [
  { tier: 0, label: "120B", tag: "PRIME", color: "#2bff9e" },
  { tier: 1, label: "70B", tag: "WORN", color: "#ff3ca5" },
  { tier: 2, label: "20B", tag: "FRIED", color: "#ff2b6d" },
];

// Пороги накопленных токенов (включая prompt) для перехода на следующий тир.
export const TIER_THRESHOLDS = [700, 1600];

export function pickTier(tokensUsed) {
  let tier = 0;
  for (const t of TIER_THRESHOLDS) {
    if (tokensUsed >= t) tier += 1;
  }
  return Math.min(tier, MODEL_TIERS.length - 1);
}

export function pickModel(tokensUsed) {
  return MODEL_TIERS[pickTier(tokensUsed)];
}
