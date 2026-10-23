import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemberSession, type CookieLock } from "../src/features/member/api/session";
import { parseFlow } from "../src/features/member/api/contracts";
const epoch = Date.parse("2026-10-23T00:00:00Z"), origin = "http://localhost:8080";
const token = { memberId: 1, nickname: "회원", accessToken: "header.payload.private", tokenType: "Bearer", expiresIn: 900, expiresAt: new Date(epoch + 900000).toISOString() };
const body = { acknowledged: true, confirmation: "탈퇴합니다", policyVersion: "ym-withdrawal-v1" };
const lock: CookieLock = operation => operation();
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
test("withdrawal validates exact confirmation locally, sends CSRF plus Bearer and blocks member mutations while pending", async () => {
  let posts = 0;
  const session = createMemberSession(origin, async (url, options) => {
    if (String(url).endsWith("csrf")) return json({ headerName: "X-CSRF-TOKEN", token: "csrf" });
    if (String(url).endsWith("refresh")) return json(token);
    if (options?.method === "POST") {
      posts++; assert.deepEqual(JSON.parse(options.body as string), body);
      assert.equal(options.credentials, "include"); assert.equal(new Headers(options.headers).get("Authorization"), `Bearer ${token.accessToken}`);
      assert.equal(new Headers(options.headers).get("X-CSRF-TOKEN"), "csrf"); return json({ status: "PENDING" }, 202);
    }
    return json({ status: "COMPLETED" });
  }, () => epoch, lock);
  await session.restore(); await assert.rejects(session.withdraw({ ...body, confirmation: "탈퇴합니다 " })); assert.equal(posts, 0);
  const results = await Promise.all([session.withdraw(body), session.withdraw(body)]);
  assert.deepEqual(results, ["PENDING", "PENDING"]); assert.equal(posts, 1);
  assert.equal(session.getSnapshot().phase, "withdrawing"); assert.equal(session.getSnapshot().memberId, null);
  assert.equal(JSON.stringify(session.getSnapshot()).includes(token.accessToken), false);
  await assert.rejects(session.request("/members/me/profile", { method: "PATCH", body: { nickname: "변경" } }));
  assert.equal(await session.withdrawalStatus(), "COMPLETED"); assert.equal(session.getSnapshot().phase, "anonymous");
  await assert.rejects(session.withdrawalStatus());
});
test("uncertain withdrawal is not reposted or claimed successful; dedicated status can confirm not-requested", async () => {
  let posts = 0;
  const session = createMemberSession(origin, async (url, options) => String(url).endsWith("csrf") ? json({ headerName: "X-CSRF-TOKEN", token: "csrf" })
    : String(url).endsWith("refresh") ? json(token) : options?.method === "POST" ? (posts++, json({}, 503)) : json({ status: "NOT_REQUESTED" }), () => epoch, lock);
  await session.restore(); await assert.rejects(session.withdraw(body)); assert.equal(posts, 1);
  assert.equal(session.getSnapshot().phase, "withdrawing");
  assert.equal(await session.withdrawalStatus(), "NOT_REQUESTED"); assert.equal(posts, 1);
});
test("pending OAuth flow never becomes signup or login, while post-withdrawal signup has no old member identity", () => {
  assert.equal(parseFlow({ status: "WITHDRAWAL_PENDING", provider: "GOOGLE", email: "test@example.test" }).status, "WITHDRAWAL_PENDING");
  const fresh = parseFlow({ status: "SIGNUP_REQUIRED", provider: "GOOGLE", email: "test@example.test", memberId: 100 });
  assert.equal("memberId" in fresh, false); assert.equal(fresh.status, "SIGNUP_REQUIRED");
});

test("late withdrawal status cannot clear a newly authenticated member", async () => {
  let finish!: (value: Response) => void;
  const session = createMemberSession(origin, async (url, options) => {
    if (String(url).endsWith("csrf")) return json({ headerName: "X-CSRF-TOKEN", token: "csrf" });
    if (String(url).endsWith("refresh")) return json(token);
    if (String(url).endsWith("login/complete")) return json({ ...token, memberId: 2 });
    return options?.method === "POST" ? json({ status: "PENDING" }, 202) : new Promise(done => { finish = done; });
  }, () => epoch, lock);
  await session.restore(); await session.withdraw(body);
  const old = session.withdrawalStatus(); await session.complete(); const next = session.getSnapshot();
  finish(json({ status: "COMPLETED" })); await assert.rejects(old, { name: "AbortError" });
  assert.deepEqual(session.getSnapshot(), next); assert.equal(next.memberId, 2);
  await assert.rejects(session.withdrawalStatus());
});
test("consent permission updates apply only to the current member epoch", async () => {
  const session = createMemberSession(origin, async url => String(url).endsWith("csrf") ? json({ headerName: "X-CSRF-TOKEN", token: "csrf" }) : json(token), () => epoch, lock);
  await session.restore(); const before = session.getSnapshot();
  assert.equal(before.consentStatus, "checking"); session.setConsentStatus("accepted", 1, before.generation);
  assert.equal(session.getSnapshot().consentStatus, "accepted"); session.forget(); session.setConsentStatus("accepted", 1, before.generation);
  assert.equal(session.getSnapshot().phase, "anonymous"); assert.equal(session.getSnapshot().consentStatus, undefined);
});
