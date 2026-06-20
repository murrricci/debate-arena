import assert from "node:assert/strict";
import { createServer } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const agents = [
  {
    id: "a",
    externalId: "1042",
    name: "Альфа",
    skills: ["aggressor"],
    stats: { wins: 2, losses: 0, draws: 0, battles: 2, points: 8 },
  },
  {
    id: "b",
    externalId: null,
    name: "Бета",
    skills: ["factualist"],
    stats: { wins: 1, losses: 1, draws: 0, battles: 2, points: 3 },
  },
];

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};
globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
};
globalThis.BroadcastChannel = class {
  postMessage() {}
  addEventListener() {}
  removeEventListener() {}
};
globalThis.fetch = async (url) => {
  if (url === "/api/agents") {
    return { ok: true, json: async () => ({ agents }) };
  }
  if (url === "/api/tournament") {
    return { ok: true, json: async () => ({ status: "idle", closed: false, roster: [], matches: [] }) };
  }
  throw new Error(`unexpected fetch ${url}`);
};

let passed = 0, failed = 0;
const check = (name, cond) => {
  try {
    assert.ok(cond);
    passed++;
    console.log(`  ✅ ${name}`);
  } catch {
    failed++;
    console.log(`  ❌ ${name}`);
  }
};

console.log("\n=== TC-SCOREBOARD-USER-NUMBER: номер пользователя в рейтинге ===");

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const { default: Scoreboard } = await vite.ssrLoadModule("/src/pages/Scoreboard.jsx");
  await new Promise((resolve) => setTimeout(resolve, 0));

  const markup = renderToStaticMarkup(React.createElement(Scoreboard));
  const text = markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  const rankHeader = text.indexOf("#");
  const userHeader = text.indexOf("№ ПОЛЬЗ.");
  const fighterHeader = text.indexOf("БОЕЦ");
  const userNumber = text.indexOf("#1042");
  const fighterName = text.indexOf("Альфа");
  const betaName = text.indexOf("Бета");
  const missingNumber = text.lastIndexOf("—", betaName);

  check("заголовок номера пользователя стоит между местом и бойцом", rankHeader !== -1 && rankHeader < userHeader && userHeader < fighterHeader);
  check("номер пользователя показывается перед именем агента", userNumber !== -1 && userNumber < fighterName);
  check("для агента без externalId показывается прочерк", betaName !== -1 && missingNumber !== -1 && missingNumber < betaName);
} finally {
  await vite.close();
}

console.log(`\n  Итог: ${passed} прошло, ${failed} провалено`);
process.exit(failed ? 1 : 0);
