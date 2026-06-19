// Юнит-тест серверного хранилища агентов (db.js) на in-memory SQLite — без сети.
// Проверяем: создание, инвариант «один внешний пользователь = один агент», лимит 3 правок
// (серверный enforcement), начисление очков, лидерборд с местом и историю боёв.
import {
  initDb, createAgent, getAgentById, getAgentByExternalId,
  upgradeAgent, applyResult, leaderboard, userResults, resetScores,
  removeAgent, MAX_UPGRADES,
} from "../db.js";

initDb(":memory:");

let passed = 0, failed = 0;
const check = (name, cond) => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
};

console.log("\n=== TC-DB: серверное хранилище агентов ===");

// 1. Создание + валидация.
const bad = createAgent({ name: "", skills: [] });
check("создание без имени/скиллов → ошибка валидации", bad.error === "validation");

const a = createAgent({ externalId: "u-1", name: "Альфа", skills: ["aggressor"], custom: "x", config: {}, source: "bot" });
check("создан агент с externalId", !!a.agent && a.agent.externalId === "u-1");
check("новый агент: upgrades = 0", a.agent.upgrades === 0);
check("конфиг нормализован из дефолтов", a.agent.config.memory === "window" && a.agent.config.replyLen === "short");

// 2. Один пользователь = один агент.
const dup = createAgent({ externalId: "u-1", name: "Дубль", skills: ["factualist"] });
check("повторное создание для того же externalId → 409 agent_exists", dup.error === "agent_exists");
check("getAgentByExternalId находит агента", getAgentByExternalId("u-1").id === a.agent.id);

// 3. Лимит правок: создание + MAX_UPGRADES правок, затем блок.
for (let i = 1; i <= MAX_UPGRADES; i++) {
  const r = upgradeAgent({ externalId: "u-1" }, { name: "Альфа" + i, skills: ["aggressor", "rhetorician"] });
  check(`правка #${i} проходит, upgrades = ${i}`, !r.error && r.agent.upgrades === i);
}
const over = upgradeAgent({ externalId: "u-1" }, { name: "Лишняя" });
check("правка сверх лимита → upgrade_limit_reached", over.error === "upgrade_limit_reached");
check("после блока upgrades остаётся = MAX_UPGRADES", getAgentByExternalId("u-1").upgrades === MAX_UPGRADES);

// 4. Невалидный скилл отбрасывается, неизвестный конфиг клампится.
const b = createAgent({ externalId: "u-2", name: "Бета", skills: ["factualist", "НЕСУЩЕСТВУЕТ"], config: { temperature: 9, windowSize: 99, memory: "xxx" } });
check("неизвестный скилл отброшен", b.agent.skills.length === 1 && b.agent.skills[0] === "factualist");
check("температура закламплена в [0.1,1.5]", b.agent.config.temperature <= 1.5);
check("windowSize закламплен в [2,6]", b.agent.config.windowSize === 6);
check("неизвестный memory → дефолт", b.agent.config.memory === "window");

// 5. Начисление очков: победа A с разрывом 80-60 → +3 и бонус round(20/20)=1 = 4 очка.
const res = applyResult({ aId: a.agent.id, bId: b.agent.id, winner: "A", scoreA: 80, scoreB: 60, topic: "Тест", tournament: false });
check("после боя у A 1 победа", res.a.stats.wins === 1 && res.a.stats.battles === 1);
check("A получил 3 + бонус(1) = 4 очка", res.a.stats.points === 4);
check("у B зафиксировано поражение, 0 очков", res.b.stats.losses === 1 && res.b.stats.points === 0);

// 6. Лидерборд: место и сортировка.
const board = leaderboard();
check("в лидерборде 2 агента", board.length === 2);
check("лидер — A с rank 1", board[0].id === a.agent.id && board[0].rank === 1);

// 7. История и место конкретного пользователя.
const ur = userResults({ externalId: "u-1" });
check("у A место 1 из 2", ur.rank === 1 && ur.total === 2);
check("история A содержит 1 бой — победу над Бета", ur.history.length === 1 && ur.history[0].result === "win" && ur.history[0].opponentName === "Бета");
check("в истории сохранена тема", ur.history[0].topic === "Тест");

// 8. Сброс очков.
resetScores();
check("после сброса у всех 0 очков и 0 боёв", leaderboard().every((p) => p.stats.points === 0 && p.stats.battles === 0));

// 9. Удаление.
removeAgent(b.agent.id);
check("после удаления агент не находится", getAgentById(b.agent.id) === null);

console.log(`\n  Итог: ${passed} прошло, ${failed} провалено`);
process.exit(failed ? 1 : 0);
