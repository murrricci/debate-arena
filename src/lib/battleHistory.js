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

export async function saveTournamentBattle({ A, B, topic, result, match }) {
  return request("/api/battles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      aId: A.id,
      bId: B.id,
      winner: result.winner,
      scoreA: result.scoreA,
      scoreB: result.scoreB,
      topic: topic.title,
      tournament: true,
      history: historyWithMode(result.history, "tournament", { matchId: match?.id ?? null, matchIndex: match?.index ?? null }),
    }),
  });
}

export async function fetchBattles({ query = "", limit = 100 } = {}) {
  const params = new URLSearchParams();
  if (query.trim()) params.set("query", query.trim());
  params.set("limit", String(limit));
  const data = await request(`/api/battles?${params.toString()}`);
  return Array.isArray(data?.battles) ? data.battles : [];
}

export async function fetchBattle(id) {
  return request(`/api/battles/${encodeURIComponent(id)}`);
}
