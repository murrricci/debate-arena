// Шина между окнами (арена и табло) на одной машине: BroadcastChannel.
// Если канал недоступен — тихо деградируем (события просто не рассылаются между окнами).
const CHANNEL = "debate-arena";

let channel = null;
if (typeof BroadcastChannel !== "undefined") {
  channel = new BroadcastChannel(CHANNEL);
}

export function publish(type, payload) {
  if (channel) channel.postMessage({ type, payload });
}

export function subscribe(handler) {
  if (!channel) return () => {};
  const listener = (e) => handler(e.data?.type, e.data?.payload);
  channel.addEventListener("message", listener);
  return () => channel.removeEventListener("message", listener);
}
