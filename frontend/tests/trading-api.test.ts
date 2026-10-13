import { test } from "node:test";
import assert from "node:assert/strict";
import { createGuestSession } from "../src/features/trading/api/guest-session";
import { parseGuest } from "../src/features/trading/api/contracts";
import { retryTradingQuery, tradingJson, TradingApiError } from "../src/features/trading/api/client";

const origin = "http://trade.example";
const guest = (accountId = 1) => ({ accountId, status: "ACTIVE", quoteAsset: "USDT", initialBalance: "10000.000000000000000001",
  accessToken: `guest_${String(accountId).repeat(43)}`, tokenType: "Bearer", expiresAt: "2099-01-01T00:00:00Z" });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

test("guest bootstrap is single-flight and refresh reuses persisted identity", async () => {
  const storage = memoryStorage(); let creates = 0;
  const transport: typeof fetch = async () => { creates++; return json(guest()); };
  const session = createGuestSession(origin, () => storage, transport);
  await Promise.all([session.ensure(), session.ensure(), session.ensure()]);
  assert.equal(creates, 1);
  assert.equal(session.getSnapshot().accountId, 1);
  const refreshed = createGuestSession(origin, () => storage, transport);
  await refreshed.ensure();
  assert.equal(refreshed.getSnapshot().accountId, 1);
  assert.equal(creates, 1);
  assert.equal(JSON.stringify(session.getSnapshot()).includes(guest().accessToken), false);
});

test("expired and corrupt storage are replaced; blocked storage never creates guests", async () => {
  for (const stored of ["broken", JSON.stringify({ ...guest(), expiresAt: "2000-01-01T00:00:00Z" })]) {
    const storage = memoryStorage(); storage.setItem(`yogimangchi.guest.v1:${origin}`, stored);
    let count = 0;
    const session = createGuestSession(origin, () => storage, async () => { count++; return json(guest(2)); });
    await session.ensure(); assert.equal(count, 1); assert.equal(session.getSnapshot().accountId, 2);
  }
  let count = 0;
  const blocked = createGuestSession(origin, () => { throw new Error("denied"); }, async () => { count++; return json(guest()); });
  await blocked.ensure(); assert.equal(count, 0); assert.equal(blocked.getSnapshot().phase, "error");
});

test("concurrent 401 responses recreate once and a second invalid credential stops recovery", async () => {
  let creates = 0;
  const session = createGuestSession(origin, memoryStorage, async (_url, options) => {
    if (options?.method === "POST") return json(guest(++creates));
    return json({ detail: "never exposed" }, 401);
  });
  await session.ensure();
  const old = session.getSnapshot();
  await Promise.allSettled([session.read("account/summary", old, new AbortController().signal), session.read("account/orders/pending", old, new AbortController().signal)]);
  assert.equal(creates, 2); assert.equal(session.getSnapshot().accountId, 2);
  await assert.rejects(session.read("account/summary", session.getSnapshot(), new AbortController().signal));
  assert.equal(session.getSnapshot().phase, "error");
  await session.ensure(); await session.ensure();
  assert.equal(creates, 2);
});

test("late old-account success cannot overwrite a recovered identity", async () => {
  let release!: (response: Response) => void; let creates = 0;
  const storage = memoryStorage();
  const session = createGuestSession(origin, () => storage, async (url, options) => {
    if (options?.method === "POST") return json(guest(++creates));
    if (String(url).endsWith("summary")) return new Promise<Response>((resolve) => { release = resolve; });
    return json({}, 401);
  });
  await session.ensure(); const old = session.getSnapshot();
  const late = session.read("account/summary", old, new AbortController().signal);
  await assert.rejects(session.read("account/orders/pending", old, new AbortController().signal));
  release(json({ accountId: 1 }));
  await assert.rejects(late, { name: "AbortError" });
});

test("Bearer goes only in the header and server/network errors never expose credentials", async () => {
  const token = guest().accessToken;
  for (const networkFailure of [false, true]) {
    await assert.rejects(tradingJson(origin, "account/summary", { token }, async (url, options) => {
      assert.equal(String(url).includes(token), false);
      assert.equal((options?.headers as Record<string, string>).Authorization, `Bearer ${token}`);
      assert.equal(options?.credentials, "omit");
      assert.equal(options?.redirect, "error");
      if (networkFailure) throw new Error(token);
      return json({ detail: token }, 503);
    }), (error: unknown) => error instanceof TradingApiError && !String(error).includes(token) && !JSON.stringify(error).includes(token));
  }
});

test("read retry is bounded and does not retry auth, client or contract errors", () => {
  for (const code of [0, 500, 502, 503, 504]) { assert.equal(retryTradingQuery(1, new TradingApiError(code)), true); assert.equal(retryTradingQuery(2, new TradingApiError(code)), false); }
  for (const code of [400, 401, 403, 404, 409, 422]) assert.equal(retryTradingQuery(0, new TradingApiError(code)), false);
  assert.equal(retryTradingQuery(0, new DOMException("cancelled", "AbortError")), false);
});

test("guest parser rejects unsafe identity, invalid credential and numeric money", () => {
  assert.equal(parseGuest(guest()).accountId, 1);
  for (const value of [{ ...guest(), accountId: Number.MAX_SAFE_INTEGER + 1 }, { ...guest(), accessToken: "invalid" }, { ...guest(), initialBalance: 10000 }]) assert.throws(() => parseGuest(value));
});

test("failed recreation stops automatically and manual retry remains single-flight", async () => {
  let creates = 0;
  const storage = memoryStorage();
  const session = createGuestSession(origin, () => storage, async (_url, options) => {
    if (options?.method === "POST") { creates++; return creates === 2 ? json({}, 503) : json(guest(creates)); }
    return json({}, 401);
  });
  await session.ensure();
  await assert.rejects(session.read("account/summary", session.getSnapshot(), new AbortController().signal));
  assert.equal(session.getSnapshot().phase, "error");
  await session.ensure(); assert.equal(creates, 2);
  await Promise.all([session.retry(), session.retry()]); assert.equal(creates, 3);
});

test("caller cancellation is forwarded and never retries or recreates a guest", async () => {
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(tradingJson(origin, "account/summary", { signal: abort.signal }, async (_url, options) => {
    assert.equal(options?.signal?.aborted, true);
    throw new DOMException("aborted", "AbortError");
  }), { name: "AbortError" });
});
