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
  const resultRes = await fetch(`${BASE}/api/results`, authed("POST", { aId: created.id, bId: b.id, winner: "A", scoreA: 90, scoreB: 50, topic: "Тест", tournament: false }));
  const result = await resultRes.json();
  check("POST /api/results → A победил, 3 + бонус(2) = 5 очков", result.a.stats.points === 5 && result.a.stats.wins === 1);

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
