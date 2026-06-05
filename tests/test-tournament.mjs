// Юнит-тест турнирной логики (без браузера): круговое расписание и места.
// localStorage/BroadcastChannel в Node нет — мок'аем минимально, чтобы импортнуть модуль.

// --- лёгкие моки браузерных API ---
const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
globalThis.BroadcastChannel = class {
  postMessage() {}
  addEventListener() {}
  removeEventListener() {}
};

const { addParticipant, applyResult, leaderboard, upgradeParticipant, MAX_UPGRADES } = await import("../src/lib/store.js");
const { closeAndStart, getTournament, currentMatch, recordMatchResult, standings, progress, TOP_N, resetTournament } = await import("../src/lib/tournament.js");

let passed = 0, failed = 0;
const check = (name, cond) => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
};

console.log("\n=== TC-TOUR: турнирная логика ===");

// 1. Лимит апгрейдов.
const p = addParticipant({ name: "Тест", skills: ["aggressor"], custom: "", config: {} });
check("новый боец: upgrades = 0", p.upgrades === 0);
for (let i = 1; i <= MAX_UPGRADES; i++) {
  const r = upgradeParticipant(p.id, { name: "Тест" + i, skills: ["aggressor"], custom: "", config: {} });
  check(`апгрейд #${i} проходит, upgrades = ${i}`, r && r.upgrades === i);
}
const over = upgradeParticipant(p.id, { name: "Лишний", skills: ["aggressor"], custom: "", config: {} });
check("апгрейд сверх лимита отклонён (null)", over === null);

// 2. Круговое расписание: N бойцов → C(n,2) матчей, каждый играет (n-1).
// Добавим ещё бойцов (всего 5, чтобы было нечётное число → проверка «болвана»).
const names = ["A", "B", "C", "D"]; // + p = 5 участников
const players = [p, ...names.map((n) => addParticipant({ name: n, skills: ["aggressor"], custom: "", config: {} }))];
const N = players.length;

const t = closeAndStart();
check("турнир запущен (running)", t.status === "running");
check("приём закрыт", t.closed === true);
check(`ростер = min(участники, топ-${TOP_N}) = ${Math.min(N, TOP_N)}`, t.roster.length === Math.min(N, TOP_N));
const expectedMatches = (N * (N - 1)) / 2;
check(`матчей = C(${N},2) = ${expectedMatches}`, t.matches.length === expectedMatches);

// каждый играет ровно (N-1) матчей
const counts = {};
for (const m of t.matches) { counts[m.a] = (counts[m.a] || 0) + 1; counts[m.b] = (counts[m.b] || 0) + 1; }
check("каждый боец играет (N-1) матчей", Object.values(counts).every((c) => c === N - 1));
// нет матчей сам с собой и нет дублей пар
const pairs = new Set(t.matches.map((m) => [m.a, m.b].sort().join("|")));
check("нет дублей пар и игры с собой", pairs.size === expectedMatches && !t.matches.some((m) => m.a === m.b));

// 3. Прогон всех матчей: всегда побеждает A (первый по расписанию).
let guard = 0;
while (getTournament().status === "running" && guard++ < 100) {
  const m = currentMatch();
  applyResult({ aId: m.a, bId: m.b, winner: "A", scoreA: 80, scoreB: 60 });
  recordMatchResult({ winner: "A", scoreA: 80, scoreB: 60 });
}
const done = getTournament();
check("после всех матчей статус done", done.status === "done");
const pr = progress();
check("сыграны все матчи", pr.played === pr.total && pr.total === expectedMatches);

// 4. Таблица отсортирована по очкам, места есть.
const table = standings();
check("в таблице все участники ростера", table.length === t.roster.length);
let sorted = true;
for (let i = 1; i < table.length; i++) if (table[i - 1].stats.points < table[i].stats.points) sorted = false;
check("таблица отсортирована по убыванию очков", sorted);
check("у лидера больше всего очков", table[0].stats.points === Math.max(...table.map((x) => x.stats.points)));

// 5. Сброс турнира.
const reset = resetTournament();
check("сброс турнира → idle и приём открыт", reset.status === "idle" && reset.closed === false);

console.log(`\n  Итог: ${passed} прошло, ${failed} провалено`);
process.exit(failed ? 1 : 0);
