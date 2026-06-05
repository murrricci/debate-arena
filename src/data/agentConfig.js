// Тонкая настройка агента-бойца. Каждый параметр — это осознанный компромисс
// между "силой здесь и сейчас" и "расходом токенов" (быстрая деградация модели).
// Этот же файл — источник правды для формы регистрации и для вкладки-инструкции.

export const DEFAULT_CONFIG = {
  memory: "window", // сколько прошлых реплик видит агент
  windowSize: 3, // если memory === "window"
  temperature: 0.8, // характер: расчётливость ↔ хаос
  replyLen: "short", // длина реплики
  focus: "balanced", // тактика: атака / защита / баланс
};

// --- ПАМЯТЬ (контекст) ---
// Главный ресурс-менеджмент: больше памяти = умнее ответы, но больше токенов на
// каждый запрос → боец быстрее "перегревается" и проваливается на слабую модель.
export const MEMORY_OPTIONS = [
  {
    id: "last",
    name: "Только последняя",
    desc: "Агент видит лишь последнюю реплику оппонента",
    hint: "Дёшево по токенам — дольше держит сильную модель, но легко теряет нить спора и повторяется.",
  },
  {
    id: "window",
    name: "Окно из N реплик",
    desc: "Агент помнит несколько последних реплик",
    hint: "Золотая середина. Чем больше окно — тем умнее, но тем дороже каждый ход.",
  },
  {
    id: "all",
    name: "Весь спор",
    desc: "Агент держит в голове все реплики с начала боя",
    hint: "Самые связные и точные ответы, но расход токенов растёт от раунда к раунду — деградация почти неизбежна к финалу.",
  },
];

// --- ТЕМПЕРАТУРА (temperature) ---
// Регулируется ползунком 0.1–1.5. Зоны ниже используются для подсказок и в инструкции.
export const TEMPERATURE_MIN = 0.1;
export const TEMPERATURE_MAX = 1.5;
export const TEMPERATURE_STEP = 0.1;

export const TEMPERATURE_ZONES = [
  { id: "cold", name: "Хладнокровный", max: 0.5, hint: "Сухо, логично, предсказуемо. Бьёт фактами." },
  { id: "fighter", name: "Боевой", max: 1.0, hint: "Баланс логики и дерзости. Универсальный режим." },
  { id: "chaos", name: "Безбашенный", max: 1.5, hint: "Яркие неожиданные ходы и метафоры, но рискует уйти в сторону." },
];

export function temperatureZone(temp) {
  return TEMPERATURE_ZONES.find((z) => temp <= z.max) || TEMPERATURE_ZONES[TEMPERATURE_ZONES.length - 1];
}

// Совместимость со старым именем (используется в инструкции/карточках).
export const TEMPERAMENT_OPTIONS = TEMPERATURE_ZONES;

// --- ДЛИНА РЕПЛИКИ ---
export const REPLY_LEN_OPTIONS = [
  { id: "short", name: "Хлёсткая", words: 25, hint: "1–2 предложения. Минимум токенов, максимум темпа." },
  { id: "medium", name: "Развёрнутая", words: 40, hint: "До 3 предложений. Весомее, но дороже." },
  { id: "long", name: "Монолог", words: 60, hint: "Максимум аргументов за ход — но и максимум расхода, перегрев близко." },
];

// --- ТАКТИКА (фокус) ---
export const FOCUS_OPTIONS = [
  { id: "attack", name: "Агрессия", hint: "Давит на слабые места оппонента, почти не защищается." },
  { id: "defend", name: "Оборона", hint: "Укрепляет свою позицию и парирует, реже атакует." },
  { id: "balanced", name: "Баланс", hint: "Поровну атаки и защиты." },
];

// ---- Хелперы ----
export function getConfig(participant) {
  return { ...DEFAULT_CONFIG, ...(participant?.config || {}) };
}

export function temperatureValue(cfg) {
  return typeof cfg.temperature === "number" ? cfg.temperature : 0.8;
}

export function replyWords(cfg) {
  return REPLY_LEN_OPTIONS.find((r) => r.id === cfg.replyLen)?.words ?? 25;
}

// Сколько прошлых реплик отдать агенту, исходя из настройки памяти.
// total — общее число реплик в стенограмме на текущий момент.
export function memoryWindow(cfg, total) {
  if (cfg.memory === "last") return 1;
  if (cfg.memory === "all") return total;
  return cfg.windowSize ?? 3;
}

// Текстовая добавка к промпту под выбранную тактику.
export function focusInstruction(cfg) {
  if (cfg.focus === "attack") return "Тактика: АГРЕССИЯ. Атакуй слабые места оппонента, почти не оправдывайся.";
  if (cfg.focus === "defend") return "Тактика: ОБОРОНА. Прежде всего укрепляй и защищай свою позицию, парируй удары.";
  return "Тактика: БАЛАНС. Сочетай атаку на оппонента и защиту своей позиции примерно поровну.";
}
