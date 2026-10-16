import { test } from "node:test";
import assert from "node:assert/strict";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient } from "@tanstack/react-query";
import { createGuestSession } from "../src/features/trading/api/guest-session";
import { tradingKeys } from "../src/features/trading/api/query-keys";
import { bindGuestCache } from "../src/features/trading/components/trading-data-provider";
import { GuestEntryPrompt, GuestStartDialog } from "../src/features/trading/components/guest-access";

const origin = "http://trade.example", key = `yogimangchi.guest.v1:${origin}`;
const epoch = Date.parse("2026-10-17T00:00:00Z");
const guest = (accountId = 1, expiresAt = new Date(epoch + 7 * 86400000).toISOString()) => ({ accountId, status: "ACTIVE", quoteAsset: "USDT",
  initialBalance: "10000", accessToken: `guest_${String(accountId).repeat(43)}`, tokenType: "Bearer", expiresAt });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function memory() {
  const map = new Map<string, string>();
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } };
}
const command = { kind: "open" as const, tradingSymbolId: 1, type: "MARKET" as const, side: "LONG" as const, quantity: "0.001", leverage: 10 };

test("anonymous reads and mutations cannot send authenticated requests or implicitly create a Guest", async () => {
  let calls = 0;
  const local = memory(), session = createGuestSession(origin, () => local, async () => { calls++; return json(guest()); }, () => epoch);
  await session.restore();
  const identity = session.getSnapshot();
  await assert.rejects(session.read("account/summary", identity, new AbortController().signal), { name: "AbortError" });
  await assert.rejects(session.write(command, identity, "order-key-0001"));
  assert.equal(calls, 0); assert.equal(identity.phase, "anonymous");
});

test("valid legacy sessionStorage migrates once and new page instances restore localStorage without POST", async () => {
  const local = memory(), legacy = memory(); let calls = 0;
  legacy.setItem(key, JSON.stringify(guest()));
  const transport: typeof fetch = async () => { calls++; return json({}); };
  const session = createGuestSession(origin, () => local, transport, () => epoch, () => legacy);
  await session.restore();
  assert.equal(session.getSnapshot().accountId, 1); assert.equal(legacy.getItem(key), null);
  assert.equal(JSON.parse(local.getItem(key)!).expiresAt, guest().expiresAt);
  const identity = session.getSnapshot();
  await session.restore(); assert.deepEqual(session.getSnapshot(), identity);
  const reopened = createGuestSession(origin, () => local, transport, () => epoch);
  await reopened.restore(); assert.equal(reopened.getSnapshot().accountId, 1); assert.equal(calls, 0);
  assert.equal(JSON.stringify(identity).includes(guest().accessToken), false);
});

test("localStorage wins over a legacy Guest and legacy data cannot resurrect an invalid local identity", async () => {
  for (const value of [JSON.stringify(guest(2)), "broken", JSON.stringify(guest(2, new Date(epoch).toISOString()))]) {
    const local = memory(), legacy = memory(); local.setItem(key, value); legacy.setItem(key, JSON.stringify(guest()));
    let calls = 0;
    const session = createGuestSession(origin, () => local, async () => { calls++; return json({}); }, () => epoch, () => legacy);
    await session.restore();
    assert.equal(session.getSnapshot().accountId, value === JSON.stringify(guest(2)) ? 2 : null);
    assert.equal(legacy.getItem(key), null); await session.restore(); assert.equal(calls, 0);
  }
});

test("expired or malformed legacy credentials are discarded without creation", async () => {
  for (const value of ["broken", JSON.stringify(guest(1, new Date(epoch - 1).toISOString()))]) {
    const local = memory(), legacy = memory(); legacy.setItem(key, value);
    const session = createGuestSession(origin, () => local, async () => { assert.fail("No HTTP expected"); }, () => epoch, () => legacy);
    await session.restore(); assert.equal(session.getSnapshot().phase, "anonymous");
    assert.equal(legacy.getItem(key), null); assert.equal(local.getItem(key), null);
  }
});

test("failed migration preserves the legacy credential and never POSTs when persistence is denied", async () => {
  const legacy = memory(); legacy.setItem(key, JSON.stringify(guest()));
  const local = { ...memory(), setItem: () => { throw new Error("storage denied"); } };
  const session = createGuestSession(origin, () => local, async () => { assert.fail("No HTTP expected"); }, () => epoch, () => legacy);
  await session.restore(); assert.equal(session.getSnapshot().phase, "error");
  assert.ok(legacy.getItem(key));
  await session.createGuest(); assert.equal(session.getSnapshot().phase, "anonymous"); assert.ok(legacy.getItem(key));
});

test("creation publishes creating, shares concurrent clicks, persists before ready and never replaces a ready Guest", async () => {
  const local = memory(); let calls = 0, release!: (value: Response) => void;
  const session = createGuestSession(origin, () => local, async () => { calls++; return new Promise((resolve) => { release = resolve; }); }, () => epoch);
  await session.restore();
  const phases: string[] = [];
  session.subscribe(() => { const value = session.getSnapshot(); phases.push(value.phase); if (value.phase === "ready") assert.ok(local.getItem(key)); });
  const one = session.createGuest(), two = session.createGuest(); assert.equal(one, two);
  await Promise.resolve(); assert.equal(session.getSnapshot().phase, "creating"); assert.equal(calls, 1);
  release(json(guest())); await one;
  assert.deepEqual(phases, ["creating", "ready"]);
  await session.createGuest(); assert.equal(calls, 1);
});

test("malformed, expired and unsuccessful create responses leave anonymous without storing a credential", async () => {
  for (const response of [json({}, 503), json({ ...guest(), accessToken: "bad" }), json(guest(1, new Date(epoch).toISOString()))]) {
    const local = memory(); let calls = 0;
    const session = createGuestSession(origin, () => local, async () => { calls++; return response; }, () => epoch);
    await session.createGuest(); assert.equal(calls, 1); assert.equal(session.getSnapshot().phase, "anonymous");
    assert.equal(local.getItem(key), null); await session.restore(); assert.equal(calls, 1);
  }
});

for (const operation of ["read", "write"] as const) test(`seven-day expiry at ${operation} clears credentials without a request or recreation`, async () => {
  const local = memory(); let now = epoch, calls = 0;
  const session = createGuestSession(origin, () => local, async () => { calls++; return json(guest()); }, () => now);
  await session.createGuest(); const old = session.getSnapshot();
  now += 7 * 86400000;
  await assert.rejects(operation === "read" ? session.read("account/summary", old, new AbortController().signal) : session.write(command, old, "order-key-0001"));
  assert.equal(session.getSnapshot().phase, "anonymous"); assert.equal(local.getItem(key), null);
  await session.restore(); assert.equal(calls, 1);
});

test("a late old-tab 401 cannot delete a new localStorage Guest; restore changes identity without POST", async () => {
  const local = memory(); local.setItem(key, JSON.stringify(guest()));
  let release!: (value: Response) => void, calls = 0;
  const session = createGuestSession(origin, () => local, async () => { calls++; return new Promise(resolve => { release = resolve; }); }, () => epoch);
  await session.restore(); const old = session.getSnapshot();
  const pending = session.read("account/summary", old, new AbortController().signal);
  local.setItem(key, JSON.stringify(guest(2))); release(json({}, 401)); await assert.rejects(pending);
  assert.equal(JSON.parse(local.getItem(key)!).accountId, 2);
  await session.restore(); assert.equal(session.getSnapshot().accountId, 2); assert.equal(calls, 1);
  assert.notEqual(session.getSnapshot().generation, old.generation);
  local.removeItem(key); await session.restore(); assert.equal(session.getSnapshot().phase, "anonymous");
});

test("late old-account write success cannot become the new Guest's mutation result", async () => {
  const local = memory(); local.setItem(key, JSON.stringify(guest()));
  let release!: (value: Response) => void;
  const session = createGuestSession(origin, () => local, async () => new Promise(resolve => { release = resolve; }), () => epoch);
  await session.restore(); const pending = session.write(command, session.getSnapshot(), "order-key-0001");
  local.setItem(key, JSON.stringify(guest(2))); await session.restore();
  release(json({})); await assert.rejects(pending, { name: "AbortError" });
  assert.equal(session.getSnapshot().accountId, 2);
});

test("401 cancels and removes old account queries and mutations, retaining public market cache", async () => {
  const local = memory(); local.setItem(key, JSON.stringify(guest()));
  const client = new QueryClient();
  const session = createGuestSession(origin, () => local, async () => json({}, 401), () => epoch);
  const unsubscribe = bindGuestCache(client, session);
  try {
    await session.restore(); const old = session.getSnapshot();
    for (const queryKey of [tradingKeys.summary(old), tradingKeys.history(old)]) client.setQueryData(queryKey, { oldAccount: 1 });
    client.setQueryData(["market", origin, "tickers"], ["public"]);
    let cancelled = false;
    const pending = client.fetchQuery({ queryKey: tradingKeys.pending(old), queryFn: ({ signal }) => new Promise(() => { signal.addEventListener("abort", () => { cancelled = true; }); }) });
    void pending.catch(() => {});
    await client.getMutationCache().build(client, { mutationFn: async () => "old result" }).execute(undefined);
    await assert.rejects(session.read("account/summary", old, new AbortController().signal));
    assert.equal(cancelled, true); assert.equal(client.getQueryCache().findAll({ queryKey: ["trading-account"] }).length, 0);
    assert.equal(client.getMutationCache().getAll().length, 0);
    assert.deepEqual(client.getQueryData(["market", origin, "tickers"]), ["public"]);
    local.setItem(key, JSON.stringify(guest(2))); await session.restore();
    assert.equal(client.getQueryData(tradingKeys.summary(session.getSnapshot())), undefined);
    assert.equal(client.getQueryData(tradingKeys.summary(old)), undefined);
  } finally { unsubscribe(); client.clear(); }
});

test("Guest dialog explains virtual funds and retention, with disabled create/cancel during creation", () => {
  const html = renderToStaticMarkup(<GuestStartDialog dialogRef={createRef()} creating failed onStart={() => {}} onCancel={() => {}} onClose={() => {}} />);
  assert.match(html, /10,000 USDT/); assert.match(html, /실제 자금 없이/); assert.match(html, /최대 7일/); assert.match(html, /복구할 수 없습니다/);
  assert.equal((html.match(/disabled=""/g) ?? []).length, 2); assert.match(html, /role="alert"/); assert.match(html, /계정 생성 중/);
  const prompt = renderToStaticMarkup(<GuestEntryPrompt onStart={() => {}} busy={false} storageError={false} />);
  assert.match(prompt, /게스트로 모의투자 시작/); assert.doesNotMatch(prompt, /<input/);
});
