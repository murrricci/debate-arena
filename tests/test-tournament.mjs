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

const { addParticipant, applyResult, leaderboard, upgradeParticipant, MAX_UPGRADES, canPlayWarmup, MAX_WARMUP_BATTLES } = await import("../src/lib/store.js");
const {
  closeAndStart, getTournament, currentMatch, recordMatchResult, standings, progress, TOP_N, resetTournament,
  selectTournamentRoster, queuedMatchesToStart, recordTournamentMatchResult, tournamentStandings, MAX_TOURNAMENT_CONCURRENCY,
  startTournament, markTournamentMatchesRunning, recordTournamentMatchError,
} = await import("../src/lib/tournament.js");

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
check(`разминка: новый боец может играть до ${MAX_WARMUP_BATTLES} боёв`, canPlayWarmup(p) === true);

// 2. Круговое расписание: N бойцов → C(n,2) матчей, каждый играет (n-1).
// Добавим ещё бойцов (всего 5, чтобы было нечётное число → проверка «болвана»).
const names = ["A", "B", "C", "D"]; // + p = 5 участников
const players = [p, ...names.map((n) => addParticipant({ name: n, skills: ["aggressor"], custom: "", config: {} }))];
const N = players.length;
applyResult({ aId: players[0].id, bId: players[1].id, winner: "draw", scoreA: 50, scoreB: 50 });
applyResult({ aId: players[2].id, bId: players[3].id, winner: "draw", scoreA: 50, scoreB: 50 });
applyResult({ aId: players[4].id, bId: players[0].id, winner: "draw", scoreA: 50, scoreB: 50 });

const t = closeAndStart();
check("турнир сформирован и ждёт запуска (ready)", t.status === "ready");
check("приём закрыт", t.closed === true);
check(`ростер = min(участники, топ-${TOP_N}) = ${Math.min(N, TOP_N)}`, t.roster.length === Math.min(N, TOP_N));
const expectedMatches = (N * (N - 1)) / 2;
check(`матчей = C(${N},2) = ${expectedMatches}`, t.matches.length === expectedMatches);
check("матчи после формирования стоят в очереди", t.matches.every((m) => m.status === "queued"));

// каждый играет ровно (N-1) матчей
const counts = {};
for (const m of t.matches) { counts[m.a] = (counts[m.a] || 0) + 1; counts[m.b] = (counts[m.b] || 0) + 1; }
check("каждый боец играет (N-1) матчей", Object.values(counts).every((c) => c === N - 1));
// нет матчей сам с собой и нет дублей пар
const pairs = new Set(t.matches.map((m) => [m.a, m.b].sort().join("|")));
check("нет дублей пар и игры с собой", pairs.size === expectedMatches && !t.matches.some((m) => m.a === m.b));

// 3. Прогон всех матчей: всегда побеждает A (первый по расписанию).
let guard = 0;
while (getTournament().status !== "done" && guard++ < 100) {
  const m = currentMatch();
  recordMatchResult({ matchId: m.id, winner: "A", scoreA: 80, scoreB: 60 });
}
const done = getTournament();
check("после всех матчей статус done", done.status === "done");
const pr = progress();
check("сыграны все матчи", pr.played === pr.total && pr.total === expectedMatches);
check("турнирные очки не меняют разминочный рейтинг", leaderboard().every((p) => p.stats.battles <= MAX_WARMUP_BATTLES));

// 4. Таблица отсортирована по очкам, места есть.
const table = standings();
check("в таблице все участники ростера", table.length === t.roster.length);
let sorted = true;
for (let i = 1; i < table.length; i++) if (table[i - 1].tourStats.points < table[i].tourStats.points) sorted = false;
check("таблица отсортирована по убыванию очков", sorted);
check("у лидера больше всего турнирных очков", table[0].tourStats.points === Math.max(...table.map((x) => x.tourStats.points)));

// 5. Отбор топ-10: минимум 1 бой, граница добирается случайно из равных очков.
const fake = [
  ...Array.from({ length: 9 }, (_, i) => ({ id: `top-${i}`, name: `Top ${i}`, stats: { points: 10 - i, battles: 1, wins: 1, losses: 0, draws: 0 } })),
  ...Array.from({ length: 4 }, (_, i) => ({ id: `tie-${i}`, name: `Tie ${i}`, stats: { points: 1, battles: 1, wins: 0, losses: 0, draws: 1 } })),
  { id: "no-battles", name: "No Battles", stats: { points: 99, battles: 0, wins: 0, losses: 0, draws: 0 } },
  { id: "low", name: "Low", stats: { points: 0, battles: 1, wins: 0, losses: 1, draws: 0 } },
];
const picked = selectTournamentRoster(fake, { random: () => 0.9 });
check("отбор игнорирует бойцов без разминочных боёв", !picked.includes("no-battles"));
check("отбор сохраняет 9 мест выше границы", Array.from({ length: 9 }, (_, i) => `top-${i}`).every((id) => picked.includes(id)));
check("отбор добирает ровно 1 из tied-группы до топ-10", picked.length === TOP_N && picked.filter((id) => id.startsWith("tie-")).length === 1);

// 6. Планировщик параллельных матчей: максимум 9 активных.
const queue = Array.from({ length: 12 }, (_, i) => ({ id: `m-${i}`, status: i < 2 ? "running" : "queued" }));
const toStart = queuedMatchesToStart(queue, MAX_TOURNAMENT_CONCURRENCY);
check("планировщик не превышает лимит 9 активных матчей", toStart.length === 7);
check("планировщик берёт первые queued-матчи", toStart[0].id === "m-2" && toStart.at(-1).id === "m-8");

// 7. Состояния матчей для UI-очереди.
const runningTour = startTournament({ ...t, status: "ready" });
check("startTournament переводит ready → running", runningTour.status === "running");
const marked = markTournamentMatchesRunning(runningTour, ["m-1", "m-2"]);
check("markTournamentMatchesRunning отмечает выбранные queued как running", marked.matches.filter((m) => m.status === "running").length === 2);
const errored = recordTournamentMatchError(marked, { matchId: "m-1", error: "LLM упал" });
check("recordTournamentMatchError пишет status=error и текст", errored.matches[0].status === "error" && errored.matches[0].error === "LLM упал");

// 8. Запись результата отдельного матча обновляет отдельный турнирный лидерборд.
const miniTour = {
  roster: ["a", "b"],
  statsById: {},
  matches: [{ id: "m-1", a: "a", b: "b", status: "running", winner: null, scoreA: 0, scoreB: 0 }],
};
const recorded = recordTournamentMatchResult(miniTour, { matchId: "m-1", winner: "A", scoreA: 80, scoreB: 60 });
const miniRows = tournamentStandings(recorded, [{ id: "a", name: "A" }, { id: "b", name: "B" }]);
check("результат матча пишет winner и status=done", recorded.matches[0].winner === "A" && recorded.matches[0].status === "done");
check("турнирный лидерборд считает очки отдельно", miniRows[0].id === "a" && miniRows[0].tourStats.points === 4 && miniRows[1].tourStats.points === 0);

// 9. Сброс турнира.
const reset = resetTournament();
check("сброс турнира → idle и приём открыт", reset.status === "idle" && reset.closed === false);

console.log(`\n  Итог: ${passed} прошло, ${failed} провалено`);
process.exit(failed ? 1 : 0);
