// Лестница моделей по силе. Боец стартует на сильной, но по мере расхода токенов
// "перегревается" и спускается на более слабые. Чем длиннее промпт игрока
// (скиллы + своя фишка), тем больше токенов на каждый запрос — и тем быстрее деградация.
export const MODEL_TIERS = [
  { id: "openai/gpt-oss-120b:free", label: "120B", tag: "PRIME", color: "#2bff9e" },
  { id: "meta-llama/llama-3.3-70b-instruct:free", label: "70B", tag: "WORN", color: "#ff3ca5" },
  { id: "openai/gpt-oss-20b:free", label: "20B", tag: "FRIED", color: "#ff2b6d" },
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
