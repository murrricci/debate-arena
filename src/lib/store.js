// Клиент участников и очков. Источник правды — серверная БД арены (db.js / server.js),
// но локально держим синхронный кэш: геттеры остаются синхронными (как раньше), мутации
// обновляют кэш ОПТИМИСТИЧНО и параллельно уходят на сервер. Так Arena/Register/Scoreboard
// и тесты не меняются, а данные переживают перезапуск и видны из бота.
//
// В Node (юнит-тесты) сети нет — модуль работает как чистый localStorage-кэш, как прежде.
import { publish, subscribe } from "./bus.js";
import { nextStats, sortLeaderboard, emptyStats, MAX_UPGRADES } from "./scoring.js";

export { MAX_UPGRADES };
export const MAX_WARMUP_BATTLES = 3;

const KEY = "debate-arena:participants";
const MIGRATED_KEY = "debate-arena:migrated";
const POLL_MS = 5000;
// Сеть только в браузере; в Node (тесты) — чистый локальный режим.
const inBrowser = typeof window !== "undefined" && typeof fetch === "function";

function readLS() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}

let cache = readLS();
const unconfirmed = new Set(); // id оптимистично созданных агентов, ещё не подтверждённых сервером
let pendingWrites = 0;         // мутаций «в полёте» — чтобы поллинг не затирал оптимистику

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* ignore */ }
  publish("participants", cache); // другое окно (табло) подхватит
}
function setCache(next) {
  cache = next;
  persist();
}
function replaceCache(next) {
  if (!Array.isArray(next)) return;
  cache = next;
}

// --- сетевой слой (только браузер) ---
async function send(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  try { return await res.json(); } catch { return null; }
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

// --- МУТАЦИИ (оптимистичный кэш + фоновая отправка на сервер) ---
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
  setCache([...cache, participant]);
  if (inBrowser) {
    unconfirmed.add(participant.id);
    track(send("POST", "/api/agents", {
      id: participant.id, name: participant.name, skills: participant.skills,
      custom: participant.custom, config: participant.config, source: "operator",
    }))
      .then((r) => { if (r?.agent) reconcile(r.agent); })
      .catch(() => {})
      .finally(() => unconfirmed.delete(participant.id));
  }
  return participant;
}

// Апгрейд: лимит проверяем по кэшу (он синхронизирован с сервером), сервер — авторитет.
// Возвращает обновлённого участника или null, если лимит исчерпан (как раньше).
export function upgradeParticipant(id, { name, skills, custom, config }) {
  const p = cache.find((x) => x.id === id);
  if (!p) return null;
  if ((p.upgrades || 0) >= MAX_UPGRADES) return null;
  const updated = {
    ...p,
    name: name?.trim() || p.name,
    skills: skills || p.skills,
    custom: (custom ?? p.custom ?? "").trim(),
    config: config || p.config,
    upgrades: (p.upgrades || 0) + 1,
  };
  setCache(cache.map((x) => (x.id === id ? updated : x)));
  if (inBrowser) {
    track(send("PATCH", `/api/agents/${id}`, {
      name: updated.name, skills: updated.skills, custom: updated.custom, config: updated.config,
    }))
      .then((r) => { if (r?.id) reconcile(r); })
      .catch(() => {});
  }
  return updated;
}

export function removeParticipant(id) {
  setCache(cache.filter((p) => p.id !== id));
  if (inBrowser) track(send("DELETE", `/api/agents/${id}`)).catch(() => {});
}

export function resetScoresFor(ids) {
  const set = new Set(ids);
  setCache(cache.map((p) => (set.has(p.id) ? { ...p, stats: emptyStats() } : p)));
  if (inBrowser) track(send("POST", "/api/results/reset", { ids })).then(afterReset).catch(() => {});
}

export function resetScores() {
  setCache(cache.map((p) => ({ ...p, stats: emptyStats() })));
  if (inBrowser) track(send("POST", "/api/results/reset", {})).then(afterReset).catch(() => {});
}
function afterReset(r) {
  if (r && Array.isArray(r.agents)) setCache(r.agents);
}

// Начисление очков по итогу боя. Оптимистично — той же формулой, что и сервер (scoring.js),
// затем сервер присылает авторитетные значения и мы их подставляем.
export function applyResult({ aId, bId, winner, scoreA, scoreB, topic = null, tournament = false, history = null, onSaved, onError }) {
  setCache(cache.map((p) => {
    if (p.id === aId) return { ...p, stats: nextStats(p.stats, "A", { winner, scoreA, scoreB }) };
    if (p.id === bId) return { ...p, stats: nextStats(p.stats, "B", { winner, scoreA, scoreB }) };
    return p;
  }));
  if (inBrowser) {
    track(send("POST", "/api/results", { aId, bId, winner, scoreA, scoreB, topic, tournament, history }))
      .then((r) => {
        if (r?.a) reconcile(r.a);
        if (r?.b) reconcile(r.b);
        if (typeof onSaved === "function") onSaved(r);
      })
      .catch((e) => {
        if (typeof onError === "function") onError(e);
      });
  }
  return cache;
}

// --- СИНХРОНИЗАЦИЯ С СЕРВЕРОМ (только браузер) ---
async function syncFromServer() {
  if (!inBrowser || pendingWrites > 0) return; // не затирать оптимистичные изменения «в полёте»
  try {
    const res = await fetch("/api/agents");
    if (!res.ok) return;
    const data = await res.json();
    if (!Array.isArray(data.agents)) return;
    let list = data.agents;
    if (unconfirmed.size) {
      const present = new Set(list.map((p) => p.id));
      const keep = cache.filter((p) => unconfirmed.has(p.id) && !present.has(p.id));
      list = [...list, ...keep];
    }
    setCache(list);
  } catch { /* сервер недоступен — продолжаем на кэше */ }
}

// Одноразовый перенос ранее созданных в localStorage участников на сервер.
async function migrateLocalToServer() {
  try {
    if (localStorage.getItem(MIGRATED_KEY)) return;
    for (const p of readLS()) {
      await send("POST", "/api/agents", {
        id: p.id, name: p.name, skills: p.skills, custom: p.custom, config: p.config,
        source: "operator", upgrades: p.upgrades || 0, createdAt: p.createdAt, stats: p.stats,
      }).catch(() => {});
    }
    localStorage.setItem(MIGRATED_KEY, "1");
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

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("storage", (event) => {
    if (!event.key || event.key === KEY) replaceCache(readLS());
  });
}
