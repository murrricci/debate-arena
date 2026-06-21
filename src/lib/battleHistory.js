async function request(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  return data;
}

export function historyWithMode(history, mode, extra = {}) {
  return { ...(history || {}), mode, ...extra };
}

export async function fetchBattles({ query = "", limit = 100, tournamentOnly = false } = {}) {
  const params = new URLSearchParams();
  if (query.trim()) params.set("query", query.trim());
  if (tournamentOnly) params.set("tournament", "1");
  params.set("limit", String(limit));
  const data = await request(`/api/battles?${params.toString()}`);
  return Array.isArray(data?.battles) ? data.battles : [];
}

export async function fetchBattle(id) {
  return request(`/api/battles/${encodeURIComponent(id)}`);
}
