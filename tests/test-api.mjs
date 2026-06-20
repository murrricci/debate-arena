// Живой e2e-тест REST API управления агентами. Поднимает реальный server.js на отдельном
// порту с in-memory БД и тестовым ключом, прогоняет полный сценарий:
//   справочник → создание → дубль(409) → правки×3 → лимит(403) → результат боя → лидерборд → история.
// Запуск: npm run test:api  (НЕ требует LLM-ключа — /api/claude не вызывается).
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = 3987;
const KEY = "test-secret-key-123";
const BASE = `http://localhost:${PORT}`;

let passed = 0, failed = 0;
const check = (name, cond) => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const authed = (method, body, withKey = true) => ({
  method,
  headers: { "Content-Type": "application/json", ...(withKey ? { "X-Arena-Key": KEY } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

const server = spawn("node", ["server.js"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), ARENA_API_KEY: KEY, ARENA_DB_FILE: ":memory:", LLM_LOG: "0", LLM_LOG_FILE: "0" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOut = "";
server.stdout.on("data", (d) => { serverOut += d; });
server.stderr.on("data", (d) => { serverOut += d; });

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch { /* ещё не поднялся */ }
    await sleep(100);
  }
  return false;
}

async function main() {
  console.log("\n=== TC-API: REST API управления агентами (живой сервер) ===");
  if (!(await waitForServer())) {
    console.log("  ❌ сервер не поднялся\n" + serverOut);
    return 1;
  }

  // 1. health сообщает, что API агентов включён.
  const health = await (await fetch(`${BASE}/api/health`)).json();
  check("health: arenaApi = true", health.arenaApi === true);

  // 2. справочник формы (открытый).
  const form = await (await fetch(`${BASE}/api/meta/form`)).json();
  check("meta/form: есть скиллы", Array.isArray(form.skills) && form.skills.length > 0);
  check("meta/form: maxUpgrades = 3", form.limits.maxUpgrades === 3);
  check("meta/form: дефолты конфига присутствуют", !!form.config.defaults.memory);

  // 3. создание без ключа → 401.
  const noKey = await fetch(`${BASE}/api/agents`, authed("POST", { externalId: "u-1", name: "X", skills: ["aggressor"] }, false));
  check("POST /api/agents без ключа → 401", noKey.status === 401);

  // 4. создание с ключом → 201.
  const createRes = await fetch(`${BASE}/api/agents`, authed("POST", { externalId: "u-1", name: "Альфа", skills: ["aggressor"], custom: "герой", config: { temperature: 1.0 }, source: "bot" }));
  const created = await createRes.json();
  check("POST /api/agents → 201", createRes.status === 201);
  check("ответ содержит upgradesLeft = 3, locked = false", created.upgradesLeft === 3 && created.locked === false);

  // 5. дубль того же externalId → 409.
  const dupRes = await fetch(`${BASE}/api/agents`, authed("POST", { externalId: "u-1", name: "Дубль", skills: ["factualist"] }));
  check("повтор externalId → 409", dupRes.status === 409);

  // 6. чтение по externalId.
  const got = await (await fetch(`${BASE}/api/agents/by-external/u-1`, authed("GET"))).json();
  check("GET by-external находит агента", got.id === created.id && got.name === "Альфа");

  // 7. правки ×3, затем лимит.
  for (let i = 1; i <= 3; i++) {
    const r = await fetch(`${BASE}/api/agents/by-external/u-1`, authed("PATCH", { name: "Альфа" + i }));
    const j = await r.json();
    check(`PATCH #${i} → 200, upgradesLeft = ${3 - i}`, r.status === 200 && j.upgradesLeft === 3 - i);
  }
  const overRes = await fetch(`${BASE}/api/agents/by-external/u-1`, authed("PATCH", { name: "Лишняя" }));
  const overJson = await overRes.json();
  check("PATCH сверх лимита → 403 upgrade_limit_reached", overRes.status === 403 && overJson.error === "upgrade_limit_reached");

  // 8. второй агент + результат боя.
  const b = await (await fetch(`${BASE}/api/agents`, authed("POST", { externalId: "u-2", name: "Бета", skills: ["factualist"] }))).json();
  const history = {
    topic: { title: "Тест" },
    stances: { A: "За", B: "Против" },
    fighters: { A: { id: created.id, name: "Альфа" }, B: { id: b.id, name: "Бета" } },
    rounds: [{ round: 1, replies: { A: { text: "Аргумент" }, B: { text: "Ответ" } }, judge: { note: "A сильнее" }, damage: { A: 1, B: 5 }, hp: { A: 99, B: 95 } }],
    final: { winner: "A", score_a: 90, score_b: 50, rationale: "A убедительнее" },
  };
  const resultRes = await fetch(`${BASE}/api/results`, authed("POST", { aId: created.id, bId: b.id, winner: "A", scoreA: 90, scoreB: 50, topic: "Тест", tournament: false, history }));
  const result = await resultRes.json();
  check("POST /api/results → A победил, 3 + бонус(2) = 5 очков", result.a.stats.points === 5 && result.a.stats.wins === 1);
  check("POST /api/results возвращает battleId", Number.isInteger(result.battleId) && result.battleId > 0);

  const battle = await (await fetch(`${BASE}/api/battles/${result.battleId}`)).json();
  check("GET /api/battles/:id возвращает протокол", battle.history?.rounds?.[0]?.judge?.note === "A сильнее");
  check("обычный бой в API не помечен как турнирный", battle.tournament === false);

  const tourRes = await fetch(`${BASE}/api/battles`, authed("POST", { aId: created.id, bId: b.id, winner: "B", scoreA: 40, scoreB: 80, topic: "Турнир", tournament: true, history: { ...history, topic: { title: "Турнир" } } }));
  const tour = await tourRes.json();
  check("POST /api/battles сохраняет турнирный бой", tourRes.status === 201 && Number.isInteger(tour.battleId));

  const tourBattle = await (await fetch(`${BASE}/api/battles/${tour.battleId}`)).json();
  check("турнирный бой в API имеет пометку tournament", tourBattle.tournament === true);

  const afterTourRoster = await (await fetch(`${BASE}/api/agents`)).json();
  const afterTourA = afterTourRoster.agents.find((p) => p.id === created.id);
  check("турнирная запись не меняет разминочную статистику", afterTourA.stats.battles === 1 && afterTourA.stats.points === 5);

  const battlesByNumber = await (await fetch(`${BASE}/api/battles?query=%23u-2`)).json();
  check("GET /api/battles ищет по номеру пользователя", battlesByNumber.battles.some((bt) => bt.id === result.battleId));
  check("GET /api/battles возвращает турнирную пометку в списке", battlesByNumber.battles.some((bt) => bt.id === tour.battleId && bt.tournament === true));
  const tournamentBattles = await (await fetch(`${BASE}/api/battles?tournament=1`)).json();
  check("GET /api/battles?tournament=1 возвращает только турнирные бои", tournamentBattles.battles.some((bt) => bt.id === tour.battleId) && !tournamentBattles.battles.some((bt) => bt.id === result.battleId));
  const tournamentBattlesByNumber = await (await fetch(`${BASE}/api/battles?query=%23u-2&tournament=1`)).json();
  check("GET /api/battles совмещает турнирный фильтр с поиском", tournamentBattlesByNumber.battles.length === 1 && tournamentBattlesByNumber.battles[0].id === tour.battleId);

  // 9. лидерборд (открытый).
  const lb = await (await fetch(`${BASE}/api/results/leaderboard`)).json();
  check("лидерборд: A на 1 месте", lb.leaderboard[0].id === created.id && lb.leaderboard[0].rank === 1);

  // 10. результаты пользователя: место + история.
  const ur = await (await fetch(`${BASE}/api/results/by-external/u-1`, authed("GET"))).json();
  check("by-external результаты: место 1 из 2", ur.rank === 1 && ur.total === 2);
  check("история: 1 победа над Бета", ur.history.length === 1 && ur.history[0].result === "win" && ur.history[0].opponentName === "Бета");

  // 11. ростер (открытый).
  const roster = await (await fetch(`${BASE}/api/agents`)).json();
  check("GET /api/agents: 2 агента в ростере", roster.agents.length === 2);

  // 12. Серверный турнир: состояние не зависит от browser localStorage.
  const closeRes = await fetch(`${BASE}/api/tournament/close`, authed("POST"));
  const closedTournament = await closeRes.json();
  check("POST /api/tournament/close формирует backend-турнир", closeRes.status === 200 && closedTournament.status === "ready" && closedTournament.closed === true);
  check("backend-турнир содержит матч между агентами", closedTournament.matches.length === 1 && closedTournament.matches[0].a && closedTournament.matches[0].b);

  const tournamentState = await (await fetch(`${BASE}/api/tournament`)).json();
  check("GET /api/tournament возвращает сохранённый турнир", tournamentState.status === "ready" && tournamentState.matches[0].id === closedTournament.matches[0].id);

  const startRes = await fetch(`${BASE}/api/tournament/start`, authed("POST"));
  const startedTournament = await startRes.json();
  check("POST /api/tournament/start переводит ready → running", startRes.status === 200 && startedTournament.status === "running");

  const runningRes = await fetch(`${BASE}/api/tournament/matches/running`, authed("POST", { ids: [closedTournament.matches[0].id] }));
  const runningTournament = await runningRes.json();
  check("POST /api/tournament/matches/running отмечает матч running", runningTournament.matches[0].status === "running");

  const matchResultRes = await fetch(`${BASE}/api/tournament/matches/${closedTournament.matches[0].id}/result`, authed("POST", { winner: "A", scoreA: 80, scoreB: 60, battleId: 777 }));
  const afterMatchTournament = await matchResultRes.json();
  check("POST /api/tournament/matches/:id/result сохраняет результат", afterMatchTournament.matches[0].status === "done" && afterMatchTournament.matches[0].battleId === 777);

  const resetTourRes = await fetch(`${BASE}/api/tournament/reset`, authed("POST"));
  const resetTour = await resetTourRes.json();
  check("POST /api/tournament/reset возвращает idle", resetTour.status === "idle" && resetTour.closed === false);

  // 13. Live snapshot: табло может восстановить текущий бой с backend.
  const emptyLive = await (await fetch(`${BASE}/api/live`)).json();
  check("GET /api/live до публикации возвращает null", emptyLive.live === null);

  const livePayload = { phase: "fight", topic: "Тест", round: 2, status: "A отвечает" };
  const postLiveRes = await fetch(`${BASE}/api/live`, authed("POST", livePayload));
  const postedLive = await postLiveRes.json();
  check("POST /api/live сохраняет snapshot", postLiveRes.status === 200 && postedLive.live.topic === "Тест" && postedLive.live.round === 2);

  const gotLive = await (await fetch(`${BASE}/api/live`)).json();
  check("GET /api/live возвращает последний snapshot", gotLive.live.topic === "Тест" && gotLive.live.phase === "fight");

  const clearLiveRes = await fetch(`${BASE}/api/live`, authed("DELETE"));
  const clearedLive = await clearLiveRes.json();
  check("DELETE /api/live очищает snapshot", clearLiveRes.status === 200 && clearedLive.live === null);

  console.log(`\n  Итог: ${passed} прошло, ${failed} провалено`);
  return failed ? 1 : 0;
}

let code = 1;
try {
  code = await main();
} catch (e) {
  console.log("  ❌ исключение: " + e.message);
  console.log(serverOut);
} finally {
  server.kill("SIGTERM");
}
process.exit(code);
