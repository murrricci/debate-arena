import {
  isActivityFinished,
  isNavAvailable,
  isWarmupOpen,
  warmupStatusMessage,
} from "../src/lib/activityState.js";

let passed = 0, failed = 0;
const check = (name, cond) => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
};

console.log("\n=== TC-ACTIVITY-STATE: этапы активности ===");

const idle = { status: "idle", closed: false };
const ready = { status: "ready", closed: true };
const running = { status: "running", closed: true };
const done = { status: "done", closed: true };

check("до турнира разминка открыта", isWarmupOpen(idle) === true);
check("после формирования турнира разминка закрыта", isWarmupOpen(ready) === false);
check("во время турнира разминка закрыта", isWarmupOpen(running) === false);
check("после турнира активность завершена", isActivityFinished(done) === true);
check("после завершения сообщение запрещает новые бои", warmupStatusMessage(done).includes("Новые бои больше не проводятся"));

check("вкладка арены активна только до турнира", isNavAvailable("arena", idle) === true && isNavAvailable("arena", ready) === false);
check("вкладка турнира недоступна после завершения", isNavAvailable("tournament", running) === true && isNavAvailable("tournament", done) === false);
check("после завершения доступны настройки, история и результаты", ["register", "battles", "scoreboard"].every((page) => isNavAvailable(page, done)));
check("после завершения инструкция недоступна", isNavAvailable("guide", done) === false);

console.log(`\n  Итог: ${passed} прошло, ${failed} провалено`);
process.exit(failed ? 1 : 0);
