// Критерии, по которым ИИ-судья оценивает каждого бойца (0–10 за раунд).
// Меняй формулировки/набор здесь — они автоматически попадут в промпт судьи и в табло.
export const CRITERIA = [
  { id: "persuasion", name: "Убедительность", hint: "сила и логичность аргумента" },
  { id: "evidence", name: "Обоснованность", hint: "конкретика, факты, корректность" },
  { id: "rebuttal", name: "Контраргумент", hint: "насколько разбита позиция оппонента" },
  { id: "style", name: "Подача", hint: "яркость, харизма, запоминаемость" },
];

const MAX_PER_CRITERION = 10;
const MAX_ROUND_DAMAGE = 22; // максимум HP, что боец может потерять за раунд

export function maxRoundScore() {
  return CRITERIA.length * MAX_PER_CRITERION; // 40
}

// Системный промпт судьи раунда.
export function roundJudgeSystem() {
  const list = CRITERIA.map((c) => `"${c.id}" (${c.name} — ${c.hint})`).join(", ");
  const shape = CRITERIA.map((c) => `"${c.id}": N`).join(", ");
  return (
    "Ты строгий и беспристрастный судья дебатов. Оцени ОДИН обмен репликами. " +
    `Для каждого бойца выстави баллы 0–${MAX_PER_CRITERION} по критериям: ${list}. ` +
    "Выведи ТОЛЬКО JSON без пояснений в формате: " +
    `{"a": {${shape}}, "b": {${shape}}, "note": "<до 8 слов, дерзкий комментарий у ринга>"}.`
  );
}

// Системный промпт финального судьи.
export function finalJudgeSystem() {
  return (
    "Ты главный судья. Прочитай дебаты целиком и объяви победителя. " +
    'Выведи ТОЛЬКО JSON: {"winner": "A" или "B" или "draw", "score_a": 0-100, "score_b": 0-100, "rationale": "вердикт в 2 предложения"}.'
  );
}

// Сумма баллов бойца за раунд (0..40).
function total(scores) {
  return CRITERIA.reduce((sum, c) => sum + (Number(scores?.[c.id]) || 0), 0);
}

// Из баллов раунда считаем урон: чем слабее выступил боец, тем больше теряет HP.
export function roundDamage(judgement) {
  const max = maxRoundScore();
  const ta = total(judgement?.a);
  const tb = total(judgement?.b);
  return {
    totalA: ta,
    totalB: tb,
    damageToA: Math.round(((max - ta) / max) * MAX_ROUND_DAMAGE),
    damageToB: Math.round(((max - tb) / max) * MAX_ROUND_DAMAGE),
  };
}
