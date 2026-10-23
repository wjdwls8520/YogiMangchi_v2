import { test } from "node:test";
import assert from "node:assert/strict";
import { createGuestSession } from "../src/features/trading/api/guest-session";
import { TradingApiError, tradingJson } from "../src/features/trading/api/client";
import { parseRound, parseRoundLedger, parseRoundSummary, roundPage } from "../src/features/trading/api/member-rounds";
const now = Date.parse("2026-10-23T00:00:00Z"), at = new Date(now).toISOString();
const member = { memberId: 1, accessToken: "header.payload.secret", expiresAt: new Date(now + 900000).toISOString() };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const round = (roundId = 1) => ({ roundId, roundNumber: roundId, status: "ACTIVE", funding: "INITIAL_GRANT", initialBalance: "10000.00000000", startedAt: at, endedAt: null, endReason: null, finalWallet: null, currentRound: true });
const restarted = { roundId: 2, roundNumber: 2, balance: "10000.00000000", restartedAt: at, nextAvailableAt: "2026-10-24T00:00:00Z", canceledOrderCount: 2, closedPositionCount: 1 };
function setup(command: (options?: RequestInit) => Promise<Response>, current = () => response({ round: round() })) {
  return createGuestSession("http://localhost:8081", () => ({ getItem: () => null, setItem: () => {}, removeItem: () => {} }), async (url, options) => String(url).endsWith("account/restart") ? command(options)
    : String(url).endsWith("rounds/current") ? current() : response({ accountId: 21 }), () => now);
}
test("round snapshots preserve exact decimals, unverified legacy funding and immutable completed wallets", () => {
  assert.equal(parseRound(round()).initialBalance, "10000.00000000");
  assert.equal(parseRound({ ...round(), funding: "LEGACY_UNVERIFIED", initialBalance: null }).initialBalance, null);
  assert.throws(() => parseRound({ ...round(), initialBalance: 10000 }));
  assert.throws(() => parseRound({ ...round(), funding: "LEGACY_UNVERIFIED" }));
  const closed = { ...round(), status: "COMPLETED", currentRound: false, endedAt: at, endReason: "MEMBER_RESTART", finalWallet: Object.fromEntries(["balance", "usedMargin", "reservedMargin", "realizedPnl", "feesPaid", "settlementAdjustment"].map(k => [k, "0.00000001"])) };
  const parsed = parseRoundSummary({ round: closed, currentAccount: null, restartAvailable: false, nextAvailableAt: restarted.nextAvailableAt, realizedPnl: "-1.20", feesPaid: "0.03", settlementAdjustment: "0" }, 21, 1);
  assert.equal(parsed.round.finalWallet?.balance, "0.00000001"); assert.equal(parsed.currentAccount, null);
  assert.throws(() => parseRoundSummary({ round: closed }, 21, 9));
});
test("round pages reject mixed rounds, duplicate/reversed IDs and nonprogressing cursors", () => {
  const fill = { id: 5, roundId: 1, orderId: 3, price: "0.00000001", quantity: "1", realizedPnl: "0", fee: "0.00000001", settlementAdjustment: "0", executedAt: at };
  assert.equal(parseRoundLedger({ content: [fill], nextCursorId: 5 }, "fills", 1).content[0].price, "0.00000001");
  assert.throws(() => parseRoundLedger({ content: [fill], nextCursorId: null }, "fills", 2));
  for (const ids of [[3, 3], [2, 3], [6]]) assert.throws(() => roundPage({ content: ids.map(round), nextCursorId: null }, parseRound, row => row.roundId, 5));
  assert.throws(() => roundPage({ content: [round(3)], nextCursorId: 2 }, parseRound, row => row.roundId));
});
test("restart is single flight, fences old REST/WS epochs and reconciles actual current round rather than replay receipt", async () => {
  let finish!: (value: Response) => void, posts = 0, actual = 1;
  const session = setup(async options => { posts++; assert.equal(new Headers(options?.headers).get("Idempotency-Key"), "restart-test-key"); return new Promise(done => { finish = done; }); }, () => response({ round: round(actual) }));
  await session.enterMember(member, () => {}); const old = session.getSnapshot();
  const first = session.restartMember(old, "restart-test-key"), duplicate = session.restartMember(old, "restart-test-key");
  assert.equal(first, duplicate); assert.equal(session.getSnapshot().retrying, true); assert.notEqual(session.getSnapshot().generation, old.generation);
  await assert.rejects(session.read("account/summary", old, new AbortController().signal));
  let frames = 0; const stop = session.watchEvents(old, () => { frames++; }, () => {}, () => {}); stop(); assert.equal(frames, 0);
  actual = 3; finish(response(restarted)); await first;
  assert.equal(posts, 1); assert.equal(session.getSnapshot().roundId, 3); assert.equal(!!session.getSnapshot().retrying, false);
  session.observeMemberRound(99, old); assert.equal(session.getSnapshot().roundId, 3);
});
test("uncertain restart never retries automatically, blocks new keys, and same-key replay restores server state", async () => {
  let posts = 0;
  const session = setup(async () => ++posts === 1 ? response({}, 503) : response(restarted), () => response({ round: round(posts ? 2 : 1) }));
  await session.enterMember(member, () => {}); const before = session.getSnapshot();
  await assert.rejects(session.restartMember(before, "restart-test-key")); assert.equal(posts, 1); assert.equal(session.getSnapshot().phase, "error");
  await session.restore(); await session.enterMember({ ...member, accessToken: "header.payload.rotated" }, () => {});
  assert.equal(session.getSnapshot().phase, "error"); assert.equal(posts, 1);
  await assert.rejects(session.restartMember(session.getSnapshot(), "different-test-key"), error => error instanceof TradingApiError && error.code === "IDEMPOTENCY_CONFLICT");
  await session.restartMember(session.getSnapshot(), "restart-test-key"); assert.equal(posts, 2); assert.equal(session.getSnapshot().roundId, 2);
});
test("successful restart followed by failed reconciliation remains uncertain even for HTTP 404", async () => {
  let posted = false;
  const session = setup(async () => { posted = true; return response(restarted); }, () => posted ? response({}, 404) : response({ round: round() }));
  await session.enterMember(member, () => {});
  await assert.rejects(session.restartMember(session.getSnapshot(), "restart-test-key"), error => error instanceof TradingApiError && error.status === 0);
  assert.equal(session.getSnapshot().phase, "error"); assert.equal(session.getSnapshot().roundId, undefined);
});
test("late restart result cannot affect another member and Guest cannot invoke member restart", async () => {
  let finish!: (value: Response) => void;
  const session = setup(async () => new Promise(done => { finish = done; }));
  await assert.rejects(session.restartMember(session.getSnapshot(), "restart-test-key"));
  await session.enterMember(member, () => {}); const pending = session.restartMember(session.getSnapshot(), "restart-test-key");
  session.leaveMember(); await session.enterMember({ ...member, memberId: 2 }, () => {}); const next = session.getSnapshot();
  finish(response(restarted)); await assert.rejects(pending, { name: "AbortError" }); assert.deepEqual(session.getSnapshot(), next);
});
test("restart limit retains only a valid server timestamp, never sensitive error content", async () => {
  await assert.rejects(tradingJson("http://localhost:8081", "account/restart", {}, async () => response({ code: "MEMBER_RESTART_LIMITED", nextAvailableAt: restarted.nextAvailableAt, detail: member.accessToken, headers: { Authorization: member.accessToken } }, 429)), error => {
    assert.ok(error instanceof TradingApiError); assert.equal(error.nextAvailableAt, restarted.nextAvailableAt); assert.equal(JSON.stringify(error).includes(member.accessToken), false); assert.equal(error.message.includes(member.accessToken), false); return true;
  });
});
