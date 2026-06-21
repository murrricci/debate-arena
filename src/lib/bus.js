// Шина между окнами (арена и табло) на одной машине: BroadcastChannel.
// Если канал недоступен — тихо деградируем (события просто не рассылаются между окнами).
const CHANNEL = "debate-arena";

let channel = null;
if (typeof BroadcastChannel !== "undefined") {
  channel = new BroadcastChannel(CHANNEL);
}

const localHandlers = new Set();

export function publish(type, payload) {
  for (const handler of localHandlers) handler(type, payload);
  if (channel) channel.postMessage({ type, payload });
}

export function subscribe(handler) {
  localHandlers.add(handler);
  if (!channel) return () => localHandlers.delete(handler);
  const listener = (e) => handler(e.data?.type, e.data?.payload);
  channel.addEventListener("message", listener);
  return () => {
    localHandlers.delete(handler);
    channel.removeEventListener("message", listener);
  };
}
