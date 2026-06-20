export function isTournamentMode(tour) {
  return !!tour && tour.status !== "idle";
}

export function scoreboardTitle(tour) {
  return isTournamentMode(tour) ? "ТУРНИРНАЯ ТАБЛИЦА" : "РЕЙТИНГ РАЗМИНКИ";
}

export function tournamentStateFromEvent(current, type, payload) {
  if (type !== "tournament") return current;
  return payload && typeof payload === "object" ? payload : current;
}
