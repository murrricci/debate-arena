// Чистая доменная логика очков и лимитов — без браузерных API и без БД.
// Один источник правды для формулы, который используют ОБА:
//   • сервер (db.js) — авторитетный пересчёт при приёме результата боя;
//   • клиентский кэш (store.js) — оптимистичное обновление до ответа сервера.
// Формула одна → оптимистичное значение совпадает с серверным, дрейфа нет.

export const MAX_UPGRADES = 3; // сколько раз агента можно отредактировать после создания
export const MAX_WARMUP_BATTLES = 3; // сколько раз агент может сыграть в разминке до турнира

export function emptyStats() {
  return { wins: 0, losses: 0, draws: 0, battles: 0, points: 0 };
}

// Бонус за уверенную победу: 0..5 доп. очков по разрыву счёта судьи.
export function winBonus(scoreA, scoreB) {
  return Math.round(Math.abs((scoreA || 0) - (scoreB || 0)) / 20);
}

// Новая статистика бойца после боя. role — на какой стороне он был ("A" | "B").
// Победа: +3 и бонус; ничья: +1; поражение: +0 (как в исходном store.js::applyResult).
export function nextStats(prev, role, { winner, scoreA, scoreB }) {
  const s = { ...emptyStats(), ...(prev || {}) };
  s.battles += 1;
  if (winner === "draw") {
    s.draws += 1;
    s.points += 1;
  } else if ((winner === "A" && role === "A") || (winner === "B" && role === "B")) {
    s.wins += 1;
    s.points += 3 + winBonus(scoreA, scoreB);
  } else {
    s.losses += 1;
  }
  return s;
}

// Сортировка таблицы: очки ↓, затем победы ↓, затем поражения ↑.
export function compareForLeaderboard(a, b) {
  return (
    b.stats.points - a.stats.points ||
    b.stats.wins - a.stats.wins ||
    a.stats.losses - b.stats.losses
  );
}

export function sortLeaderboard(list) {
  return [...list].sort(compareForLeaderboard);
}
