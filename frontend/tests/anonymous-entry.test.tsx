import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { AnonymousOrderPanel, isAnonymousOrderEntry } from "../src/features/trading/components/anonymous-order-panel";
import { initialMember, type MemberSnapshot } from "../src/features/member/api/session";
import { initialSession, type SessionSnapshot } from "../src/features/trading/api/guest-session";

test("anonymous order preview is inert and hidden from assistive navigation; entry actions remain outside", () => {
  const html = renderToStaticMarkup(<AnonymousOrderPanel onGuest={() => {}} />);
  const [preview, overlay] = html.split('<div class="order-entry-overlay">');
  assert.match(preview, /inert="" aria-hidden="true"/);
  assert.ok([...preview.matchAll(/<(?:select|button)\b[^>]*>/g)].every(([element]) => element.includes('disabled=""')));
  assert.ok([...preview.matchAll(/<fieldset\b[^>]*>/g)].every(([element]) => element.includes('disabled=""')));
  assert.match(preview, /<input(?=[^>]*id="entry-quantity")(?=[^>]*disabled="")[^>]*>/);
  assert.match(overlay, /로그인 이후 이용 가능/);
  assert.match(overlay, /href="\/login"/);
  assert.match(overlay, /<button[^>]*>게스트 로그인<\/button>/);
  assert.doesNotMatch(overlay, /inert=|disabled=|레버리지.*오류/);
  assert.doesNotMatch(html, /10,000|10×|1×/);
});

test("restoration, consent and member account preparation cannot be mistaken for an anonymous visitor", () => {
  const anonymous: MemberSnapshot = {...initialMember,phase:"anonymous"};
  const empty: SessionSnapshot = {...initialSession,phase:"anonymous"};
  assert.equal(isAnonymousOrderEntry(anonymous, empty), true);
  assert.equal(isAnonymousOrderEntry(anonymous, {...empty,phase:"error"}), true);
  for (const phase of ["loading","authenticating","ready","recovering","error","ending","withdrawing"] as const)
    assert.equal(isAnonymousOrderEntry({...anonymous,phase}, empty), false, phase);
  for (const trading of [{...empty,phase:"loading" as const},{...empty,phase:"creating" as const},
    {...empty,phase:"ready" as const,accountId:3},{...empty,mode:"checking" as const},{...empty,mode:"member" as const}])
    assert.equal(isAnonymousOrderEntry(anonymous,trading),false);
  assert.equal(isAnonymousOrderEntry({...anonymous,recovery:{retryable:false,retryAt:0,uncertain:true}},empty),false);
});
