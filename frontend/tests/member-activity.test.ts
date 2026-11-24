import { test } from "node:test";
import assert from "node:assert/strict";
import { bindMemberActivity } from "../src/features/member/api/activity";
import { browserCookieLock, createMemberSession, type CookieLock } from "../src/features/member/api/session";
import { ContentApiError } from "../src/features/member/api/client";

const origin = "http://localhost:8080", epoch = Date.parse("2026-10-23T00:00:00Z");
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const csrf = { headerName: "X-CSRF-TOKEN", token: "csrf" };
const token = (now: number, suffix = "one") => ({ memberId: 1, nickname: "회원", accessToken: `header.payload.${suffix}`, tokenType: "Bearer", expiresIn: 900, expiresAt: new Date(now + 900000).toISOString() });
const unlocked: CookieLock = operation => operation();
const settle = () => new Promise<void>(done => setImmediate(done));
class Page extends EventTarget { visibilityState: DocumentVisibilityState = "visible"; }
function fixture(initial: DocumentVisibilityState = "visible") {
  const page = new Page(), browser = new EventTarget(); page.visibilityState = initial;
  let now = epoch, refreshes = 0;
  const session = createMemberSession(origin, async url => String(url).endsWith("csrf") ? json(csrf)
    : String(url).endsWith("refresh") ? (refreshes++, json(token(now, String(refreshes)))) : json({ ok: true }), () => now, unlocked, () => page.visibilityState !== "hidden");
  const activity = bindMemberActivity(session, page, browser, false);
  return { page, browser, session, activity, advance: (ms: number) => { now += ms; }, refreshes: () => refreshes,
    resume() { page.visibilityState = "visible"; page.dispatchEvent(new Event("visibilitychange")); browser.dispatchEvent(new Event("focus")); browser.dispatchEvent(new Event("pageshow")); } };
}
test("hidden initial mount and idle expiry perform zero refresh; three return events share one restore", async () => {
  const f = fixture("hidden"); await settle(); assert.equal(f.refreshes(), 0);
  f.advance(3600000); await settle(); assert.equal(f.refreshes(), 0);
  f.resume(); await settle(); assert.equal(f.refreshes(), 1); assert.equal(f.session.getSnapshot().phase, "ready");
  const generation = f.session.getSnapshot().generation;
  for (let i = 0; i < 5; i++) f.resume();
  await settle(); assert.equal(f.refreshes(), 1); assert.equal(f.session.getSnapshot().generation, generation);
  f.activity.stop();
});
test("hidden expired requests defer without erasing membership; visible concurrent APIs refresh just once", async () => {
  const f = fixture(); await settle(); const before = f.session.getSnapshot();
  f.page.visibilityState = "hidden"; f.advance(901000);
  await assert.rejects(f.session.request("/members/me"), { name: "AbortError" });
  await assert.rejects(f.session.refresh(), { name: "AbortError" });
  assert.deepEqual(f.session.getSnapshot(), before); assert.equal(f.refreshes(), 1);
  f.page.visibilityState = "visible";
  assert.deepEqual(await Promise.all([f.session.request("/members/me"), f.session.request("/members/me/consents"), f.session.request("/members/1")]), [{ ok: true }, { ok: true }, { ok: true }]);
  assert.equal(f.refreshes(), 2); assert.equal(f.session.getSnapshot().generation, before.generation); f.activity.stop();
});
test("forced Trading authentication recovery deferred in background is resumed even with a locally unexpired token", async () => {
  const f = fixture(); await settle(); f.page.visibilityState = "hidden";
  await assert.rejects(f.session.refresh(), { name: "AbortError" }); assert.equal(f.refreshes(), 1);
  f.resume(); await settle(); assert.equal(f.refreshes(), 2); f.activity.stop();
});
test("a tab hidden while waiting for the cookie lock never posts refresh and can recover on return", async () => {
  let unlock!: () => void, visible = true, requests = 0;
  const gate = new Promise<void>(done => { unlock = done; });
  const lock: CookieLock = async operation => { await gate; return operation(); };
  const session = createMemberSession(origin, async url => { requests++; return json(String(url).endsWith("csrf") ? csrf : token(epoch)); }, () => epoch, lock, () => visible);
  const restoring = session.restore(); visible = false; unlock(); await assert.rejects(restoring, { name: "AbortError" });
  assert.equal(requests, 0); assert.notEqual(session.getSnapshot().phase, "error");
  visible = true; await session.restore(); assert.equal(requests, 2); assert.equal(session.getSnapshot().phase, "ready");
});
test("cross-tab identity changes defer restoration while hidden; logout and disposal cancel deferred work", async () => {
  const f = fixture(); await settle(); f.page.visibilityState = "hidden";
  f.session.forget(); f.activity.restore(); await settle(); assert.equal(f.refreshes(), 1);
  f.resume(); await settle(); assert.equal(f.refreshes(), 2);
  f.page.visibilityState = "hidden"; f.session.forget(); f.activity.restore(); f.activity.cancel();
  f.resume(); await settle(); assert.equal(f.refreshes(), 2); assert.equal(f.session.getSnapshot().phase, "anonymous");
  f.activity.stop(); f.activity.restore(); f.resume(); await settle(); assert.equal(f.refreshes(), 2);
});
test("OAuth callbacks never race proof completion with activity-driven refresh", async () => {
  const page = new Page(), browser = new EventTarget(); let calls = 0;
  const session = createMemberSession(origin, async () => { calls++; return json({}); }, () => epoch, unlocked);
  const activity = bindMemberActivity(session, page, browser, true);
  activity.restore(); browser.dispatchEvent(new Event("pageshow")); page.dispatchEvent(new Event("visibilitychange"));
  await settle(); assert.equal(calls, 0); activity.stop();
});
test("network failure is explicit and refresh expiry stays anonymous without focus-driven retry loops", async () => {
  for (const status of [0, 401]) {
    const page = new Page(), browser = new EventTarget(); let refreshes = 0;
    const session = createMemberSession(origin, async url => {
      if (String(url).endsWith("csrf")) return json(csrf);
      refreshes++; if (status === 0) throw new TypeError("private network detail"); return json({}, 401);
    }, () => epoch, unlocked);
    const activity = bindMemberActivity(session, page, browser, false); await settle();
    assert.equal(session.getSnapshot().phase, status === 0 ? "recovering" : "anonymous");
    for (let i = 0; i < 5; i++) browser.dispatchEvent(new Event("focus"));
    await settle(); assert.equal(refreshes, 1); activity.stop();
  }
});
test("staggered old-token 401 responses share the already refreshed token instead of rotating twice", async () => {
  let refreshes = 0; const finish: Array<(value: Response) => void> = [];
  const session = createMemberSession(origin, async (url, options) => {
    if (String(url).endsWith("csrf")) return json(csrf);
    if (String(url).endsWith("refresh")) return json(token(epoch, String(++refreshes)));
    if (new Headers(options?.headers).get("Authorization") === "Bearer header.payload.1") return new Promise(done => { finish.push(done); });
    return json({ ok: true });
  }, () => epoch, unlocked);
  await session.restore(); const first = session.request("/members/me"), second = session.request("/members/1");
  finish[0](json({}, 401)); await first; finish[1](json({}, 401)); await second;
  assert.equal(refreshes, 2);
});
test("actual cookie lock adapter serializes two visible windows and keeps using the newest rotated cookie", async () => {
  const original = Object.getOwnPropertyDescriptor(navigator, "locks");
  let queue: Promise<unknown> = Promise.resolve(), active = 0, maximum = 0, cookieVersion = 0;
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: (name: string, operation: () => Promise<unknown>) => {
    assert.equal(name, `yogimangchi:content-cookie:${origin}`);
    const next = queue.then(operation); queue = next.catch(() => {}); return next;
  } } });
  try {
    const transport: typeof fetch = async url => {
      if (String(url).endsWith("csrf")) return json(csrf);
      const sent = cookieVersion; active++; maximum = Math.max(maximum, active); await settle();
      assert.equal(sent, cookieVersion, "A replayed ancestor cookie would revoke the family");
      cookieVersion++; active--; return json(token(epoch, String(cookieVersion)));
    };
    const a = createMemberSession(origin, transport, () => epoch, browserCookieLock(origin));
    const b = createMemberSession(origin, transport, () => epoch, browserCookieLock(origin));
    await Promise.all([a.restore(), b.restore()]); assert.equal(maximum, 1); assert.equal(cookieVersion, 2);
    assert.equal(a.getSnapshot().memberId, b.getSnapshot().memberId);
  } finally { if (original) Object.defineProperty(navigator, "locks", original); else Reflect.deleteProperty(navigator, "locks"); }
});
test("unsupported cookie locks fail closed instead of sending uncoordinated refreshes", async () => {
  const original = Object.getOwnPropertyDescriptor(navigator, "locks");
  Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
  try {
    let calls = 0; const session = createMemberSession(origin, async () => { calls++; return json({}); });
    await assert.rejects(session.restore(), error => error instanceof ContentApiError && error.status === 0);
    assert.equal(calls, 0);
  } finally { if (original) Object.defineProperty(navigator, "locks", original); else Reflect.deleteProperty(navigator, "locks"); }
});
