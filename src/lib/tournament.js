// Турнир «как в футболе»: круговая система (каждый с каждым) среди топ-10.
// Состояние живёт в localStorage и рассылается в другие окна (табло) через шину.
import { publish } from "./bus.js";
import { getParticipants, leaderboard, resetScoresFor } from "./store.js";

const TKEY = "debate-arena:tournament";
export const TOP_N = 10;

const DEFAULT = {
  status: "idle", // idle → running → done
  closed: false, // приём заявок закрыт
  roster: [], // зафиксированные id участников (топ-10)
  matches: [], // [{ a, b, played, winner, scoreA, scoreB }]
  cursor: 0, // индекс текущего матча
};

export function getTournament() {
  try {
    return { ...DEFAULT, ...(JSON.parse(localStorage.getItem(TKEY)) || {}) };
  } catch {
    return { ...DEFAULT };
  }
}

function save(t) {
  localStorage.setItem(TKEY, JSON.stringify(t));
  publish("tournament", t);
  return t;
}

export function isRegistrationClosed() {
  return getTournament().closed;
}

// Круговое расписание (метод многоугольника). Возвращает список пар id.
function roundRobin(ids) {
  const arr = [...ids];
  if (arr.length % 2) arr.push(null); // болван для нечётного числа
  const n = arr.length;
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a && b) rounds.push({ a, b, played: false, winner: null, scoreA: 0, scoreB: 0 });
    }
    // ротация (первый зафиксирован)
    arr.splice(1, 0, arr.pop());
  }
  return rounds;
}

// Закрыть приём заявок + сформировать турнир из топ-N по очкам разминки.
export function closeAndStart() {
  const top = leaderboard().slice(0, TOP_N);
  if (top.length < 2) return { error: "Нужно минимум 2 участника для турнира." };

  const roster = top.map((p) => p.id);
  resetScoresFor(roster); // турнир считаем с чистого листа

  return save({
    status: "running",
    closed: true,
    roster,
    matches: roundRobin(roster),
    cursor: 0,
  });
}

// Только закрыть приём (без старта) — на случай, если ведущий хочет паузу.
export function closeRegistration() {
  return save({ ...getTournament(), closed: true });
}

export function currentMatch() {
  const t = getTournament();
  if (t.status !== "running") return null;
  return t.matches[t.cursor] || null;
}

// Записать результат текущего матча и сдвинуть курсор.
export function recordMatchResult({ winner, scoreA, scoreB }) {
  const t = getTournament();
  if (t.status !== "running") return t;
  const matches = t.matches.map((m, i) =>
    i === t.cursor ? { ...m, played: true, winner, scoreA, scoreB } : m
  );
  const cursor = t.cursor + 1;
  const status = cursor >= matches.length ? "done" : "running";
  return save({ ...t, matches, cursor, status });
}

// Полный сброс турнира (вернуться к свободной регистрации).
export function resetTournament() {
  return save({ ...DEFAULT });
}

// Турнирная таблица: только участники ростера, отсортированные по очкам.
export function standings() {
  const t = getTournament();
  if (!t.roster.length) return [];
  const byId = Object.fromEntries(getParticipants().map((p) => [p.id, p]));
  return t.roster
    .map((id) => byId[id])
    .filter(Boolean)
    .sort(
      (a, b) =>
        b.stats.points - a.stats.points ||
        b.stats.wins - a.stats.wins ||
        a.stats.losses - b.stats.losses
    );
}

export function progress() {
  const t = getTournament();
  const played = t.matches.filter((m) => m.played).length;
  return { played, total: t.matches.length };
}
