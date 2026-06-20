const inBrowser = typeof window !== "undefined" && typeof fetch === "function";

async function request(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

export async function fetchLiveSnapshot() {
  if (!inBrowser) return null;
  const data = await request("/api/live");
  return data?.live ?? null;
}

export function publishLiveSnapshot(snapshot) {
  if (!inBrowser) return Promise.resolve(null);
  return request("/api/live", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(snapshot || null),
  }).then((data) => data?.live ?? null);
}

export function clearLiveSnapshot() {
  if (!inBrowser) return Promise.resolve(null);
  return request("/api/live", { method: "DELETE" }).then((data) => data?.live ?? null);
}

export function subscribeLiveSnapshot(handler) {
  if (!inBrowser) return () => {};
  if (typeof EventSource !== "undefined") {
    const source = new EventSource("/api/live/events");
    source.addEventListener("live", (event) => {
      try {
        const data = JSON.parse(event.data);
        handler(data?.live ?? null);
      } catch { /* ignore malformed SSE */ }
    });
    return () => source.close();
  }

  let stopped = false;
  const poll = async () => {
    try {
      if (!stopped) handler(await fetchLiveSnapshot());
    } catch { /* keep current snapshot */ }
  };
  const timer = setInterval(poll, 1000);
  poll();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
