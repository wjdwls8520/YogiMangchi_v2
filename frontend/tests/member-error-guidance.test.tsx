import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ContentApiError, contentJson, contentMessage, contentRecovery } from "../src/features/member/api/client";
import { createMemberSession } from "../src/features/member/api/session";
import { MemberErrorActions, RecoveredLoginAction } from "../src/features/member/components/member-error-actions";
import { readLoginRecovery } from "../src/features/member/api/login-recovery";
import { acceptance, type PolicyBundle } from "../src/features/member/api/policies";

const origin = "http://localhost:8080";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
async function serverError(status: number, code: unknown) {
  try {
    await contentJson(origin, "/auth/signup", { method: "POST", body: {} }, async () => json({ code, detail: "Bearer secret-credential", message: "private@example.invalid", instance: "https://secret.invalid" }, status));
    throw new Error("expected failure");
  } catch (error) { assert.ok(error instanceof ContentApiError); return error; }
}

test("actual policy errors survive parsing and offer document lookup instead of nickname or login advice", async () => {
  for (const [status, code] of [[409, "POLICY_VERSION_CHANGED"], [400, "REQUIRED_CONSENT_MISSING"], [400, "POLICY_VERSION_REQUIRED"]] as const) {
    const error = await serverError(status, code);
    assert.equal(error.status, status); assert.equal(error.code, code);
    assert.equal(contentRecovery(error), "policies");
    assert.doesNotMatch(contentMessage(error), /닉네임|로그인 상태가 만료/);
    let checks = 0;
    const html = renderToStaticMarkup(<MemberErrorActions error={error} onCheck={() => { checks++; }} />);
    assert.match(html, /type="button"[^>]*>최신 정책 원문 다시 조회/);
    assert.equal(checks, 0, "rendering an error must not accept policies or send a request");
    const next = { documents: { TERMS: { version: "v2" }, PRIVACY: { version: "v2" } } } as PolicyBundle;
    assert.throws(() => acceptance(next, { TERMS: { version: "v1", agreed: true }, PRIVACY: { version: "v1", agreed: true } }), ContentApiError);
  }
});

test("proof, CSRF, busy and nickname errors select distinct safe guidance and manual actions", async () => {
  for (const code of ["LOGIN_PROOF_REQUIRED", "LOGIN_PROOF_EXPIRED"]) {
    const error = await serverError(401, code);
    assert.match(contentMessage(error), /소셜 본인 확인/);
    const html = renderToStaticMarkup(<MemberErrorActions error={error} />);
    assert.match(html, /href="\/login"/); assert.match(html, /소셜 로그인으로 다시 확인/);
  }
  for (const [status, code, recovery] of [[409, "MEMBER_BUSY", "state"], [403, "CSRF_INVALID", "csrf"]] as const) {
    const error = await serverError(status, code);
    assert.equal(contentRecovery(error), recovery);
    assert.doesNotMatch(contentMessage(error), /닉네임|로그인 상태가 만료|요청 권한/);
    const html = renderToStaticMarkup(<MemberErrorActions error={error} checking onCheck={() => {}} />);
    assert.match(html, /disabled=""/); assert.doesNotMatch(html, /href=|type="submit"/);
  }
  const nickname = await serverError(409, "NICKNAME_UNAVAILABLE");
  assert.match(contentMessage(nickname), /이미 사용 중인 닉네임/);
  assert.equal(contentRecovery(nickname), null);
  assert.equal(renderToStaticMarkup(<MemberErrorActions error={nickname} onCheck={() => {}} />), "");
  assert.match(contentMessage(await serverError(409, "PROFILE_MESSAGE_UPDATE_REQUIRED")), /소개를 255자/);
});

test("known code extraction never retains server detail or credentials; unknown/malformed bodies keep HTTP status", async () => {
  for (const code of ["POLICY_VERSION_CHANGED", "CSRF_INVALID", "MEMBER_BUSY", "Bearer secret-credential", { token: "secret-credential" }, null]) {
    const error = await serverError(409, code);
    assert.doesNotMatch(JSON.stringify(error) + error.message + error.stack + contentMessage(error), /secret-credential|private@example|secret\.invalid/);
    if (typeof code !== "string" || code.startsWith("Bearer")) assert.equal(error.code, undefined);
  }
  await assert.rejects(contentJson(origin, "/auth/signup", {}, async () => new Response("not JSON: secret-credential", { status: 409 })), error => error instanceof ContentApiError && error.status === 409 && error.code === undefined);
  assert.doesNotMatch(contentMessage(new ContentApiError(409)), /닉네임/);
});

test("CSRF and busy mutation rejection do not log out, rotate access or automatically replay the mutation", async () => {
  for (const [status, code] of [[403, "CSRF_INVALID"], [409, "MEMBER_BUSY"], [409, "POLICY_VERSION_CHANGED"]] as const) {
    const calls: string[] = [], now = Date.parse("2026-11-03T00:00:00Z");
    const session = createMemberSession(origin, async (url, options) => {
      const path = new URL(String(url)).pathname; calls.push(`${options?.method ?? "GET"}:${path}`);
      if (path.endsWith("csrf")) return json({ headerName: "X-CSRF-TOKEN", token: "fixture-csrf" });
      if (path.endsWith("refresh")) return json({ memberId: 1, nickname: "테스트", accessToken: "fixture.payload.signature", tokenType: "Bearer", expiresIn: 900, expiresAt: new Date(now + 900000).toISOString() });
      return json({ code }, status);
    }, () => now, operation => operation(), () => true, () => null);
    await session.restore(); const generation = session.getSnapshot().generation;
    await assert.rejects(session.request("/members/me/consents", { method: "POST", body: {} }), error => error instanceof ContentApiError && error.code === code);
    assert.equal(session.getSnapshot().phase, "ready"); assert.equal(session.getSnapshot().generation, generation);
    assert.equal(calls.filter(x => x.endsWith("/auth/refresh")).length, 1);
    assert.equal(calls.filter(x => x.startsWith("POST:") && x.endsWith("/members/me/consents")).length, 1);
    assert.equal(calls.some(x => x.endsWith("/auth/logout")), false);
  }
});

test("lost signup/login response recovery only reads flow and LOGIN_READY exposes an explicit completion action",async()=>{
  const calls:string[]=[];
  const flow=await readLoginRecovery(origin,async(url,options)=>{
    calls.push(`${options?.method??"GET"}:${new URL(String(url)).pathname}`);
    return json({status:"LOGIN_READY",provider:"GOOGLE",email:"fixture@example.invalid"});
  });
  assert.equal(flow.status,"LOGIN_READY"); assert.deepEqual(calls,["GET:/api/v1/auth/flow"]);
  let completions=0;
  const html=renderToStaticMarkup(<RecoveredLoginAction pending={false} onComplete={()=>{completions++;}}/>);
  assert.match(html,/type="button"[^>]*>로그인 완료하기/); assert.doesNotMatch(html,/disabled=|로그인을 완료하는 중/);
  assert.equal(completions,0,"lookup and rendering must not automatically repeat login completion");
  assert.match(renderToStaticMarkup(<RecoveredLoginAction pending onComplete={()=>{completions++;}}/>),/disabled=""/);
  assert.equal(contentRecovery(new ContentApiError(0)),"state");
  await assert.rejects(readLoginRecovery(origin,async()=>json({code:"LOGIN_PROOF_EXPIRED"},401)),error=>error instanceof ContentApiError&&contentRecovery(error)==="login");
});
