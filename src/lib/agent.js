// Сборка system-промпта бойца из его скиллов (карточки) + персоны + тонкой настройки + позиции.
import { SKILL_BY_ID } from "../data/skills.js";
import { getConfig, replyWords, focusInstruction } from "../data/agentConfig.js";

export function buildFighterSystem(participant, stance, topicTitle) {
  const cfg = getConfig(participant);
  const cards = (participant.skills || [])
    .map((id) => SKILL_BY_ID[id]?.prompt)
    .filter(Boolean);
  const words = replyWords(cfg);

  const parts = [
    `Тебя зовут «${participant.name}». Ты боец арены ИИ-дебатов на тему «${topicTitle}».`,
  ];

  if (cards.length) {
    parts.push("Твой стиль ведения спора:\n- " + cards.join("\n- "));
  }
  parts.push(focusInstruction(cfg));
  if (participant.custom) {
    parts.push("Особая установка от твоего создателя:\n" + participant.custom);
  }

  parts.push(
    `Твоя позиция, которую ты обязан отстаивать: «${stance}». Оппонент защищает противоположное. ` +
      "Отвечай строго по теме, не уходи в сторону.\n\n" +
      "ЖЁСТКИЕ ПРАВИЛА ОТВЕТА:\n" +
      `- НЕ БОЛЕЕ ${words} слов суммарно, 1–3 коротких предложения.\n` +
      "- Только на русском языке. Без английских слов и фраз (названия технологий можно).\n" +
      "- Без повторов, без вступлений вроде «Как боец я…», сразу аргумент.\n" +
      "- Не повторяй уже сказанное в прошлых репликах — каждый раз новый удар.\n" +
      "- Не используй разметку, эмодзи и кавычки-ёлочки. Только чистый текст реплики."
  );

  return parts.join("\n\n");
}

// Краткая «карточка» бойца для UI (эмодзи берём из первого скилла или дефолт).
export function fighterFace(participant) {
  const first = (participant.skills || [])[0];
  return SKILL_BY_ID[first]?.emoji || "🤖";
}

export function fighterColor(participant, fallback) {
  const first = (participant.skills || [])[0];
  return SKILL_BY_ID[first]?.color || fallback;
}
