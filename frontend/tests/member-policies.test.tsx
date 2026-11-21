import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { acceptance, parsePolicyState, policyAccepted, readPolicies, type PolicyBundle, type PolicyType } from "../src/features/member/api/policies";
import { PolicyContent } from "../src/features/member/components/policy-content";
import { PolicyConsentFields, PolicyDialogContent } from "../src/features/member/components/policy-consent-views";
import { WithdrawalConfirmation } from "../src/features/member/components/withdrawal-confirmation";
const types: PolicyType[] = ["TERMS", "PRIVACY"];
const current = { policies: types.map(type => ({ type, version: `ym-${type.toLowerCase()}-v1`, required: true, accepted: false, lastAcceptedVersion: null, lastAgreedAt: null, documentUrl: `/api/v1/policies/${type}/ym-${type.toLowerCase()}-v1` })), reconsentRequired: true };
const json = (value: unknown) => new Response(JSON.stringify(value));
async function bundle() {
  return readPolicies("http://localhost:8080", new AbortController().signal, async url => {
    if (String(url).endsWith("/current")) return json(current);
    const type = String(url).includes("/TERMS/") ? "TERMS" : "PRIVACY", text = `# ${type} original\n\n<script>private</script>`;
    return json({ type, version: `ym-${type.toLowerCase()}-v1`, documentStatus: "DEVELOPMENT_DRAFT", text, sha256: createHash("sha256").update(text).digest("hex") });
  });
}
test("policy bundle uses exact type/version and verifies the original SHA-256", async () => {
  const loaded = await bundle(); assert.equal(loaded.documents.TERMS.version, "ym-terms-v1");
  await assert.rejects(readPolicies("http://localhost:8080", new AbortController().signal, async url => String(url).endsWith("current") ? json(current) : json({ type: "TERMS", version: "ym-terms-v1", documentStatus: "DEVELOPMENT_DRAFT", text: "tampered", sha256: "a".repeat(64) })));
  assert.throws(() => parsePolicyState({ ...current, policies: [{ ...current.policies[0], documentUrl: "https://outside.test" }, current.policies[1]] }));
  assert.throws(() => parsePolicyState({ ...current, policies: [current.policies[0], current.policies[0]] }));
});
test("opening/reading a document supplies no acceptance; explicit choices are version scoped and independently revocable", async () => {
  const loaded = await bundle();
  const selection = { TERMS: { version: "ym-terms-v1", agreed: true }, PRIVACY: { version: "ym-privacy-v1", agreed: true } };
  assert.equal(policyAccepted({}, "TERMS", "ym-terms-v1"), false);
  assert.throws(() => acceptance(loaded, {}));
  assert.throws(() => acceptance(loaded, { TERMS: selection.TERMS }));
  assert.deepEqual(acceptance(loaded, selection), { termAgree: true, privateAgree: true, termsVersion: "ym-terms-v1", privacyVersion: "ym-privacy-v1" });
  assert.throws(() => acceptance(loaded, { ...selection, PRIVACY: { ...selection.PRIVACY, agreed: false } }));
  assert.equal(policyAccepted(selection, "TERMS", "ym-terms-v2"), false);
});
test("reconsent does not promote an older agreement to a new policy version", async () => {
  const loaded = await bundle(), old = parsePolicyState({ ...current, policies: current.policies.map(p => ({ ...p, lastAcceptedVersion: "previous-version", lastAgreedAt: "2026-10-20T00:00:00Z" })) });
  assert.throws(() => acceptance(loaded, {}, old));
  const accepted = parsePolicyState({ policies: current.policies.map(p => ({ ...p, accepted: true, lastAcceptedVersion: p.version, lastAgreedAt: "2026-10-23T00:00:00Z" })), reconsentRequired: false });
  assert.equal(acceptance(loaded, {}, accepted).termAgree, true);
  assert.equal(policyAccepted({}, "TERMS", "ym-terms-v2", accepted), false);
});
test("public and popup policy content share clean originals without internal draft placeholders and show support fallback when missing", async () => {
  const loaded: PolicyBundle = await bundle();
  const page = renderToStaticMarkup(<PolicyContent type="TERMS" document={loaded.documents.TERMS} />);
  const popup = renderToStaticMarkup(<PolicyDialogContent document={loaded.documents.TERMS} accepted={false} onAccept={() => {}} onRevoke={() => {}} onClose={() => {}} />);
  assert.equal(popup.includes(page), true);
  assert.match(page, /TERMS original/);
  assert.match(page, /ym-terms-v1/);
  assert.equal(page.includes("<script>"), false);
  for (const forbidden of ["[추후", "frontend-draft", "서버 등록 개발 초안", "위 문구는 초기안이다", "검토용 전체 원고"]) {
    assert.equal(page.includes(forbidden), false, `TERMS should not expose ${forbidden}`);
  }
  const privacy = renderToStaticMarkup(<PolicyContent type="PRIVACY" document={loaded.documents.PRIVACY} />);
  assert.match(privacy, /PRIVACY original/);
  assert.match(privacy, /ym-privacy-v1/);
  assert.equal(privacy.includes("[추후"), false);
  assert.equal(privacy.includes("frontend-draft"), false);

  const missingFallback = renderToStaticMarkup(<PolicyContent type="TERMS" />);
  assert.match(missingFallback, /현재 약관 원문을 불러오지 못했습니다/);
  assert.match(missingFallback, /href="\/support"/);
  assert.equal(missingFallback.includes("[추후"), false);
  assert.equal(missingFallback.includes("frontend-draft"), false);

  assert.match(popup, /동의하지 않고 닫기/); assert.match(popup, /현재 이 버전에 동의하지 않았습니다/);
  const fields = renderToStaticMarkup(<PolicyConsentFields versions={{ TERMS: "v1", PRIVACY: "v1" }} accepted={{ TERMS: false, PRIVACY: false }} disabled={false} onChange={() => {}} onOpen={() => {}} />);
  assert.equal(fields.includes('checked=""'), false); assert.match(fields, /개인정보 수집·이용 동의/);
});
test("withdrawal execution requires both exact explicit phrase and acknowledgment after reauthentication", () => {
  const render = (ready: boolean, acknowledged: boolean, confirmation: string) => renderToStaticMarkup(<WithdrawalConfirmation ready={ready} acknowledged={acknowledged} confirmation={confirmation} onSubmit={event => event.preventDefault()} onCancel={() => {}} />);
  for (const [ready, agreed, phrase] of [[false, true, "탈퇴합니다"], [true, false, "탈퇴합니다"], [true, true, "탈퇴합니다 "]] as const)
    assert.match(render(ready, agreed, phrase), /type="submit"[^>]*disabled=""/);
  assert.doesNotMatch(render(true, true, "탈퇴합니다"), /type="submit"[^>]*disabled=""/);
});
