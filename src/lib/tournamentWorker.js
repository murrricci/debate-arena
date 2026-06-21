import {
  cloneTournament,
  markTournamentMatchesRunning,
  queuedMatchesToStart,
  recordTournamentMatchError,
  recordTournamentMatchResult,
  MAX_TOURNAMENT_CONCURRENCY,
} from "./tournamentCore.js";

export const DEFAULT_TOURNAMENT_MATCH_TIMEOUT_MS = 8 * 60 * 1000;

function sameState(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function runIdFor(match, startedAt) {
  return `${match.id}:${match.attempt || 1}:${startedAt}`;
}

function markStarted(t, matchIds, startedAt) {
  const ids = new Set(matchIds);
  const marked = markTournamentMatchesRunning(t, matchIds);
  return {
    ...marked,
    matches: marked.matches.map((m) =>
      ids.has(m.id) && m.status === "running" ? { ...m, startedAt, runId: runIdFor(m, startedAt) } : m
    ),
  };
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function recoverStaleMatches(t, { now = Date.now(), timeoutMs = DEFAULT_TOURNAMENT_MATCH_TIMEOUT_MS } = {}) {
  let next = cloneTournament(t);
  if (next.status !== "running") return next;
  for (const match of next.matches) {
    if (match.status !== "running") continue;
    const startedAt = Number(match.startedAt);
    const stale = !Number.isFinite(startedAt) || now - startedAt >= timeoutMs;
    if (!stale) continue;
    next = recordTournamentMatchError(next, {
      matchId: match.id,
      error: `Матч завис и был перезапущен backend worker после ${Math.round(timeoutMs / 1000)}с таймаута`,
    });
  }
  return next;
}

export function createTournamentWorker({
  now = Date.now,
  timeoutMs = DEFAULT_TOURNAMENT_MATCH_TIMEOUT_MS,
  concurrency = MAX_TOURNAMENT_CONCURRENCY,
  getTournament,
  saveTournament,
  getAgent,
  getTopic,
  runFight,
  saveBattle,
  onError = () => {},
} = {}) {
  if (!getTournament || !saveTournament || !getAgent || !getTopic || !runFight || !saveBattle) {
    throw new Error("createTournamentWorker: missing dependency");
  }

  let ticking = false;

  async function runMatch(match) {
    try {
      const A = getAgent(match.a);
      const B = getAgent(match.b);
      const topic = getTopic(match.topicId);
      if (!A || !B) throw new Error("Боец матча не найден");
      if (!topic) throw new Error("Тема матча не найдена");

      const result = await withTimeout(runFight({ A, B, topic, match }), timeoutMs, `Турнирный матч ${match.id}`);
      const saved = await saveBattle({ A, B, topic, result, match });
      const current = getTournament();
      const currentMatch = current.matches.find((m) => m.id === match.id);
      if (currentMatch?.status !== "running" || currentMatch?.runId !== match.runId) return;
      const next = recordTournamentMatchResult(current, {
        matchId: match.id,
        winner: result.winner,
        scoreA: result.scoreA,
        scoreB: result.scoreB,
        battleId: saved?.battleId ?? null,
      });
      saveTournament(next);
    } catch (e) {
      onError(e, match);
      const current = getTournament();
      const currentMatch = current.matches.find((m) => m.id === match.id);
      if (currentMatch?.status !== "running" || currentMatch?.runId !== match.runId) return;
      const next = recordTournamentMatchError(current, { matchId: match.id, error: e.message });
      saveTournament(next);
    }
  }

  async function tick() {
    if (ticking) return getTournament();
    ticking = true;
    try {
      const current = getTournament();
      const recovered = recoverStaleMatches(current, { now: now(), timeoutMs });
      if (!sameState(current, recovered)) saveTournament(recovered);

      const latest = getTournament();
      if (latest.status !== "running") return latest;

      const matches = queuedMatchesToStart(latest.matches, concurrency);
      if (!matches.length) return latest;

      const running = markStarted(latest, matches.map((m) => m.id), now());
      saveTournament(running);
      const runningById = Object.fromEntries(running.matches.map((m) => [m.id, m]));
      await Promise.all(matches.map((m) => runMatch(runningById[m.id] || m)));
      return getTournament();
    } finally {
      ticking = false;
    }
  }

  return { tick, recover: () => tick() };
}
