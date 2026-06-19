// Юнит-тест прод-настроек vite preview (host + allowedHosts), без сети и без сборки.
// Дёргаем фабрику конфига напрямую и проверяем разрешённые хосты по ALLOWED_HOSTS.
import configFactory from "../vite.config.js";

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
}
const resolve = () => configFactory({ mode: "production", command: "serve" });

console.log("\n=== TC-PREVIEW: прод-настройки vite preview ===");

// 1. Без ALLOWED_HOSTS — слушаем 0.0.0.0 и разрешаем любые хосты (локальный npm start).
delete process.env.ALLOWED_HOSTS;
let cfg = resolve();
check("host=true (bind 0.0.0.0)", cfg.preview.host === true);
check("allowedHosts=true когда ALLOWED_HOSTS пуст", cfg.preview.allowedHosts === true);

// 2. С одним доменом — ровно он в списке.
process.env.ALLOWED_HOSTS = "arena.gpb-dev.ru";
cfg = resolve();
check("один домен → [arena.gpb-dev.ru]",
  Array.isArray(cfg.preview.allowedHosts) &&
  cfg.preview.allowedHosts.length === 1 &&
  cfg.preview.allowedHosts[0] === "arena.gpb-dev.ru");

// 3. Список через запятую с пробелами — триммится и бьётся по элементам.
process.env.ALLOWED_HOSTS = "arena.gpb-dev.ru, foo.local";
cfg = resolve();
check("список → [arena.gpb-dev.ru, foo.local]",
  JSON.stringify(cfg.preview.allowedHosts) === JSON.stringify(["arena.gpb-dev.ru", "foo.local"]));

delete process.env.ALLOWED_HOSTS;
console.log(`\n  Итого: ${passed} ✅ / ${failed} ❌`);
process.exit(failed ? 1 : 0);
