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
const { closeAndStart, TOP_N, resetTournament } = await import("../src/lib/tournament.js");
const {
  selectTournamentRoster, queuedMatchesToStart, recordTournamentMatchResult, tournamentStandings, MAX_TOURNAMENT_CONCURRENCY,
  startTournament, markTournamentMatchesRunning, recordTournamentMatchError, visibleTournamentMatches,
  tournamentFightCounts,
} = await import("../src/lib/tournamentCore.js");
const { recoverStaleMatches, createTournamentWorker } = await import("../src/lib/tournamentWorker.js");

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

// 3. Прогон всех матчей на pure core: всегда побеждает A (первый по расписанию).
let done = startTournament(t);
let guard = 0;
while (done.status !== "done" && guard++ < 100) {
  const m = done.matches.find((match) => match.status === "queued" || match.status === "running");
  done = recordTournamentMatchResult(done, { matchId: m.id, winner: "A", scoreA: 80, scoreB: 60 });
}
check("после всех матчей статус done", done.status === "done");
const pr = tournamentFightCounts(done.matches);
check("сыграны все матчи", pr.played === pr.total && pr.total === expectedMatches);
check("турнирные очки не меняют разминочный рейтинг", leaderboard().every((p) => p.stats.battles <= MAX_WARMUP_BATTLES));

// 4. Таблица отсортирована по очкам, места есть.
const table = tournamentStandings(done, players);
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
check("сетка плашек показывает только текущие running-матчи", visibleTournamentMatches([
  { id: "done", status: "done" },
  { id: "queued", status: "queued" },
  { id: "running-1", status: "running" },
  { id: "error", status: "error" },
  { id: "running-2", status: "running" },
]).map((m) => m.id).join("|") === "running-1|running-2");
const countView = typeof tournamentFightCounts === "function" ? tournamentFightCounts([
  { id: "done", status: "done" },
  { id: "running", status: "running" },
  { id: "error", status: "error", supersededBy: "retry" },
  { id: "retry", status: "queued", retryOf: "error" },
]) : null;
check("счётчик турнира показывает проведено и осталось без ошибочных попыток", countView?.played === 1 && countView?.remaining === 2 && countView?.total === 3);

// 7. Состояния матчей для UI-очереди.
const runningTour = startTournament({ ...t, status: "ready" });
check("startTournament переводит ready → running", runningTour.status === "running");
const marked = markTournamentMatchesRunning(runningTour, ["m-1", "m-2"]);
check("markTournamentMatchesRunning отмечает выбранные queued как running", marked.matches.filter((m) => m.status === "running").length === 2);
const errored = recordTournamentMatchError(marked, { matchId: "m-1", error: "LLM упал" });
check("recordTournamentMatchError пишет status=error и текст", errored.matches[0].status === "error" && errored.matches[0].error === "LLM упал");
const retry = errored.matches.find((m) => m.retryOf === "m-1");
check("ошибочный матч добавляется в очередь заново", !!retry && retry.status === "queued" && retry.a === marked.matches[0].a && retry.b === marked.matches[0].b && retry.topicId === marked.matches[0].topicId);
check("ошибочная попытка ссылается на повтор", !!retry && errored.matches[0].supersededBy === retry.id);
const afterErrorCounts = typeof tournamentFightCounts === "function" ? tournamentFightCounts(errored.matches) : null;
check("повтор не увеличивает число обязательных боёв турнира", afterErrorCounts?.played === 0 && afterErrorCounts?.remaining === expectedMatches && afterErrorCounts?.total === expectedMatches);

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

let retryMini = recordTournamentMatchError({
  status: "running",
  roster: ["a", "b"],
  statsById: {},
  matches: [{ id: "m-1", index: 1, a: "a", b: "b", topicId: "logic", stage: "main", tiebreakRound: null, status: "running", winner: null, scoreA: 0, scoreB: 0 }],
}, { matchId: "m-1", error: "LLM упал" });
const retryMiniMatch = retryMini.matches.find((m) => m.retryOf === "m-1");
if (retryMiniMatch) {
  retryMini = recordTournamentMatchResult(retryMini, { matchId: retryMiniMatch.id, winner: "A", scoreA: 80, scoreB: 60 });
}
check("результат повторного матча завершает турнир", !!retryMiniMatch && retryMini.status === "done" && retryMini.matches[0].status === "error" && retryMini.matches[1].status === "done");

// 9. Тай-брейк: уникальный лидер завершает турнир без дополнительных матчей.
const decisiveTour = {
  status: "running",
  roster: ["a", "b"],
  statsById: {},
  matches: [{ id: "m-1", index: 1, a: "a", b: "b", stage: "main", tiebreakRound: null, status: "running", winner: null, scoreA: 0, scoreB: 0 }],
};
const decisive = recordTournamentMatchResult(decisiveTour, { matchId: "m-1", winner: "A", scoreA: 80, scoreB: 60 });
check("уникальный лидер после круга завершает турнир", decisive.status === "done" && decisive.matches.length === 1);

// 10. Тай-брейк: если первое место делят несколько участников, добавляется новый круг между лидерами.
let tiedTour = {
  status: "running",
  roster: ["a", "b", "c"],
  statsById: {},
  matches: [
    { id: "m-1", index: 1, a: "a", b: "b", stage: "main", tiebreakRound: null, status: "running", winner: null, scoreA: 0, scoreB: 0 },
    { id: "m-2", index: 2, a: "a", b: "c", stage: "main", tiebreakRound: null, status: "running", winner: null, scoreA: 0, scoreB: 0 },
    { id: "m-3", index: 3, a: "b", b: "c", stage: "main", tiebreakRound: null, status: "running", winner: null, scoreA: 0, scoreB: 0 },
  ],
};
tiedTour = recordTournamentMatchResult(tiedTour, { matchId: "m-1", winner: "draw", scoreA: 50, scoreB: 50 });
tiedTour = recordTournamentMatchResult(tiedTour, { matchId: "m-2", winner: "draw", scoreA: 50, scoreB: 50 });
tiedTour = recordTournamentMatchResult(tiedTour, { matchId: "m-3", winner: "draw", scoreA: 50, scoreB: 50 });
const tb1 = tiedTour.matches.filter((m) => m.stage === "tiebreak" && m.tiebreakRound === 1);
check("ничья лидеров добавляет дополнительный круг", tiedTour.status === "running" && tb1.length === 3);
check("матчи тай-брейка получают сквозные индексы", tb1.every((m) => m.index > 3 && m.id === `m-${m.index}`));

const matchByPair = (tourState, a, b, round) =>
  tourState.matches.find((m) => m.tiebreakRound === round && new Set([m.a, m.b]).size === 2 && [m.a, m.b].includes(a) && [m.a, m.b].includes(b));

const ab = matchByPair(tiedTour, "a", "b", 1);
const bc = matchByPair(tiedTour, "b", "c", 1);
const ac = matchByPair(tiedTour, "a", "c", 1);
check("первый дополнительный круг содержит все пары лидеров", !!ab && !!bc && !!ac);
if (ab && bc && ac) {
  tiedTour = recordTournamentMatchResult(tiedTour, { matchId: ab.id, winner: ab.a === "a" ? "A" : "B", scoreA: ab.a === "a" ? 80 : 60, scoreB: ab.b === "a" ? 80 : 60 });
  tiedTour = recordTournamentMatchResult(tiedTour, { matchId: bc.id, winner: bc.a === "c" ? "A" : "B", scoreA: bc.a === "c" ? 80 : 60, scoreB: bc.b === "c" ? 80 : 60 });
  tiedTour = recordTournamentMatchResult(tiedTour, { matchId: ac.id, winner: "draw", scoreA: 50, scoreB: 50 });
}
const tb2 = tiedTour.matches.filter((m) => m.stage === "tiebreak" && m.tiebreakRound === 2);
check("повторная ничья создаёт следующий круг только между текущими лидерами", tb2.length === 1 && [tb2[0].a, tb2[0].b].sort().join("|") === "a|c");
check("отставший после тай-брейка не попадает в следующий круг", tb2.length === 1 && ![tb2[0].a, tb2[0].b].includes("b"));

const finalTb = tb2[0];
if (finalTb) {
  tiedTour = recordTournamentMatchResult(tiedTour, { matchId: finalTb.id, winner: finalTb.a === "a" ? "A" : "B", scoreA: finalTb.a === "a" ? 80 : 60, scoreB: finalTb.b === "a" ? 80 : 60 });
}
const finalRows = tournamentStandings(tiedTour, [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }]);
check("турнир завершается после уникального победителя тай-брейка", tiedTour.status === "done" && finalRows[0].id === "a");

// 11. Backend worker: stale running recovery и выполнение queued-матчей без браузера.
const staleBase = {
  status: "running",
  closed: true,
  roster: ["a", "b", "c"],
  statsById: {},
  cursor: 0,
  matches: [
    { id: "m-1", index: 1, a: "a", b: "b", topicId: "tests_first", stage: "main", tiebreakRound: null, status: "running", winner: null, scoreA: 0, scoreB: 0, battleId: null, error: "", attempt: 1, startedAt: 1000 },
    { id: "m-2", index: 2, a: "a", b: "c", topicId: "sql_nosql", stage: "main", tiebreakRound: null, status: "running", winner: null, scoreA: 0, scoreB: 0, battleId: null, error: "", attempt: 1, startedAt: 9950 },
  ],
};
const recovered = recoverStaleMatches(staleBase, { now: 10000, timeoutMs: 5000 });
check("stale running матч становится superseded error", recovered.matches.find((m) => m.id === "m-1")?.status === "error" && !!recovered.matches.find((m) => m.id === "m-1")?.supersededBy);
check("fresh running матч остаётся running", recovered.matches.find((m) => m.id === "m-2")?.status === "running");
const workerRetry = recovered.matches.find((m) => m.retryOf === "m-1");
check("для stale running создаётся queued retry с attempt+1", workerRetry?.status === "queued" && workerRetry?.attempt === 2 && workerRetry?.a === "a" && workerRetry?.b === "b");

let workerState = {
  status: "running",
  closed: true,
  roster: ["a", "b"],
  statsById: { a: { battles: 0, points: 0 }, b: { battles: 0, points: 0 } },
  cursor: 0,
  matches: [{ id: "m-1", index: 1, a: "a", b: "b", topicId: "tests_first", stage: "main", tiebreakRound: null, status: "queued", winner: null, scoreA: 0, scoreB: 0, battleId: null, error: "", attempt: 1 }],
};
const workerEvents = [];
const worker = createTournamentWorker({
  now: () => 12345,
  timeoutMs: 5000,
  concurrency: 1,
  getTournament: () => workerState,
  saveTournament: (next) => { workerState = next; workerEvents.push(next); return next; },
  getAgent: (id) => ({ id, name: id, skills: ["aggressor"], config: {} }),
  getTopic: () => ({ id: "tests_first", title: "TDD vs Код сначала", sideA: "A", sideB: "B" }),
  runFight: async () => ({ winner: "A", scoreA: 80, scoreB: 60, history: { final: { winner: "A", score_a: 80, score_b: 60 } } }),
  saveBattle: async () => ({ battleId: 4242 }),
});
await worker.tick();
check("backend worker помечает queued матч running перед боем", workerEvents.some((state) => state.matches[0]?.status === "running" && state.matches[0]?.startedAt === 12345));
check("backend worker завершает матч и пишет battleId", workerState.matches[0].status === "done" && workerState.matches[0].battleId === 4242);
check("backend worker обновляет турнирную статистику", workerState.statsById.a.points === 4 && workerState.statsById.a.battles === 1);

let hungState = {
  status: "running",
  closed: true,
  roster: ["a", "b"],
  statsById: {},
  cursor: 0,
  matches: [{ id: "m-1", index: 1, a: "a", b: "b", topicId: "tests_first", stage: "main", tiebreakRound: null, status: "queued", winner: null, scoreA: 0, scoreB: 0, battleId: null, error: "", attempt: 1 }],
};
const hungWorker = createTournamentWorker({
  now: () => 555,
  timeoutMs: 1,
  concurrency: 1,
  getTournament: () => hungState,
  saveTournament: (next) => { hungState = next; return next; },
  getAgent: (id) => ({ id, name: id, skills: ["aggressor"], config: {} }),
  getTopic: () => ({ id: "tests_first", title: "TDD vs Код сначала", sideA: "A", sideB: "B" }),
  runFight: async () => new Promise(() => {}),
  saveBattle: async () => ({ battleId: 1 }),
});
const hungTick = await Promise.race([
  hungWorker.tick().then(() => "returned"),
  new Promise((resolve) => setTimeout(() => resolve("hung"), 50)),
]);
const hungRetry = hungState.matches.find((m) => m.retryOf === "m-1");
check("backend worker timeout возвращает управление, если бой завис", hungTick === "returned");
check("зависший бой уходит в error и получает retry", hungState.matches[0].status === "error" && hungRetry?.status === "queued");

// 12. Сброс турнира.
const reset = resetTournament();
check("сброс турнира → idle и приём открыт", reset.status === "idle" && reset.closed === false);

console.log(`\n  Итог: ${passed} прошло, ${failed} провалено`);
process.exit(failed ? 1 : 0);
