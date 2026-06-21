// Серверное хранилище агентов и результатов боёв (источник правды для всей арены).
// На встроенном node:sqlite (Node ≥ 22) — без нативных зависимостей. Все запросы
// синхронны: в одном Express-процессе read-modify-write атомарен, гонок нет.
//
// Форма агента в ответах ПОЛНОСТЬЮ совпадает с прежним participant из localStorage
// ({id,name,skills,custom,config,upgrades,createdAt,stats}) — фронт переписывать не нужно.
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";

import { nextStats, emptyStats, sortLeaderboard, MAX_UPGRADES, MAX_WARMUP_BATTLES } from "./src/lib/scoring.js";
import { DEFAULT_TOURNAMENT, cloneTournament } from "./src/lib/tournamentCore.js";
import { SKILL_CARDS } from "./src/data/skills.js";
import {
  DEFAULT_CONFIG,
  MEMORY_OPTIONS,
  REPLY_LEN_OPTIONS,
  FOCUS_OPTIONS,
  JUDGE_OPTIONS,
  TEMPERATURE_MIN,
  TEMPERATURE_MAX,
} from "./src/data/agentConfig.js";

export { MAX_UPGRADES, MAX_WARMUP_BATTLES };

const SKILL_IDS = new Set(SKILL_CARDS.map((s) => s.id));
const MEMORY_IDS = new Set(MEMORY_OPTIONS.map((o) => o.id));
const REPLY_IDS = new Set(REPLY_LEN_OPTIONS.map((o) => o.id));
const FOCUS_IDS = new Set(FOCUS_OPTIONS.map((o) => o.id));
const JUDGE_IDS = new Set(JUDGE_OPTIONS.map((o) => o.id));

const __dirname = dirname(fileURLToPath(import.meta.url));

let db = null;

function resolveFile(filename) {
  const f = filename ?? process.env.ARENA_DB_FILE ?? "data/arena.db";
  if (f === ":memory:") return ":memory:";
  const p = isAbsolute(f) ? f : join(__dirname, f);
  try { mkdirSync(dirname(p), { recursive: true }); } catch { /* ignore */ }
  return p;
}

export function initDb(filename) {
  db = new DatabaseSync(resolveFile(filename));
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id          TEXT PRIMARY KEY,
      external_id TEXT,
      name        TEXT NOT NULL,
      skills      TEXT NOT NULL DEFAULT '[]',
      custom      TEXT NOT NULL DEFAULT '',
      config      TEXT NOT NULL DEFAULT '{}',
      upgrades    INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL,
      wins        INTEGER NOT NULL DEFAULT 0,
      losses      INTEGER NOT NULL DEFAULT 0,
      draws       INTEGER NOT NULL DEFAULT 0,
      battles     INTEGER NOT NULL DEFAULT 0,
      points      INTEGER NOT NULL DEFAULT 0,
      source      TEXT NOT NULL DEFAULT 'operator'
    );
  `);
  // Один внешний пользователь = один агент. Операторские агенты (external_id IS NULL)
  // под ограничение не попадают — частичный уникальный индекс допускает много NULL.
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_external ON agents(external_id) WHERE external_id IS NOT NULL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS battles (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      a_id       TEXT NOT NULL,
      b_id       TEXT NOT NULL,
      winner     TEXT NOT NULL,
      score_a    INTEGER NOT NULL DEFAULT 0,
      score_b    INTEGER NOT NULL DEFAULT 0,
      topic      TEXT,
      tournament INTEGER NOT NULL DEFAULT 0,
      history    TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  ensureBattleColumns();
  db.exec("CREATE INDEX IF NOT EXISTS idx_battles_a ON battles(a_id);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_battles_b ON battles(b_id);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_battles_created ON battles(created_at);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_battles_tournament ON battles(tournament);");
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_state (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  return db;
}

function ensureBattleColumns() {
  const columns = new Set(db.prepare("PRAGMA table_info(battles)").all().map((row) => row.name));
  if (!columns.has("history")) {
    db.exec("ALTER TABLE battles ADD COLUMN history TEXT;");
  }
}

// --- транзакция (node:sqlite без better-sqlite3-хелпера .transaction) ---
function inTx(fn) {
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* ignore */ }
    throw e;
  }
}

const safeParse = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };
const deepClone = (value) => JSON.parse(JSON.stringify(value));

function rowToParticipant(row) {
  if (!row) return null;
  return {
    id: row.id,
    externalId: row.external_id ?? null,
    name: row.name,
    skills: safeParse(row.skills, []),
    custom: row.custom || "",
    config: safeParse(row.config, {}),
    upgrades: row.upgrades,
    createdAt: row.created_at,
    source: row.source,
    stats: { wins: row.wins, losses: row.losses, draws: row.draws, battles: row.battles, points: row.points },
  };
}

function rowToBattle(row, { includeHistory = false } = {}) {
  if (!row) return null;
  const history = includeHistory ? safeParse(row.history, null) : undefined;
  return {
    id: row.id,
    aId: row.a_id,
    bId: row.b_id,
    aName: row.a_name || row.history_a_name || "?",
    bName: row.b_name || row.history_b_name || "?",
    aExternalId: row.a_external_id ?? row.history_a_external_id ?? null,
    bExternalId: row.b_external_id ?? row.history_b_external_id ?? null,
    winner: row.winner,
    scoreA: row.score_a,
    scoreB: row.score_b,
    topic: row.topic,
    tournament: !!row.tournament,
    at: row.created_at,
    hasHistory: !!row.history,
    ...(includeHistory ? { history } : {}),
  };
}

function historyNames(history) {
  return {
    history_a_name: history?.fighters?.A?.name || null,
    history_b_name: history?.fighters?.B?.name || null,
    history_a_external_id: history?.fighters?.A?.externalId ?? null,
    history_b_external_id: history?.fighters?.B?.externalId ?? null,
  };
}

// --- валидация/нормализация входных данных (защита от мусора из бота) ---
const clampNum = (v, lo, hi, def) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(hi, Math.max(lo, n));
};
const clampInt = (v, lo, hi, def) => Math.round(clampNum(v, lo, hi, def));

function serializeHistory(history) {
  if (history == null) return null;
  return JSON.stringify(history);
}

function normalizeConfig(cfg = {}) {
  const c = { ...DEFAULT_CONFIG, ...(cfg || {}) };
  return {
    memory: MEMORY_IDS.has(c.memory) ? c.memory : DEFAULT_CONFIG.memory,
    windowSize: clampInt(c.windowSize, 2, 6, DEFAULT_CONFIG.windowSize),
    temperature: clampNum(c.temperature, TEMPERATURE_MIN, TEMPERATURE_MAX, DEFAULT_CONFIG.temperature),
    replyLen: REPLY_IDS.has(c.replyLen) ? c.replyLen : DEFAULT_CONFIG.replyLen,
    focus: FOCUS_IDS.has(c.focus) ? c.focus : DEFAULT_CONFIG.focus,
    useJudge: JUDGE_IDS.has(c.useJudge) ? c.useJudge : DEFAULT_CONFIG.useJudge,
  };
}

// partial:true — для PATCH (валидируем только присланные поля).
export function normalizeAgentInput(input = {}, { partial = false } = {}) {
  const out = {};
  const errors = [];
  if (!partial || input.name !== undefined) {
    const name = String(input.name ?? "").trim();
    if (name.length < 1 || name.length > 40) errors.push("name (1–40 символов)");
    out.name = name.slice(0, 40);
  }
  if (!partial || input.skills !== undefined) {
    const skills = Array.isArray(input.skills) ? [...new Set(input.skills.filter((s) => SKILL_IDS.has(s)))] : [];
    if (skills.length < 1) errors.push("skills (минимум 1 известный)");
    out.skills = skills;
  }
  if (!partial || input.custom !== undefined) {
    out.custom = String(input.custom ?? "").slice(0, 800);
  }
  if (!partial || input.config !== undefined) {
    out.config = normalizeConfig(input.config);
  }
  return errors.length ? { error: errors.join("; ") } : { value: out };
}

// --- чтение ---
export function listAgents() {
  return db.prepare("SELECT * FROM agents").all().map(rowToParticipant);
}
export function getAgentById(id) {
  return rowToParticipant(db.prepare("SELECT * FROM agents WHERE id = ?").get(id));
}
export function getAgentByExternalId(externalId) {
  return rowToParticipant(db.prepare("SELECT * FROM agents WHERE external_id = ?").get(String(externalId)));
}
function findRow(by) {
  if (by.id) return db.prepare("SELECT * FROM agents WHERE id = ?").get(by.id);
  if (by.externalId != null) return db.prepare("SELECT * FROM agents WHERE external_id = ?").get(String(by.externalId));
  return undefined;
}

// --- создание ---
// Принимает необязательный id/upgrades/createdAt/stats — используется при миграции
// существующих localStorage-участников (UPSERT по уже существующему id).
export function createAgent(input = {}) {
  const norm = normalizeAgentInput(input);
  if (norm.error) return { error: "validation", detail: norm.error };
  const { name, skills, custom, config } = norm.value;
  const externalId = input.externalId != null && input.externalId !== "" ? String(input.externalId) : null;
  const source = input.source === "bot" ? "bot" : "operator";

  if (externalId) {
    const existing = getAgentByExternalId(externalId);
    if (existing) return { error: "agent_exists", agent: existing };
  }
  const id = typeof input.id === "string" && input.id ? input.id : randomUUID();
  const existingById = getAgentById(id);
  if (existingById) return { error: "agent_exists", agent: existingById };

  const createdAt = Number.isFinite(input.createdAt) ? Math.floor(input.createdAt) : Date.now();
  const upgrades = Number.isInteger(input.upgrades) ? Math.max(0, input.upgrades) : 0;
  const st = { ...emptyStats(), ...(input.stats || {}) };

  db.prepare(`
    INSERT INTO agents (id, external_id, name, skills, custom, config, upgrades, created_at, wins, losses, draws, battles, points, source)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(id, externalId, name, JSON.stringify(skills), custom, JSON.stringify(config), upgrades, createdAt,
    st.wins | 0, st.losses | 0, st.draws | 0, st.battles | 0, st.points | 0, source);
  return { agent: getAgentById(id) };
}

// --- обновление с авторитетной проверкой лимита правок ---
// by = { id } или { externalId }. Создание = upgrades:0, далее MAX_UPGRADES правок, потом блок.
export function upgradeAgent(by, patch = {}) {
  return inTx(() => {
    const row = findRow(by);
    if (!row) return { error: "not_found" };
    if (row.upgrades >= MAX_UPGRADES) return { error: "upgrade_limit_reached", agent: rowToParticipant(row) };
    const norm = normalizeAgentInput(patch, { partial: true });
    if (norm.error) return { error: "validation", detail: norm.error };
    const v = norm.value;
    const next = {
      name: v.name ?? row.name,
      skills: v.skills ?? safeParse(row.skills, []),
      custom: v.custom ?? row.custom,
      config: v.config ?? safeParse(row.config, {}),
    };
    db.prepare("UPDATE agents SET name=?, skills=?, custom=?, config=?, upgrades=upgrades+1 WHERE id=?")
      .run(next.name, JSON.stringify(next.skills), next.custom, JSON.stringify(next.config), row.id);
    return { agent: getAgentById(row.id) };
  });
}

function insertBattleRow({ aId, bId, winner, scoreA = 0, scoreB = 0, topic = null, tournament = false, history = null } = {}) {
  const info = db.prepare(`
    INSERT INTO battles (a_id, b_id, winner, score_a, score_b, topic, tournament, history, created_at)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(String(aId), String(bId), winner, scoreA | 0, scoreB | 0, topic, tournament ? 1 : 0, serializeHistory(history), Date.now());
  return Number(info.lastInsertRowid);
}

// --- результат боя: пересчёт статистики обоих + запись в историю (одна транзакция) ---
export function applyResult({ aId, bId, winner, scoreA = 0, scoreB = 0, topic = null, tournament = false, history = null } = {}) {
  if (!["A", "B", "draw"].includes(winner)) return { error: "validation", detail: "winner" };
  return inTx(() => {
    const aRow = db.prepare("SELECT * FROM agents WHERE id = ?").get(aId);
    const bRow = db.prepare("SELECT * FROM agents WHERE id = ?").get(bId);
    if (!aRow || !bRow) return { error: "validation", detail: "agents" };

    const beforeA = rowToParticipant(aRow);
    const beforeB = rowToParticipant(bRow);
    if (!tournament && (beforeA.stats.battles >= MAX_WARMUP_BATTLES || beforeB.stats.battles >= MAX_WARMUP_BATTLES)) {
      return { error: "warmup_limit_reached", limit: MAX_WARMUP_BATTLES, a: beforeA, b: beforeB };
    }

    const update = (row, role) => {
      const s = nextStats(
        { wins: row.wins, losses: row.losses, draws: row.draws, battles: row.battles, points: row.points },
        role,
        { winner, scoreA, scoreB }
      );
      db.prepare("UPDATE agents SET wins=?, losses=?, draws=?, battles=?, points=? WHERE id=?")
        .run(s.wins, s.losses, s.draws, s.battles, s.points, row.id);
      return getAgentById(row.id);
    };
    const a = update(aRow, "A");
    const b = update(bRow, "B");
    const battleId = insertBattleRow({ aId, bId, winner, scoreA, scoreB, topic, tournament, history });
    return { a, b, battleId };
  });
}

// --- запись боя без начисления очков: используется турнирной историей ---
export function recordBattle({ aId, bId, winner, scoreA = 0, scoreB = 0, topic = null, tournament = false, history = null } = {}) {
  if (!["A", "B", "draw"].includes(winner)) return { error: "validation", detail: "winner" };
  return inTx(() => {
    const battleId = insertBattleRow({ aId, bId, winner, scoreA, scoreB, topic, tournament, history });
    return { battleId };
  });
}

export function getBattle(id) {
  const row = db.prepare(`
    SELECT bt.*, a.name AS a_name, b.name AS b_name, a.external_id AS a_external_id, b.external_id AS b_external_id
    FROM battles bt
    LEFT JOIN agents a ON a.id = bt.a_id
    LEFT JOIN agents b ON b.id = bt.b_id
    WHERE bt.id = ?
  `).get(id);
  if (!row) return null;
  const parsed = safeParse(row.history, null);
  return rowToBattle({ ...row, ...historyNames(parsed) }, { includeHistory: true });
}

function normalizeTournamentFilter(value) {
  if (value === true || value === 1 || value === "1") return 1;
  if (value === false || value === 0 || value === "0") return 0;
  return null;
}

export function listBattles({ query = "", limit = 50, tournament = null } = {}) {
  const lim = Math.max(1, Math.min(500, limit | 0));
  const q = String(query ?? "").trim().replace(/^#/, "").toLowerCase();
  const tournamentFilter = normalizeTournamentFilter(tournament);
  const where = tournamentFilter == null ? "" : "WHERE bt.tournament = ?";
  const args = tournamentFilter == null ? [] : [tournamentFilter];
  const rows = db.prepare(`
    SELECT bt.*, a.name AS a_name, b.name AS b_name, a.external_id AS a_external_id, b.external_id AS b_external_id
    FROM battles bt
    LEFT JOIN agents a ON a.id = bt.a_id
    LEFT JOIN agents b ON b.id = bt.b_id
    ${where}
    ORDER BY bt.created_at DESC, bt.id DESC
    LIMIT ?
  `).all(...args, q ? 500 : lim);
  const mapped = rows.map((row) => {
    const parsed = safeParse(row.history, null);
    return rowToBattle({ ...row, ...historyNames(parsed) });
  });
  if (!q) return mapped;
  return mapped.filter((bt) => {
    const haystack = [
      bt.aName,
      bt.bName,
      bt.aExternalId,
      bt.bExternalId,
      bt.topic,
    ].map((v) => String(v ?? "").toLowerCase());
    return haystack.some((v) => v.includes(q));
  }).slice(0, lim);
}

// --- таблица / место / история ---
export function leaderboard() {
  return sortLeaderboard(listAgents()).map((p, i) => ({ ...p, rank: i + 1 }));
}

export function userResults(by, { limit = 50 } = {}) {
  const row = findRow(by);
  if (!row) return { error: "not_found" };
  const agent = rowToParticipant(row);
  const board = sortLeaderboard(listAgents());
  const rank = board.findIndex((p) => p.id === agent.id) + 1;
  const names = Object.fromEntries(listAgents().map((p) => [p.id, p.name]));
  const rows = db.prepare(
    "SELECT * FROM battles WHERE tournament = 0 AND (a_id = ? OR b_id = ?) ORDER BY created_at DESC LIMIT ?"
  ).all(agent.id, agent.id, Math.max(1, Math.min(500, limit | 0)));
  const history = rows.map((bt) => {
    const self = bt.a_id === agent.id ? "A" : "B";
    const oppId = self === "A" ? bt.b_id : bt.a_id;
    return {
      opponentName: names[oppId] || "?",
      battleId: bt.id,
      result: bt.winner === "draw" ? "draw" : bt.winner === self ? "win" : "loss",
      scoreSelf: self === "A" ? bt.score_a : bt.score_b,
      scoreOpp: self === "A" ? bt.score_b : bt.score_a,
      topic: bt.topic,
      tournament: !!bt.tournament,
      at: bt.created_at,
    };
  });
  return { agent: { id: agent.id, name: agent.name, stats: agent.stats }, rank, total: board.length, history };
}

// --- сброс очков (весь ростер или конкретные id) ---
export function resetScores(ids = null) {
  if (Array.isArray(ids)) {
    const stmt = db.prepare("UPDATE agents SET wins=0, losses=0, draws=0, battles=0, points=0 WHERE id = ?");
    inTx(() => ids.forEach((id) => stmt.run(id)));
  } else {
    db.exec("UPDATE agents SET wins=0, losses=0, draws=0, battles=0, points=0");
  }
  return { agents: listAgents() };
}

export function removeAgent(id) {
  db.prepare("DELETE FROM agents WHERE id = ?").run(id);
  return { ok: true };
}

// Удобный декоратор лимита для ответов API.
export function withLimit(agent) {
  if (!agent) return agent;
  const upgradesLeft = Math.max(0, MAX_UPGRADES - (agent.upgrades || 0));
  return { ...agent, upgradesLeft, locked: upgradesLeft <= 0 };
}

// --- серверное состояние приложения ---
const TOURNAMENT_STATE_KEY = "tournament";

function readState(key, fallback) {
  const row = db.prepare("SELECT value FROM app_state WHERE key = ?").get(key);
  if (!row) return deepClone(fallback);
  return safeParse(row.value, deepClone(fallback));
}

function writeState(key, value) {
  db.prepare(`
    INSERT INTO app_state (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value), Date.now());
  return deepClone(value);
}

export function getTournamentState() {
  return cloneTournament(readState(TOURNAMENT_STATE_KEY, DEFAULT_TOURNAMENT));
}

export function saveTournamentState(tournament) {
  return writeState(TOURNAMENT_STATE_KEY, cloneTournament(tournament));
}

export function resetTournamentState() {
  return saveTournamentState(DEFAULT_TOURNAMENT);
}
