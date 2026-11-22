import { resolveContentOrigin } from "./api-origins";

const MAX_MESSAGE_LEN = 320;
const MAX_STACK_LEN = 1100;
const MAX_ROUTE_LEN = 180;
const MAX_UA_LEN = 200;
const MAX_SERIALIZED_LEN = 2048;

export function buildClientErrorPayload(input: {
  route?: string;
  message?: string;
  stack?: string;
  digest?: string;
  userAgent?: string;
}): {
  route: string;
  message: string;
  stack?: string;
  digest?: string;
  userAgent?: string;
} {
  const route = (input.route || "/").slice(0, MAX_ROUTE_LEN);
  const message = (input.message || "Unexpected client runtime error").slice(0, MAX_MESSAGE_LEN);
  let stack = input.stack ? input.stack.slice(0, MAX_STACK_LEN) : undefined;
  const digest = input.digest ? input.digest.slice(0, 128) : undefined;
  const userAgent = input.userAgent ? input.userAgent.slice(0, MAX_UA_LEN) : undefined;
  const build = () => ({
    route,
    message,
    ...(stack ? { stack } : {}),
    ...(digest ? { digest } : {}),
    ...(userAgent ? { userAgent } : {}),
  });
  let payload = build();
  while (stack && JSON.stringify(payload).length > MAX_SERIALIZED_LEN) {
    stack = stack.length > 64 ? stack.slice(0, Math.floor(stack.length * 0.7)) : undefined;
    payload = build();
  }
  return payload;
}

export function sendClientErrorBeacon(error: Error & { digest?: string }): void {
  if (typeof window === "undefined" || typeof fetch !== "function") return;
  try {
    const origin = resolveContentOrigin();
    const route = `${window.location.pathname || "/"}${window.location.search ? "?" : ""}`.slice(0, MAX_ROUTE_LEN);
    const payload = buildClientErrorPayload({
      route,
      message: error?.message || error?.name || "Client runtime error",
      stack: error?.stack,
      digest: error?.digest,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
    });
    const serialized = JSON.stringify(payload);
    if (serialized.length > 2048) return;
    void fetch(`${origin}/api/v1/ops/client-errors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: serialized,
      credentials: "omit",
      keepalive: true,
    }).catch(() => {
      // Best-effort beacon: silently ignore network errors
    });
  } catch {
    // Never throw from an error boundary reporter
  }
}
