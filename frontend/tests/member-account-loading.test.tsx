import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { MemberAccountPreparation } from "../src/features/trading/components/member-simulation-views";
import { initialSession, type SessionSnapshot } from "../src/features/trading/api/guest-session";

function render(snapshot: SessionSnapshot, disabled = false) {
  return renderToStaticMarkup(<MemberAccountPreparation snapshot={snapshot} disabled={disabled} onPrepare={() => { throw new Error("render must not create an account"); }} onRestore={() => { throw new Error("render must not refresh"); }} />);
}

test("member loading and creation announce progress without failure or retry controls", () => {
  for (const phase of ["loading", "creating"] as const) {
    const html = render({ ...initialSession, mode: "member", phase });
    assert.match(html, /role="status"/);
    assert.match(html, /회원 금융 계정을 확인하는 중입니다/);
    assert.doesNotMatch(html, /확인하지 못|아직 준비되지|<button|10,000/);
  }
});

test("unprepared and failed accounts retain distinct recovery guidance and pending protection", () => {
  const member = { ...initialSession, mode: "member" as const };
  assert.match(render({ ...member, phase: "anonymous" }), /아직 준비되지 않았습니다/);
  const failed = render({ ...member, phase: "error" }, true);
  assert.match(failed, /확인하지 못했습니다/);
  assert.match(failed, /disabled=""/);
  assert.equal(render({ ...member, phase: "ready" }), "");
  assert.equal(render({ ...member, phase: "error", retrying: true }), "");
  assert.match(render({ ...initialSession, mode: "checking" }), /회원 동의와 금융 계정 상태를 확인하는 중/);
});
