import { test } from "node:test";
import assert from "node:assert/strict";
import { ContentApiError, contentJson, oauthUrl } from "../src/features/member/api/client";
import { createMemberSession, type CookieLock } from "../src/features/member/api/session";
import { parseAccess, parseFlow, parseFollowPage, parseOwnProfile, parseProfile, validNickname } from "../src/features/member/api/contracts";

const origin = "http://localhost:8080", epoch = Date.parse("2026-10-23T00:00:00Z");
const access = (suffix = "one", memberId = 1) => ({ memberId, nickname: "요기망치", accessToken: `header.payload.${suffix}`, tokenType: "Bearer", expiresIn: 900, expiresAt: new Date(epoch + 900000).toISOString() });
const json = (value: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(value), { status });
const lock: CookieLock = operation => operation();
const csrf = { headerName: "X-CSRF-TOKEN", token: "session-bound-csrf" };

test("member refresh is single-flight and stores no token in observable state", async () => {
  const calls: { path: string; options?: RequestInit }[] = [];
  const session = createMemberSession(origin, async (url, options) => {
    const path = new URL(String(url)).pathname; calls.push({ path, options });
    return json(path.endsWith("csrf") ? csrf : access());
  }, () => epoch, lock);
  await Promise.all([session.restore(), session.restore(), session.restore()]);
  assert.equal(calls.filter(call => call.path.endsWith("refresh")).length, 1);
  assert.equal(session.getSnapshot().phase, "ready");
  assert.equal(JSON.stringify(session.getSnapshot()).includes(access().accessToken), false);
  assert.equal(calls[1].options?.credentials, "include");
  assert.equal(new Headers(calls[1].options?.headers).get("X-CSRF-TOKEN"), csrf.token);
  assert.equal(new Headers(calls[1].options?.headers).has("Authorization"), false);
});
test("a shared cookie lock serializes refresh across independent tab sessions", async () => {
  let queue: Promise<unknown> = Promise.resolve(), active = 0, maximum = 0;
  const shared: CookieLock = operation => { const next = queue.then(operation); queue = next.catch(() => {}); return next; };
  const transport: typeof fetch = async url => {
    if (String(url).endsWith("csrf")) return json(csrf);
    active++; maximum = Math.max(maximum, active); await Promise.resolve(); active--; return json(access());
  };
  const a = createMemberSession(origin, transport, () => epoch, shared), b = createMemberSession(origin, transport, () => epoch, shared);
  await Promise.all([a.restore(), b.restore()]); assert.equal(maximum, 1);
});
test("GET can refresh once after 401 while a mutation is never automatically replayed", async () => {
  for (const method of ["GET", "PATCH"] as const) {
    let refreshes = 0, requests = 0;
    const session = createMemberSession(origin, async (url, options) => {
      if (String(url).endsWith("csrf")) return json(csrf);
      if (String(url).endsWith("refresh")) return json(access(++refreshes === 1 ? "first" : "second"));
      requests++;
      assert.equal(options?.credentials, "omit");
      if (requests === 1) return json({}, 401);
      assert.equal(new Headers(options?.headers).get("Authorization"), "Bearer header.payload.second");
      return json({ ok: true });
    }, () => epoch, lock);
    await session.restore();
    if (method === "GET") assert.deepEqual(await session.request("/members/me", { method }), { ok: true });
    else await assert.rejects(session.request("/members/me/profile", { method, body: { nickname: "수정" } }), error => error instanceof ContentApiError && error.status === 401);
    assert.equal(refreshes, 2); assert.equal(requests, method === "GET" ? 2 : 1);
  }
});
test("late old-member responses and canceled OAuth completions cannot restore a forgotten identity", async () => {
  let resolveRead!: (value: Response) => void;
  const session = createMemberSession(origin, async url => String(url).endsWith("csrf") ? json(csrf)
    : String(url).endsWith("refresh") ? json(access()) : new Promise(done => { resolveRead = done; }), () => epoch, lock);
  await session.restore();
  const pending = session.request("/members/me"); await Promise.resolve(); session.forget(); resolveRead(json({ memberId: 1 }));
  await assert.rejects(pending, { name: "AbortError" }); assert.equal(session.getSnapshot().memberId, null);
  let resolveLogin!: (value: Response) => void;
  const login = createMemberSession(origin, async url => String(url).endsWith("csrf") ? json(csrf) : new Promise(done => { resolveLogin = done; }), () => epoch, lock);
  const finishing = login.complete(); for (let i = 0; i < 8; i++) await Promise.resolve();
  login.forget(); resolveLogin(json(access())); await assert.rejects(finishing, { name: "AbortError" });
  assert.equal(login.getSnapshot().phase, "anonymous");
});
test("expired/reused refresh ends membership and neither retries nor creates a Guest", async () => {
  const calls: string[] = [];
  const session = createMemberSession(origin, async url => { calls.push(String(url)); return String(url).endsWith("csrf") ? json(csrf) : json({}, 401); }, () => epoch, lock);
  await assert.rejects(session.restore()); assert.equal(session.getSnapshot().phase, "anonymous");
  assert.equal(calls.length, 2); assert.equal(calls.some(url => url.includes("guest")), false);
});
test("cookie logout clears access, is single-flight, and failed logout is never reported as completed", async () => {
  let logouts = 0;
  const session = createMemberSession(origin, async url => {
    if (String(url).endsWith("csrf")) return json(csrf);
    if (String(url).endsWith("logout")) { logouts++; return json(null, 204); }
    return json(access());
  }, () => epoch, lock);
  await session.restore(); await Promise.all([session.logout(), session.logout()]);
  assert.equal(logouts, 1); assert.equal(session.getSnapshot().phase, "anonymous");
  const failed = createMemberSession(origin, async url => String(url).endsWith("csrf") ? json(csrf) : json({}, 503), () => epoch, lock);
  await assert.rejects(failed.logout()); assert.equal(failed.getSnapshot().phase, "error");
});
test("Content failures retain status but never retain raw server bodies, URLs, credentials or transport causes", async () => {
  const secret = "Bearer secret-member-token";
  for (const response of [json({ code: secret, detail: secret, token: secret }, 409), new Response("invalid body", { status: 500 })]) {
    try { await contentJson(origin, "/members/me", { access: secret }, async () => response); assert.fail("Expected error"); }
    catch (error) { assert(error instanceof ContentApiError); assert.equal(JSON.stringify(error).includes(secret), false); assert.equal(String(error).includes(secret), false); }
  }
  await assert.rejects(contentJson("https://user:secret@example.test", "/members/me", {}, async () => assert.fail("No network")));
  await assert.rejects(contentJson(origin, "/members/../auth/refresh", {}, async () => assert.fail("No network")));
  assert.equal(oauthUrl(origin, "google"), `${origin}/oauth2/authorization/google`);
});
test("member DTOs validate identity and cursor while public profiles discard private fields", () => {
  assert.equal(parseAccess(access()).memberId, 1);
  assert.throws(() => parseAccess({ ...access(), accessToken: "provider-token" }));
  const profile = { memberId: 1, nickname: "회원", profileMessage: "", createdAt: new Date(epoch).toISOString(), role: "ADMIN", email: "private@example.test" };
  assert.equal("email" in parseProfile(profile), false); assert.equal("role" in parseProfile(profile), false);
  assert.throws(() => parseOwnProfile(profile, 2));
  assert.equal(parseFlow({ status: "LOGIN_READY", provider: "KAKAO", email: "test@example.test" }).status, "LOGIN_READY");
  assert.equal("email" in parseFlow({ status: "LOGIN_READY", provider: "KAKAO", email: "test@example.test" }), false);
  assert.throws(() => parseFlow({ status: "LOGIN_READY", provider: "OTHER", email: "test@example.test" }));
  assert.deepEqual(parseFollowPage({ content: [], nextCursorId: null, hasNext: false }), { content: [], nextCursorId: null, hasNext: false });
  assert.throws(() => parseFollowPage({ content: [], nextCursorId: null, hasNext: true }));
  assert.equal(validNickname("요기12"), true); assert.equal(validNickname("공백 이름"), false);
});
test("nickname accepts one to eight Unicode letters or numbers and rejects whitespace and special characters", () => {
  for (const nickname of ["가", "abcdefgh", "요기망치1234", "Élodie", "東京123", "𐐀𐐁𐐂𐐃𐐄𐐅𐐆𐐇"])
    assert.equal(validNickname(nickname), true, nickname);
  for (const nickname of ["", "abcdefghi", "요기망치12345", "𐐀𐐁𐐂𐐃𐐄𐐅𐐆𐐇𐐈", "공백 이름", " 이름", "이름\t", "이름\n", "이름\u00a0", "이름\u200b", "a_b", "a-b", "abc!", "이름😀"])
    assert.equal(validNickname(nickname), false, JSON.stringify(nickname));
  const nickname = "𐐀𐐁𐐂𐐃𐐄𐐅𐐆𐐇";
  assert.equal(parseAccess({ ...access(), nickname }).nickname, nickname);
  assert.equal(parseProfile({ memberId: 1, nickname, profileMessage: "", createdAt: new Date(epoch).toISOString() }).nickname, nickname);
});
