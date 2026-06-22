import { MAX_WARMUP_BATTLES } from "./scoring.js";

function normalize(value) {
  return String(value ?? "").trim().replace(/^#/, "").toLowerCase();
}

export function fighterOptionLabel(fighter) {
  if (!fighter) return "";
  const parts = [fighter.name];
  if (fighter.externalId) parts.push(`#${fighter.externalId}`);
  parts.push(`${fighter.stats?.points ?? 0} очк.`);
  return parts.join(" · ");
}

export function filterFighters(people = [], query = "", disabledId = "", options = {}) {
  const q = normalize(query);
  return people.filter((fighter) => {
    if (fighter.id === disabledId) return false;
    if (options.onlyWarmupAvailable && (fighter.stats?.battles || 0) >= MAX_WARMUP_BATTLES) return false;
    if (!q) return true;
    const name = normalize(fighter.name);
    const externalId = normalize(fighter.externalId);
    return name.includes(q) || externalId.includes(q);
  });
}
