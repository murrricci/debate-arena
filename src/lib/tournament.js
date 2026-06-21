// Backend-backed tournament client. Browser pages render from the in-memory cache
// populated by /api/tournament. localStorage is read only for one-time legacy migration.
import { publish, subscribe } from "./bus.js";
import { getParticipants, leaderboard } from "./store.js";
import {
  DEFAULT_TOURNAMENT,
  TOP_N,
  MAX_TOURNAMENT_CONCURRENCY,
  cloneTournament,
  createTournamentFromLeaderboard,
  queuedMatchesToStart,
  visibleTournamentMatches,
  tournamentFightCounts,
  startTournament,
  recordTournamentMatchResult,
  tournamentStandings,
  selectTournamentRoster,
} from "./tournamentCore.js";

export {
  TOP_N,
  MAX_TOURNAMENT_CONCURRENCY,
  queuedMatchesToStart,
  visibleTournamentMatches,
  tournamentFightCounts,
  startTournament,
  recordTournamentMatchResult,
  tournamentStandings,
  selectTournamentRoster,
};

const TKEY = "debate-arena:tournament";
const MIGRATED_KEY = "debate-arena:tournament:migrated";
const POLL_MS = 5000;
const inBrowser = typeof window !== "undefined" && typeof fetch === "function";

let cache = cloneTournament(DEFAULT_TOURNAMENT);
let pendingWrites = 0;

function setCache(next, { broadcast = true } = {}) {
  cache = cloneTournament(next);
  if (broadcast) publish("tournament", cache);
  return cache;
}

function readLegacyTournament() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TKEY));
    return parsed && typeof parsed === "object" ? cloneTournament(parsed) : null;
  } catch {
    return null;
  }
}

function clearLegacyTournament() {
  try { localStorage.removeItem(TKEY); } catch { /* ignore */ }
}

function isDefaultTournament(t) {
  return t?.status === "idle" && !t?.closed && !(t?.roster || []).length && !(t?.matches || []).length;
}

async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

function track(promise) {
  pendingWrites++;
  return promise.finally(() => { pendingWrites--; });
}

function postTournament(url, body, fallback) {
  if (!inBrowser) return setCache(fallback);
  return track(request("POST", url, body)).then((next) => setCache(next));
}

async function syncFromServer() {
  if (!inBrowser || pendingWrites > 0) return;
  try {
    const res = await fetch("/api/tournament");
    if (!res.ok) return;
    const next = await res.json();
    setCache(next);
  } catch { /* keep last in-memory snapshot */ }
}

async function migrateLocalTournamentToServer() {
  try {
    if (localStorage.getItem(MIGRATED_KEY)) {
      clearLegacyTournament();
      return;
    }
    const legacy = readLegacyTournament();
    if (!legacy || isDefaultTournament(legacy)) {
      localStorage.setItem(MIGRATED_KEY, "1");
      clearLegacyTournament();
      return;
    }
    const current = await fetch("/api/tournament").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (current && isDefaultTournament(current)) {
      await request("POST", "/api/tournament/import", { tournament: legacy }).catch(() => {});
    }
    localStorage.setItem(MIGRATED_KEY, "1");
    clearLegacyTournament();
  } catch { /* ignore */ }
}

if (inBrowser) {
  (async () => {
    await migrateLocalTournamentToServer();
    await syncFromServer();
    setInterval(syncFromServer, POLL_MS);
  })();
}

subscribe((type, payload) => {
  if (type === "tournament" && payload && typeof payload === "object") setCache(payload, { broadcast: false });
});

export function getTournament() {
  return cloneTournament(cache);
}

export function isRegistrationClosed() {
  return getTournament().closed;
}

export function beginTournament() {
  const fallback = startTournament(getTournament());
  return postTournament("/api/tournament/start", {}, fallback);
}

export function closeAndStart(options = {}) {
  const fallback = createTournamentFromLeaderboard(leaderboard(), options);
  if (fallback.error || !inBrowser) {
    if (!fallback.error) setCache(fallback);
    return fallback;
  }
  return postTournament("/api/tournament/close", options, fallback);
}

export function closeRegistration() {
  const fallback = { ...getTournament(), closed: true };
  return postTournament("/api/tournament/import", { tournament: fallback }, fallback);
}

export function resetTournament() {
  return postTournament("/api/tournament/reset", {}, cloneTournament(DEFAULT_TOURNAMENT));
}

export function standings() {
  const t = getTournament();
  if (!t.roster.length) return [];
  return tournamentStandings(t, getParticipants());
}

export function progress() {
  return tournamentFightCounts(getTournament().matches);
}
