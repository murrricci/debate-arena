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

export function filterFighters(people = [], query = "", disabledId = "") {
  const q = normalize(query);
  return people.filter((fighter) => {
    if (fighter.id === disabledId) return false;
    if (!q) return true;
    const name = normalize(fighter.name);
    const externalId = normalize(fighter.externalId);
    return name.includes(q) || externalId.includes(q);
  });
}
