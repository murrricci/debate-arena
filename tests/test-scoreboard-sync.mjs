// Проверяем синхронизацию рейтинга между окнами: табло/scoreboard должно видеть
// обновлённый cache участников сразу после BroadcastChannel/storage-события.
const ls = {};
let storageListener = null;
const channelListeners = [];

globalThis.fetch = undefined;
globalThis.localStorage = {
  getItem: (key) => (key in ls ? ls[key] : null),
  setItem: (key, value) => { ls[key] = String(value); },
  removeItem: (key) => { delete ls[key]; },
};
globalThis.window = {
  addEventListener: (type, handler) => {
    if (type === "storage") storageListener = handler;
  },
  removeEventListener: () => {},
};
globalThis.BroadcastChannel = class {
  postMessage() {}
  addEventListener(type, handler) {
    if (type === "message") channelListeners.push(handler);
  }
  removeEventListener() {}
};

const { leaderboard } = await import("../src/lib/store.js");

let passed = 0, failed = 0;
const check = (name, cond) => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
};

console.log("\n=== TC-SCOREBOARD-SYNC: live-обновление рейтинга ===");

const alpha = {
  id: "a",
  name: "Альфа",
  skills: ["aggressor"],
  stats: { wins: 1, losses: 0, draws: 0, battles: 1, points: 4 },
};
channelListeners.forEach((handler) => handler({ data: { type: "participants", payload: [alpha] } }));
check("BroadcastChannel обновляет cache рейтинга без перезагрузки", leaderboard()[0]?.name === "Альфа" && leaderboard()[0]?.stats.points === 4);

const beta = {
  id: "b",
  name: "Бета",
  skills: ["factualist"],
  stats: { wins: 2, losses: 0, draws: 0, battles: 2, points: 8 },
};
ls["debate-arena:participants"] = JSON.stringify([beta]);
storageListener?.({ key: "debate-arena:participants" });
check("storage-событие перечитывает cache рейтинга без перезагрузки", leaderboard()[0]?.name === "Бета" && leaderboard()[0]?.stats.points === 8);

console.log(`\n  Итог: ${passed} прошло, ${failed} провалено`);
process.exit(failed ? 1 : 0);
