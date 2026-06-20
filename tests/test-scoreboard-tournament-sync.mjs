// Заголовок окна рейтинга должен переключаться на турнирный режим сразу из
// tournament-события, не дожидаясь перезагрузки страницы или storage-event.
import { tournamentStateFromEvent, scoreboardTitle } from "../src/lib/scoreboardState.js";

let passed = 0, failed = 0;
const check = (name, cond) => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
};

console.log("\n=== TC-SCOREBOARD-TOURNAMENT-SYNC: live-статус турнира ===");

const current = { status: "idle", closed: false };
const ready = { status: "ready", closed: true };
const running = { status: "running", closed: true };

check("tournament-событие применяет payload без чтения storage", tournamentStateFromEvent(current, "tournament", ready).status === "ready");
check("заголовок idle показывает рейтинг разминки", scoreboardTitle(current) === "РЕЙТИНГ РАЗМИНКИ");
check("заголовок ready показывает турнирную таблицу", scoreboardTitle(ready) === "ТУРНИРНАЯ ТАБЛИЦА");
check("заголовок running показывает турнирную таблицу", scoreboardTitle(running) === "ТУРНИРНАЯ ТАБЛИЦА");

console.log(`\n  Итог: ${passed} прошло, ${failed} провалено`);
process.exit(failed ? 1 : 0);
