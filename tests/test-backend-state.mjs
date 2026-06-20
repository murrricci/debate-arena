// Серверное состояние, которое не должно жить в browser localStorage:
// турнир хранится в БД, live-снимок отдаётся backend API отдельно.
import {
  initDb,
  getTournamentState,
  saveTournamentState,
  resetTournamentState,
} from "../db.js";

let passed = 0, failed = 0;
const check = (name, cond) => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
};

console.log("\n=== TC-BACKEND-STATE: серверное состояние турнира ===");

initDb(":memory:");

const initial = getTournamentState();
check("пустая БД отдаёт idle-турнир", initial.status === "idle" && initial.closed === false && Array.isArray(initial.matches));

const ready = {
  status: "ready",
  closed: true,
  roster: ["a", "b"],
  matches: [{ id: "m-1", index: 1, a: "a", b: "b", status: "queued" }],
  statsById: { a: { battles: 0, points: 0 }, b: { battles: 0, points: 0 } },
  cursor: 0,
};
saveTournamentState(ready);
const stored = getTournamentState();
check("турнир сохраняется и читается из БД", stored.status === "ready" && stored.closed === true && stored.matches[0].id === "m-1");

stored.matches[0].status = "mutated-client-copy";
check("getTournamentState возвращает копию, не ссылку на state", getTournamentState().matches[0].status === "queued");

const reset = resetTournamentState();
check("resetTournamentState возвращает idle и очищает ростер", reset.status === "idle" && reset.closed === false && reset.roster.length === 0);

console.log(`\n  Итог: ${passed} прошло, ${failed} провалено`);
process.exit(failed ? 1 : 0);
