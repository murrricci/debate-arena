import { emptyStats, nextStats } from "./scoring.js";
import { randomTopic } from "../data/topics.js";

export const TOP_N = 10;
export const MAX_TOURNAMENT_CONCURRENCY = 9;

export const DEFAULT_TOURNAMENT = {
  status: "idle",
  closed: false,
  roster: [],
  matches: [],
  statsById: {},
  cursor: 0,
};

export function cloneTournament(t = DEFAULT_TOURNAMENT) {
  return {
    ...DEFAULT_TOURNAMENT,
    ...(t || {}),
    roster: Array.isArray(t?.roster) ? [...t.roster] : [],
    matches: Array.isArray(t?.matches) ? t.matches.map((m) => ({ ...m })) : [],
    statsById: t?.statsById && typeof t.statsById === "object" ? JSON.parse(JSON.stringify(t.statsById)) : {},
    cursor: Number.isInteger(t?.cursor) ? t.cursor : 0,
  };
}

export function makeMatch({ index, a, b, stage = "main", tiebreakRound = null, topicId = null }) {
  return {
    id: `m-${index}`,
    index,
    a,
    b,
    topicId: topicId || randomTopic().id,
    stage,
    tiebreakRound,
    status: "queued",
    played: false,
    winner: null,
    scoreA: 0,
    scoreB: 0,
    battleId: null,
    error: "",
    retryOf: null,
    attempt: 1,
    supersededBy: null,
  };
}

export function roundRobin(ids, { startIndex = 1, stage = "main", tiebreakRound = null } = {}) {
  const arr = [...ids];
  if (arr.length % 2) arr.push(null);
  const n = arr.length;
  const rounds = [];
  let nextIndex = startIndex;
  for (let r = 0; r < n - 1; r++) {
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a && b) rounds.push(makeMatch({ index: nextIndex++, a, b, stage, tiebreakRound }));
    }
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

export function createTournamentFromLeaderboard(people = [], options = {}) {
  const roster = selectTournamentRoster(people, options);
  if (roster.length < 2) return { error: "Нужно минимум 2 участника с хотя бы одним боем для турнира." };
  return {
    status: "ready",
    closed: true,
    roster,
    matches: roundRobin(roster),
    statsById: initialStatsById(roster),
    cursor: 0,
  };
}

export function queuedMatchesToStart(matches = [], limit = MAX_TOURNAMENT_CONCURRENCY) {
  const active = matches.filter((m) => m.status === "running").length;
  const slots = Math.max(0, limit - active);
  return matches.filter((m) => m.status === "queued").slice(0, slots);
}

export function visibleTournamentMatches(matches = []) {
  return matches.filter((m) => m.status === "running");
}

function isSupersededError(match) {
  return match.status === "error" && Boolean(match.supersededBy);
}

function isResolvedMatch(match) {
  return match.status === "done" || isSupersededError(match);
}

export function tournamentFightCounts(matches = []) {
  const current = matches.filter((m) => !isSupersededError(m));
  const played = current.filter((m) => m.status === "done").length;
  const remaining = current.length - played;
  return { played, remaining, total: current.length };
}

export function startTournament(t = DEFAULT_TOURNAMENT) {
  return t.status === "ready" ? { ...cloneTournament(t), status: "running" } : cloneTournament(t);
}

export function markTournamentMatchesRunning(t, matchIds = []) {
  const ids = new Set(matchIds);
  const current = cloneTournament(t);
  return {
    ...current,
    matches: current.matches.map((m) =>
      ids.has(m.id) && m.status === "queued" ? { ...m, status: "running", error: "" } : m
    ),
  };
}

export function initialStatsById(roster) {
  return Object.fromEntries((roster || []).map((id) => [id, emptyStats()]));
}

function maxMatchIndex(matches = []) {
  return matches.reduce((max, m) => Math.max(max, m.index || 0), 0);
}

function nextTiebreakRound(matches = []) {
  return matches.reduce((max, m) => Math.max(max, m.tiebreakRound || 0), 0) + 1;
}

function leadersByPoints(roster = [], statsById = {}) {
  if (!roster.length) return [];
  let maxPoints = -Infinity;
  for (const id of roster) {
    const points = statsById[id]?.points || 0;
    if (points > maxPoints) maxPoints = points;
  }
  return roster.filter((id) => (statsById[id]?.points || 0) === maxPoints);
}

export function recordTournamentMatchError(t, { matchId, error }) {
  const current = cloneTournament(t);
  const match = current.matches.find((m) => m.id === matchId);
  if (!match) return current;
  if (match.status === "error" && match.supersededBy) return current;
  const retry = {
    ...makeMatch({
      index: maxMatchIndex(current.matches) + 1,
      a: match.a,
      b: match.b,
      stage: match.stage || "main",
      tiebreakRound: match.tiebreakRound ?? null,
      topicId: match.topicId,
    }),
    retryOf: match.retryOf || match.id,
    attempt: (match.attempt || 1) + 1,
  };
  const matches = [
    ...current.matches.map((m) =>
      m.id === matchId
        ? { ...m, status: "error", error: String(error || "Ошибка боя"), supersededBy: retry.id }
        : m
    ),
    retry,
  ];
  const cursor = matches.findIndex((m) => !isResolvedMatch(m));
  return {
    ...current,
    matches,
    cursor: cursor === -1 ? matches.length : cursor,
  };
}

export function recordTournamentMatchResult(t, { matchId, winner, scoreA = 0, scoreB = 0, battleId = null }) {
  const current = cloneTournament(t);
  const match = current.matches.find((m) => m.id === matchId);
  if (!match) return current;
  const statsById = { ...initialStatsById(current.roster), ...(current.statsById || {}) };
  statsById[match.a] = nextStats(statsById[match.a], "A", { winner, scoreA, scoreB });
  statsById[match.b] = nextStats(statsById[match.b], "B", { winner, scoreA, scoreB });
  const matches = current.matches.map((m) =>
    m.id === matchId ? { ...m, status: "done", played: true, winner, scoreA, scoreB, battleId, error: "" } : m
  );
  let nextMatches = matches;
  let status = current.status === "idle" ? "ready" : current.status;
  if (matches.every(isResolvedMatch)) {
    const leaders = leadersByPoints(current.roster, statsById);
    if (leaders.length > 1) {
      const tiebreakRound = nextTiebreakRound(matches);
      const extra = roundRobin(leaders, {
        startIndex: maxMatchIndex(matches) + 1,
        stage: "tiebreak",
        tiebreakRound,
      });
      nextMatches = [...matches, ...extra];
      status = "running";
    } else {
      status = "done";
    }
  }
  const cursor = nextMatches.findIndex((m) => !isResolvedMatch(m));
  return { ...current, matches: nextMatches, statsById, status, cursor: cursor === -1 ? nextMatches.length : cursor };
}

export function tournamentStandings(t, people = []) {
  const current = cloneTournament(t);
  const byId = Object.fromEntries(people.map((p) => [p.id, p]));
  const statsById = { ...initialStatsById(current.roster || []), ...(current.statsById || {}) };
  return [...(current.roster || [])]
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
