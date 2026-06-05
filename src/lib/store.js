// Хранилище участников и очков в localStorage + рассылка изменений в другие окна.
import { publish } from "./bus.js";

const KEY = "debate-arena:participants";

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || [];
  } catch {
    return [];
  }
}

function write(list) {
  localStorage.setItem(KEY, JSON.stringify(list));
  publish("participants", list); // другое окно (табло) подхватит
}

export const MAX_UPGRADES = 3; // сколько раз участник может прокачать персонажа

export function getParticipants() {
  return read();
}

export function getParticipant(id) {
  return read().find((p) => p.id === id) || null;
}

// Апгрейд персонажа: меняем параметры, увеличиваем счётчик использований.
// Возвращает обновлённого участника или null, если лимит исчерпан.
export function upgradeParticipant(id, { name, skills, custom, config }) {
  const list = read();
  const p = list.find((x) => x.id === id);
  if (!p) return null;
  if ((p.upgrades || 0) >= MAX_UPGRADES) return null;
  const next = list.map((x) =>
    x.id === id
      ? {
          ...x,
          name: name?.trim() || x.name,
          skills: skills || x.skills,
          custom: (custom ?? x.custom ?? "").trim(),
          config: config || x.config,
          upgrades: (x.upgrades || 0) + 1,
        }
      : x
  );
  write(next);
  return next.find((x) => x.id === id);
}

export function addParticipant({ name, skills, custom, config }) {
  const list = read();
  const participant = {
    id: crypto.randomUUID(),
    name: name.trim(),
    skills: skills || [],
    custom: (custom || "").trim(),
    config: config || {},
    upgrades: 0,
    createdAt: Date.now(),
    stats: { wins: 0, losses: 0, draws: 0, battles: 0, points: 0 },
  };
  write([...list, participant]);
  return participant;
}

// Обнулить статистику конкретных участников (перед стартом турнира).
export function resetScoresFor(ids) {
  const set = new Set(ids);
  write(read().map((p) => (set.has(p.id) ? { ...p, stats: { wins: 0, losses: 0, draws: 0, battles: 0, points: 0 } } : p)));
}

export function removeParticipant(id) {
  write(read().filter((p) => p.id !== id));
}

export function resetScores() {
  write(read().map((p) => ({ ...p, stats: { wins: 0, losses: 0, draws: 0, battles: 0, points: 0 } })));
}

// Начисление очков по итогу боя.
// Победа: +3 и бонус за разрыв счёта; ничья: +1 каждому; поражение: +0.
export function applyResult({ aId, bId, winner, scoreA, scoreB }) {
  const list = read();
  const margin = Math.abs((scoreA || 0) - (scoreB || 0));
  const bonus = Math.round(margin / 20); // 0..5 доп. очков за уверенную победу

  const next = list.map((p) => {
    if (p.id !== aId && p.id !== bId) return p;
    const s = { ...p.stats };
    s.battles += 1;
    if (winner === "draw") {
      s.draws += 1;
      s.points += 1;
    } else if ((winner === "A" && p.id === aId) || (winner === "B" && p.id === bId)) {
      s.wins += 1;
      s.points += 3 + bonus;
    } else {
      s.losses += 1;
    }
    return { ...p, stats: s };
  });
  write(next);
  return next;
}

export function leaderboard() {
  return [...read()].sort(
    (a, b) =>
      b.stats.points - a.stats.points ||
      b.stats.wins - a.stats.wins ||
      a.stats.losses - b.stats.losses
  );
}
