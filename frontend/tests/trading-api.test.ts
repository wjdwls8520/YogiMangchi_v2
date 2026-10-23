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

test("restore never creates a guest; explicit creation is single-flight and refresh reuses identity", async () => {
  const storage = memoryStorage(); let creates = 0;
  const transport: typeof fetch = async () => { creates++; return json(guest()); };
  const session = createGuestSession(origin, () => storage, transport);
  await Promise.all([session.restore(), session.restore(), session.restore()]);
  assert.equal(creates, 0); assert.equal(session.getSnapshot().phase, "anonymous");
  await Promise.all([session.createGuest(), session.createGuest(), session.createGuest()]);
  assert.equal(creates, 1);
  assert.equal(session.getSnapshot().accountId, 1);
  const refreshed = createGuestSession(origin, () => storage, transport);
  await refreshed.restore();
  assert.equal(refreshed.getSnapshot().accountId, 1);
  assert.equal(creates, 1);
  assert.equal(JSON.stringify(session.getSnapshot()).includes(guest().accessToken), false);
});

test("expired and corrupt storage become anonymous; blocked storage never creates guests", async () => {
  for (const stored of ["broken", JSON.stringify({ ...guest(), expiresAt: "2000-01-01T00:00:00Z" })]) {
    const storage = memoryStorage(); storage.setItem(`yogimangchi.guest.v1:${origin}`, stored);
    let count = 0;
    const session = createGuestSession(origin, () => storage, async () => { count++; return json(guest(2)); });
    await session.restore(); assert.equal(count, 0); assert.equal(session.getSnapshot().phase, "anonymous");
    assert.equal(storage.getItem(session.storageKey), null);
  }
  let count = 0;
  const blocked = createGuestSession(origin, () => { throw new Error("denied"); }, async () => { count++; return json(guest()); });
  await blocked.restore(); assert.equal(count, 0); assert.equal(blocked.getSnapshot().phase, "error");
  await blocked.createGuest(); assert.equal(count, 0); assert.equal(blocked.getSnapshot().phase, "anonymous");
});

test("concurrent 401 responses clear the credential without automatic recreation", async () => {
  let creates = 0;
  const storage = memoryStorage();
  const session = createGuestSession(origin, () => storage, async (_url, options) => {
    if (options?.method === "POST") return json(guest(++creates));
    return json({ detail: "never exposed" }, 401);
  });
  await session.createGuest();
  const old = session.getSnapshot();
  await Promise.allSettled([session.read("account/summary", old, new AbortController().signal), session.read("account/orders/pending", old, new AbortController().signal)]);
  assert.equal(creates, 1); assert.equal(session.getSnapshot().accountId, null);
  await assert.rejects(session.read("account/summary", session.getSnapshot(), new AbortController().signal));
  assert.equal(session.getSnapshot().phase, "anonymous");
  assert.equal(storage.getItem(session.storageKey), null);
  await session.restore(); await session.restore();
  assert.equal(creates, 1);
  await session.createGuest(); assert.equal(creates, 2);
});

test("late old-account success cannot overwrite a recovered identity", async () => {
  let release!: (response: Response) => void; let creates = 0;
  const storage = memoryStorage();
  const session = createGuestSession(origin, () => storage, async (url, options) => {
    if (options?.method === "POST") return json(guest(++creates));
    if (String(url).endsWith("summary")) return new Promise<Response>((resolve) => { release = resolve; });
    return json({}, 401);
  });
  await session.createGuest(); const old = session.getSnapshot();
  const late = session.read("account/summary", old, new AbortController().signal);
  await assert.rejects(session.read("account/orders/pending", old, new AbortController().signal));
  await session.createGuest(); assert.equal(session.getSnapshot().accountId, 2);
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
      return json({ code: token, detail: token, message: token, accessToken: token, headers: { Authorization: `Bearer ${token}` }, instance: `${origin}/${token}` }, 503);
    }), (error: unknown) => error instanceof TradingApiError && !String(error).includes(token) && !JSON.stringify(error).includes(token));
  }
});

test("read retry is bounded and does not retry auth, client or contract errors", () => {
  for (const code of [0, 500, 502, 503, 504]) { assert.equal(retryTradingQuery(1, new TradingApiError(code)), true); assert.equal(retryTradingQuery(2, new TradingApiError(code)), false); }
  for (const code of [400, 401, 403, 404, 409, 422]) assert.equal(retryTradingQuery(0, new TradingApiError(code)), false);
  assert.equal(retryTradingQuery(0, new DOMException("cancelled", "AbortError")), false);
});

test("only HTTP 409 TRADING_BUSY is a bounded retryable conflict", async () => {
  for (const code of ["TRADING_BUSY", "INSUFFICIENT_MARGIN", "ACCOUNT_AT_RISK", "IDEMPOTENCY_CONFLICT", "POSITION_NOT_OPEN", "OTHER_CONFLICT", undefined]) {
    await assert.rejects(tradingJson(origin, "account/summary", {}, async () => json({ status: 409, code }, 409)), (error: unknown) => {
      assert.ok(error instanceof TradingApiError);
      assert.equal(error.status, 409);
      assert.equal(error.code, code === "OTHER_CONFLICT" ? undefined : code);
      assert.equal(retryTradingQuery(0, error), code === "TRADING_BUSY");
      assert.equal(retryTradingQuery(1, error), code === "TRADING_BUSY");
      assert.equal(retryTradingQuery(2, error), false);
      return true;
    });
  }
  for (const status of [400, 401, 403, 404, 422]) assert.equal(retryTradingQuery(0, new TradingApiError(status, undefined, "TRADING_BUSY")), false);
});

test("unreadable or malformed ProblemDetail keeps the HTTP status and cannot enable conflict retries", async () => {
  for (const body of ["invalid JSON", "null", "[]", '{"code":409}', '{"properties":{"code":"TRADING_BUSY"}}']) {
    for (const status of [409, 503]) {
      await assert.rejects(tradingJson(origin, "account/summary", {}, async () => new Response(body, { status })), (error: unknown) => {
        assert.ok(error instanceof TradingApiError);
        assert.equal(error.status, status);
        assert.equal(error.code, undefined);
        assert.equal(retryTradingQuery(0, error), status === 503);
        return true;
      });
    }
  }
});

test("a recognized busy code never exposes sensitive ProblemDetail fields or trusts its body status", async () => {
  const token = guest().accessToken;
  await assert.rejects(tradingJson(origin, "account/summary", { token }, async () => json({ code: "TRADING_BUSY", status: 500, detail: token, message: token, accessToken: token, instance: `${origin}/${token}` }, 409)), (error: unknown) => {
    assert.ok(error instanceof TradingApiError);
    assert.equal(error.status, 409);
    assert.equal(error.code, "TRADING_BUSY");
    assert.equal(String(error).includes(token), false);
    assert.equal(JSON.stringify(error, Object.getOwnPropertyNames(error)).includes(token), false);
    return true;
  });
});

test("guest parser rejects unsafe identity, invalid credential and numeric money", () => {
  assert.equal(parseGuest(guest()).accountId, 1);
  for (const value of [{ ...guest(), accountId: Number.MAX_SAFE_INTEGER + 1 }, { ...guest(), accessToken: "invalid" }, { ...guest(), initialBalance: 10000 }]) assert.throws(() => parseGuest(value));
});

test("failed creation stays anonymous without automatic retry; manual retry is single-flight", async () => {
  let creates = 0;
  const storage = memoryStorage();
  const session = createGuestSession(origin, () => storage, async (_url, options) => {
    if (options?.method === "POST") { creates++; return creates === 1 ? json({}, 503) : json(guest(creates)); }
    return json({}, 401);
  });
  await session.restore(); assert.equal(creates, 0);
  await session.createGuest(); assert.equal(creates, 1);
  assert.equal(session.getSnapshot().phase, "anonymous");
  assert.equal(storage.getItem(session.storageKey), null);
  await session.restore(); assert.equal(creates, 1);
  await Promise.all([session.createGuest(), session.createGuest()]); assert.equal(creates, 2);
});

test("caller cancellation is forwarded and never retries or recreates a guest", async () => {
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(tradingJson(origin, "account/summary", { signal: abort.signal }, async (_url, options) => {
    assert.equal(options?.signal?.aborted, true);
    throw new DOMException("aborted", "AbortError");
  }), { name: "AbortError" });
});
