import { test } from "node:test";
import assert from "node:assert/strict";
import { createGuestSession } from "../src/features/trading/api/guest-session";
import { TradingApiError } from "../src/features/trading/api/client";
const origin = "http://localhost:8081", epoch = Date.parse("2026-10-23T00:00:00Z");
const guest = { accountId: 20, accessToken: `guest_${"a".repeat(43)}`, expiresAt: new Date(epoch + 86400000).toISOString() };
const member = { memberId: 1, accessToken: "header.payload.member", expiresAt: new Date(epoch + 900000).toISOString() };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const round = { round: { roundId: 1, currentRound: true, status: "ACTIVE" } };
function memory() {
  const values = new Map([[`yogimangchi.guest.v1:${origin}`, JSON.stringify(guest)]]);
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
test("member account is never implicitly created and Guest remains recoverable after logout", async () => {
  const storage = memory(), calls: string[] = [];
  const session = createGuestSession(origin, () => storage, async (url, options) => {
    const path = new URL(String(url)).pathname; calls.push(`${options?.method} ${path}`);
    assert.equal(new Headers(options?.headers).get("Authorization"), `Bearer ${member.accessToken}`);
    return path.endsWith("rounds/current") ? response(round) : path.endsWith("accounts/member") ? response({ accountId: 21, memberId: 1, status: "ACTIVE", quoteAsset: "USDT", balance: "10000" }) : response({}, 404);
  }, () => epoch);
  await session.restore(); const guestSnapshot = session.getSnapshot(); assert.equal(guestSnapshot.accountId, 20);
  session.pauseMemberCheck();
  await session.enterMember(member, () => {});
  assert.equal(session.getSnapshot().mode, "member"); assert.equal(session.getSnapshot().phase, "anonymous");
  assert.equal(calls.some(call => call.startsWith("POST")), false);
  await session.createGuest(); assert.equal(calls.length, 1);
  await Promise.all([session.createMember(), session.createMember()]);
  assert.equal(calls.filter(call => call.startsWith("POST")).length, 1);
  assert.equal(session.getSnapshot().accountId, 21);
  await assert.rejects(session.retryGuest(session.getSnapshot(), "retry-key-123"), error => error instanceof TradingApiError && error.status === 403);
  assert.deepEqual(JSON.parse(storage.getItem(session.storageKey)!), guest);
  session.leaveMember(); await session.restore(); assert.equal(session.getSnapshot().accountId, 20);
  assert.notEqual(session.getSnapshot().generation, guestSnapshot.generation);
});
test("old Guest responses cannot replace a selected member and an old member 401 cannot erase Guest storage", async () => {
  const storage = memory(); let resolveGuest!: (value: Response) => void, resolveMember!: (value: Response) => void, memberReads = 0;
  const session = createGuestSession(origin, () => storage, async (_url, options) => {
    if (String(_url).endsWith("rounds/current")) return response(round);
    const bearer = new Headers(options?.headers).get("Authorization");
    if (bearer?.includes("guest_")) return new Promise(done => { resolveGuest = done; });
    if (memberReads++ === 0) return response({ accountId: 21 });
    return new Promise(done => { resolveMember = done; });
  }, () => epoch);
  await session.restore(); const old = session.read("account/summary", session.getSnapshot(), new AbortController().signal);
  await session.enterMember(member, () => {}); resolveGuest(response({ accountId: 20 }));
  await assert.rejects(old, { name: "AbortError" }); assert.equal(session.getSnapshot().accountId, 21);
  // A request that eventually returns 401 belongs to the old Member epoch.
  const read = session.read("account/summary", session.getSnapshot(), new AbortController().signal);
  session.leaveMember(); await session.restore(); resolveMember(response({}, 401));
  await assert.rejects(read); assert.equal(session.getSnapshot().accountId, 20);
  assert.deepEqual(JSON.parse(storage.getItem(session.storageKey)!), guest);
});
test("JWT rotation preserves member form/cache epoch and does not persist JWT or reopen account", async () => {
  const storage = memory(); let calls = 0;
  const session = createGuestSession(origin, () => storage, async url => { calls++; return response(String(url).endsWith("rounds/current") ? round : { accountId: 21 }); }, () => epoch);
  await session.enterMember(member, () => {}); const before = session.getSnapshot();
  await session.enterMember({ ...member, accessToken: "header.payload.rotated" }, () => {});
  assert.deepEqual(session.getSnapshot(), before); assert.equal(calls, 2);
  assert.equal(storage.getItem(session.storageKey)!.includes("header.payload"), false);
  assert.equal(JSON.stringify(session.getSnapshot()).includes(member.accessToken), false);
});
test("JWT rotation during explicit account creation keeps one request and accepts its result", async () => {
  let finish!: (value: Response) => void, creates = 0, reads = 0;
  const session = createGuestSession(origin, memory, async (_url, options) => {
    if (String(_url).endsWith("rounds/current")) return response(round);
    if (options?.method === "POST") { creates++; return new Promise(done => { finish = done; }); }
    reads++; return response({}, 404);
  }, () => epoch);
  await session.enterMember(member, () => {});
  const creating = session.createMember();
  await Promise.resolve();
  await session.enterMember({ ...member, accessToken: "header.payload.rotated" }, () => {});
  finish(response({ accountId: 21, memberId: 1, status: "ACTIVE", quoteAsset: "USDT", balance: "0" }));
  await creating;
  assert.equal(creates, 1); assert.equal(reads, 1);
  assert.equal(session.getSnapshot().accountId, 21);
});
test("a Guest creation response arriving after member selection is never persisted", async () => {
  const storage = memory(); storage.removeItem(`yogimangchi.guest.v1:${origin}`);
  let finish!: (value: Response) => void;
  const session = createGuestSession(origin, () => storage, async (url) => new URL(String(url)).pathname.endsWith("accounts/guest")
    ? new Promise(done => { finish = done; }) : response(String(url).endsWith("rounds/current") ? round : { accountId: 21 }), () => epoch);
  const creating = session.createGuest(); await Promise.resolve();
  await session.enterMember(member, () => {}); finish(response(guest)); await creating;
  assert.equal(session.getSnapshot().accountId, 21);
  assert.equal(storage.getItem(session.storageKey), null);
});
