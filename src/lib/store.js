// Клиент участников и очков. Источник правды — серверная БД арены (db.js / server.js).
// Фронт держит только синхронный in-memory cache, чтобы существующие геттеры оставались
// простыми для страниц. localStorage не участвует в отображении: он читается только
// одноразово для миграции старых данных в backend.
import { publish, subscribe } from "./bus.js";
import { nextStats, sortLeaderboard, emptyStats, MAX_UPGRADES, MAX_WARMUP_BATTLES } from "./scoring.js";

export { MAX_UPGRADES, MAX_WARMUP_BATTLES };

const KEY = "debate-arena:participants";
const MIGRATED_KEY = "debate-arena:migrated";
const POLL_MS = 5000;
// Сеть только в браузере; в Node (юнит-тесты) — чистый in-memory режим.
const inBrowser = typeof window !== "undefined" && typeof fetch === "function";

function readLegacyLS() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}

function clearLegacyLS() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

let cache = [];
let pendingWrites = 0;         // мутаций «в полёте» — чтобы поллинг не затирал серверный ответ

function notify() {
  publish("participants", cache); // другое окно (табло) подхватит
}
function setCache(next) {
  cache = next;
  notify();
}
function replaceCache(next) {
  if (!Array.isArray(next)) return;
  cache = next;
}

// --- сетевой слой (только браузер) ---
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
// Заменить/добавить одного агента из авторитетного серверного ответа.
function reconcile(agent) {
  if (!agent || !agent.id) return;
  const idx = cache.findIndex((p) => p.id === agent.id);
  if (idx >= 0) setCache(cache.map((p) => (p.id === agent.id ? agent : p)));
  else setCache([...cache, agent]);
}

// --- ГЕТТЕРЫ (синхронные, читают кэш) ---
export function getParticipants() {
  return cache;
}
export function getParticipant(id) {
  return cache.find((p) => p.id === id) || null;
}
export function leaderboard() {
  return sortLeaderboard(cache);
}
export function canPlayWarmup(participant) {
  return !!participant && (participant.stats?.battles || 0) < MAX_WARMUP_BATTLES;
}

// --- МУТАЦИИ ---
export function addParticipant({ name, skills, custom, config }) {
  const participant = {
    id: crypto.randomUUID(),
    name: (name || "").trim(),
    skills: skills || [],
    custom: (custom || "").trim(),
    config: config || {},
    upgrades: 0,
    createdAt: Date.now(),
    stats: emptyStats(),
  };
  if (!inBrowser) {
    setCache([...cache, participant]);
    return participant;
  }
  return track(request("POST", "/api/agents", {
    id: participant.id, name: participant.name, skills: participant.skills,
    custom: participant.custom, config: participant.config, source: "operator",
  }))
    .then((r) => {
      const agent = r?.agent || r;
      reconcile(agent);
      return agent;
    });
}

function upgradeParticipantLocally(id, { name, skills, custom, config }) {
  const p = cache.find((x) => x.id === id);
  if (!p) return null;
  if ((p.upgrades || 0) >= MAX_UPGRADES) return null;
  return {
    ...p,
    name: name?.trim() || p.name,
    skills: skills || p.skills,
    custom: (custom ?? p.custom ?? "").trim(),
    config: config || p.config,
    upgrades: (p.upgrades || 0) + 1,
  };
}

export function upgradeParticipant(id, { name, skills, custom, config }) {
  const updated = upgradeParticipantLocally(id, { name, skills, custom, config });
  if (!updated) return null;
  if (!inBrowser) {
    setCache(cache.map((x) => (x.id === id ? updated : x)));
    return updated;
  }
  return track(request("PATCH", `/api/agents/${id}`, {
    name: updated.name, skills: updated.skills, custom: updated.custom, config: updated.config,
  }))
    .then((r) => {
      const agent = r?.agent || r;
      reconcile(agent);
      return agent;
    });
}

export function removeParticipant(id) {
  if (!inBrowser) {
    setCache(cache.filter((p) => p.id !== id));
    return { ok: true };
  }
  return track(request("DELETE", `/api/agents/${id}`)).then((r) => {
    setCache(cache.filter((p) => p.id !== id));
    return r;
  });
}

export function resetScoresFor(ids) {
  if (!inBrowser) {
    const set = new Set(ids);
    setCache(cache.map((p) => (set.has(p.id) ? { ...p, stats: emptyStats() } : p)));
    return cache;
  }
  return track(request("POST", "/api/results/reset", { ids })).then((r) => {
    afterReset(r);
    return cache;
  });
}

export function resetScores() {
  if (!inBrowser) {
    setCache(cache.map((p) => ({ ...p, stats: emptyStats() })));
    return cache;
  }
  return track(request("POST", "/api/results/reset", {})).then((r) => {
    afterReset(r);
    return cache;
  });
}

function afterReset(r) {
  if (r && Array.isArray(r.agents)) setCache(r.agents);
}

function applyResultLocally({ aId, bId, winner, scoreA, scoreB }) {
  setCache(cache.map((p) => {
    if (p.id === aId) return { ...p, stats: nextStats(p.stats, "A", { winner, scoreA, scoreB }) };
    if (p.id === bId) return { ...p, stats: nextStats(p.stats, "B", { winner, scoreA, scoreB }) };
    return p;
  }));
  return cache;
}

// Начисление очков по итогу боя. В браузере авторитетно обновляется только по ответу сервера.
export function applyResult({ aId, bId, winner, scoreA, scoreB, topic = null, tournament = false, history = null, onSaved, onError }) {
  if (!inBrowser) return applyResultLocally({ aId, bId, winner, scoreA, scoreB });
  return track(request("POST", "/api/results", { aId, bId, winner, scoreA, scoreB, topic, tournament, history }))
    .then((r) => {
      if (r?.a) reconcile(r.a);
      if (r?.b) reconcile(r.b);
      if (typeof onSaved === "function") onSaved(r);
      return cache;
    })
    .catch((e) => {
      if (typeof onError === "function") onError(e);
      return cache;
    });
}

// --- СИНХРОНИЗАЦИЯ С СЕРВЕРОМ (только браузер) ---
async function syncFromServer() {
  if (!inBrowser || pendingWrites > 0) return;
  try {
    const res = await fetch("/api/agents");
    if (!res.ok) return;
    const data = await res.json();
    if (!Array.isArray(data.agents)) return;
    setCache(data.agents);
  } catch { /* сервер недоступен — продолжаем на кэше */ }
}

// Одноразовый перенос ранее созданных в localStorage участников на сервер.
async function migrateLocalToServer() {
  try {
    if (localStorage.getItem(MIGRATED_KEY)) {
      clearLegacyLS();
      return;
    }
    const legacy = readLegacyLS();
    if (!legacy.length) {
      localStorage.setItem(MIGRATED_KEY, "1");
      clearLegacyLS();
      return;
    }
    const current = await fetch("/api/agents").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (Array.isArray(current?.agents) && current.agents.length > 0) {
      localStorage.setItem(MIGRATED_KEY, "1");
      clearLegacyLS();
      return;
    }
    for (const p of legacy) {
      await request("POST", "/api/agents", {
        id: p.id, name: p.name, skills: p.skills, custom: p.custom, config: p.config,
        source: "operator", upgrades: p.upgrades || 0, createdAt: p.createdAt, stats: p.stats,
      }).catch(() => {});
    }
    localStorage.setItem(MIGRATED_KEY, "1");
    clearLegacyLS();
  } catch { /* ignore */ }
}

if (inBrowser) {
  (async () => {
    await migrateLocalToServer();
    await syncFromServer();
    setInterval(syncFromServer, POLL_MS);
  })();
}

subscribe((type, payload) => {
  if (type === "participants") replaceCache(payload);
});
