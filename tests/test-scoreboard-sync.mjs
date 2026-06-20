// Проверяем backend-first cache рейтинга: browser localStorage не должен быть
// источником отображения и не должен менять cache через storage-событие.
const ls = {};
let storageListener = null;
const channelListeners = [];

const serverAlpha = {
  id: "a",
  name: "Альфа",
  skills: ["aggressor"],
  stats: { wins: 1, losses: 0, draws: 0, battles: 1, points: 4 },
};

globalThis.fetch = async (url) => {
  if (url === "/api/agents") {
    return {
      ok: true,
      json: async () => ({ agents: [serverAlpha] }),
    };
  }
  throw new Error(`unexpected fetch ${url}`);
};
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

const beta = {
  id: "b",
  name: "Бета",
  skills: ["factualist"],
  stats: { wins: 2, losses: 0, draws: 0, battles: 2, points: 8 },
};
ls["debate-arena:participants"] = JSON.stringify([beta]);

await new Promise((resolve) => setTimeout(resolve, 0));
check("первый рейтинг приходит из backend, не из localStorage", leaderboard()[0]?.name === "Альфа" && leaderboard()[0]?.stats.points === 4);

const gamma = {
  id: "g",
  name: "Гамма",
  skills: ["rhetorician"],
  stats: { wins: 3, losses: 0, draws: 0, battles: 3, points: 12 },
};
ls["debate-arena:participants"] = JSON.stringify([gamma]);
storageListener?.({ key: "debate-arena:participants" });
check("storage-событие localStorage не меняет backend-cache", leaderboard()[0]?.name === "Альфа" && leaderboard()[0]?.stats.points === 4);

channelListeners.forEach((handler) => handler({ data: { type: "participants", payload: [beta] } }));
check("BroadcastChannel остаётся live-инвалидацией cache между окнами", leaderboard()[0]?.name === "Бета" && leaderboard()[0]?.stats.points === 8);

console.log(`\n  Итог: ${passed} прошло, ${failed} провалено`);
process.exit(failed ? 1 : 0);
