// Турнир «как в футболе»: круговая система (каждый с каждым) среди топ-10.
// Состояние живёт в localStorage и рассылается в другие окна (табло) через шину.
import { publish } from "./bus.js";
import { getParticipants, leaderboard } from "./store.js";
import { emptyStats, nextStats } from "./scoring.js";
import { TOPICS, randomTopic } from "../data/topics.js";

const TKEY = "debate-arena:tournament";
export const TOP_N = 10;
export const MAX_TOURNAMENT_CONCURRENCY = 9;

const DEFAULT = {
  status: "idle", // idle → ready → running → done
  closed: false, // приём заявок закрыт
  roster: [], // зафиксированные id участников (топ-10)
  matches: [], // [{ id, index, a, b, topicId, status, winner, scoreA, scoreB }]
  statsById: {}, // отдельная турнирная статистика по id участника
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
      if (a && b) {
        const index = rounds.length + 1;
        rounds.push({
          id: `m-${index}`,
          index,
          a,
          b,
          topicId: randomTopic().id,
          status: "queued",
          played: false,
          winner: null,
          scoreA: 0,
          scoreB: 0,
          battleId: null,
          error: "",
        });
      }
    }
    // ротация (первый зафиксирован)
    arr.splice(1, 0, arr.pop());
  }
  return rounds;
}

function statsFor(p) {
  return { ...emptyStats(), ...(p?.stats || {}) };
}

function shuffle(list, random = Math.random) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function selectTournamentRoster(people = [], { random = Math.random } = {}) {
  const candidates = people
    .filter((p) => statsFor(p).battles >= 1)
    .sort((a, b) => statsFor(b).points - statsFor(a).points);
  if (candidates.length <= TOP_N) return candidates.map((p) => p.id);

  const boundaryPoints = statsFor(candidates[TOP_N - 1]).points;
  const guaranteed = candidates.filter((p) => statsFor(p).points > boundaryPoints);
  const tied = candidates.filter((p) => statsFor(p).points === boundaryPoints);
  return [
    ...guaranteed.map((p) => p.id),
    ...shuffle(tied, random).slice(0, TOP_N - guaranteed.length).map((p) => p.id),
  ];
}

export function queuedMatchesToStart(matches = [], limit = MAX_TOURNAMENT_CONCURRENCY) {
  const active = matches.filter((m) => m.status === "running").length;
  const slots = Math.max(0, limit - active);
  return matches.filter((m) => m.status === "queued").slice(0, slots);
}

export function startTournament(t = getTournament()) {
  return t.status === "ready" ? { ...t, status: "running" } : t;
}

export function markTournamentMatchesRunning(t, matchIds = []) {
  const ids = new Set(matchIds);
  return {
    ...t,
    matches: t.matches.map((m) =>
      ids.has(m.id) && m.status === "queued" ? { ...m, status: "running", error: "" } : m
    ),
  };
}

export function recordTournamentMatchError(t, { matchId, error }) {
  return {
    ...t,
    matches: t.matches.map((m) =>
      m.id === matchId ? { ...m, status: "error", error: String(error || "Ошибка боя") } : m
    ),
  };
}

export function beginTournament() {
  return save(startTournament());
}

export function markMatchesRunning(matchIds = []) {
  return save(markTournamentMatchesRunning(getTournament(), matchIds));
}

export function recordMatchError({ matchId, error }) {
  return save(recordTournamentMatchError(getTournament(), { matchId, error }));
}

function initialStatsById(roster) {
  return Object.fromEntries(roster.map((id) => [id, emptyStats()]));
}

export function recordTournamentMatchResult(t, { matchId, winner, scoreA = 0, scoreB = 0, battleId = null }) {
  const match = t.matches.find((m) => m.id === matchId);
  if (!match) return t;
  const statsById = { ...initialStatsById(t.roster), ...(t.statsById || {}) };
  statsById[match.a] = nextStats(statsById[match.a], "A", { winner, scoreA, scoreB });
  statsById[match.b] = nextStats(statsById[match.b], "B", { winner, scoreA, scoreB });
  const matches = t.matches.map((m) =>
    m.id === matchId ? { ...m, status: "done", played: true, winner, scoreA, scoreB, battleId, error: "" } : m
  );
  const status = matches.every((m) => m.status === "done") ? "done" : t.status === "idle" ? "ready" : t.status;
  const cursor = matches.findIndex((m) => m.status !== "done" && m.status !== "error");
  return { ...t, matches, statsById, status, cursor: cursor === -1 ? matches.length : cursor };
}

export function tournamentStandings(t, people = getParticipants()) {
  const byId = Object.fromEntries(people.map((p) => [p.id, p]));
  const statsById = { ...initialStatsById(t.roster || []), ...(t.statsById || {}) };
  return [...(t.roster || [])]
    .map((id) => {
      const p = byId[id];
      return p ? { ...p, tourStats: { ...emptyStats(), ...(statsById[id] || {}) } } : null;
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        b.tourStats.points - a.tourStats.points ||
        b.tourStats.wins - a.tourStats.wins ||
        a.tourStats.losses - b.tourStats.losses
    );
}

// Закрыть приём заявок + сформировать турнир из топ-N по очкам разминки.
export function closeAndStart(options = {}) {
  const roster = selectTournamentRoster(leaderboard(), options);
  if (roster.length < 2) return { error: "Нужно минимум 2 участника с хотя бы одним боем для турнира." };

  const matches = roundRobin(roster);

  return save({
    status: "ready",
    closed: true,
    roster,
    matches,
    statsById: initialStatsById(roster),
    cursor: 0,
  });
}

// Только закрыть приём (без старта) — на случай, если ведущий хочет паузу.
export function closeRegistration() {
  return save({ ...getTournament(), closed: true });
}

export function currentMatch() {
  const t = getTournament();
  if (!["ready", "running"].includes(t.status)) return null;
  return t.matches.find((m) => m.status === "queued" || m.status === "running") || null;
}

// Записать результат текущего матча и сдвинуть курсор.
export function recordMatchResult({ matchId, winner, scoreA, scoreB, battleId = null }) {
  const t = getTournament();
  if (!["ready", "running"].includes(t.status)) return t;
  const match = matchId ? t.matches.find((m) => m.id === matchId) : currentMatch();
  if (!match) return t;
  return save(recordTournamentMatchResult(t, { matchId: match.id, winner, scoreA, scoreB, battleId }));
}

// Полный сброс турнира (вернуться к свободной регистрации).
export function resetTournament() {
  return save({ ...DEFAULT });
}

// Турнирная таблица: только участники ростера, отсортированные по очкам.
export function standings() {
  const t = getTournament();
  if (!t.roster.length) return [];
  return tournamentStandings(t);
}

export function progress() {
  const t = getTournament();
  const played = t.matches.filter((m) => m.status === "done").length;
  return { played, total: t.matches.length };
}
