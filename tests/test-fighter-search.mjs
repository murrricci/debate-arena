// Юнит-тест поиска бойцов на экране арены: одно поле ищет и по нику, и по externalId.
import { filterFighters, fighterOptionLabel } from "../src/lib/fighterSearch.js";

let passed = 0, failed = 0;
const check = (name, cond) => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
};

console.log("\n=== TC-FIGHTER-SEARCH: поиск бойцов ===");

const people = [
  { id: "a", externalId: "1042", name: "Альфа", stats: { points: 7, wins: 2, losses: 1 }, skills: ["aggressor"] },
  { id: "b", externalId: "9988", name: "Бета", stats: { points: 3, wins: 1, losses: 2 }, skills: ["factualist"] },
  { id: "c", externalId: null, name: "Гамма 1042", stats: { points: 0, wins: 0, losses: 0 }, skills: ["rhetorician"] },
];

check("пустой запрос показывает всех доступных", filterFighters(people, "").length === 3);
check("поиск по нику регистронезависимый", filterFighters(people, "аль").map((p) => p.id).join(",") === "a");
check("поиск по externalId находит нужного бойца", filterFighters(people, "998").map((p) => p.id).join(",") === "b");
check("поиск по номеру принимает # и пробелы", filterFighters(people, " #9988 ").map((p) => p.id).join(",") === "b");
check("disabledId исключает уже выбранного бойца", filterFighters(people, "1042", "a").map((p) => p.id).join(",") === "c");
check("лейбл показывает номер пользователя", fighterOptionLabel(people[0]) === "Альфа · #1042 · 7 очк.");
check("лейбл без externalId не рисует пустой номер", fighterOptionLabel(people[2]) === "Гамма 1042 · 0 очк.");

console.log(`\n  Итог: ${passed} прошло, ${failed} провалено`);
process.exit(failed ? 1 : 0);
